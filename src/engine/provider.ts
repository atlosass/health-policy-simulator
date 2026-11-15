import { PARAMS } from "./params.ts";
import type { ExplanationEvent, Policy, SectorSnapshot } from "./types.ts";

export type SectorId = "hospital" | "physician";
export const SECTOR_IDS: readonly SectorId[] = ["hospital", "physician"];

/**
 * Mutable state for one provider sector. Capacity follows expected demand with
 * a lag (construction for hospitals, training for physicians), firms enter
 * when margins are fat, exit when they are negative, and merge when a merger
 * would pay. `firms` is continuous so that gradual entry/exit move the HHI
 * smoothly; mergers move it in discrete steps.
 */
export interface SectorState {
  id: SectorId;
  capacity: number;
  baselineCapacity: number;
  firms: number;
  /** The demand providers plan capacity for: a moving average of realized demand. */
  expectedDemand: number;
  /**
   * NET capacity changes already committed (and any new firms coming with
   * them), indexed by years-until-arrival − 1. An entry is negative when the
   * capacity retiring that year will outrun the replacements started for it.
   */
  pipeline: { capacity: number; firms: number }[];
}

export interface ProviderState {
  hospital: SectorState;
  physician: SectorState;
  initialized: boolean;
  /** Baseline total annual care demand (all payers), used to size the public delivery system. */
  baselineTotalDemand: number;
}

/** Reported utilization is capped here; beyond it the number carries no extra information. */
const MAX_REPORTED_UTILIZATION = 10;

/**
 * Queue outcome for a capacity-constrained delivery channel: how much of demand
 * is delivered (rationing when demand exceeds capacity) and the resulting wait,
 * which rises convexly and blows up as utilization nears the ceiling. Shared by
 * the private sectors and the public delivery system.
 */
export function queueOutcome(
  demand: number,
  capacity: number,
  baseWaitWeeks: number,
): { utilization: number; deliveredFraction: number; waitWeeks: number } {
  // No demand: nothing to queue for. No capacity but some demand: nothing is
  // delivered. Both cases stay finite so results never carry Infinity.
  if (demand <= 0) return { utilization: 0, deliveredFraction: 1, waitWeeks: 0 };
  if (capacity <= 0) return { utilization: MAX_REPORTED_UTILIZATION, deliveredFraction: 0, waitWeeks: PARAMS.maxWaitWeeks };
  const utilization = Math.min(MAX_REPORTED_UTILIZATION, demand / capacity);
  const deliveredFraction = demand > capacity ? capacity / demand : 1;
  const rho = Math.min(utilization, PARAMS.waitCeiling - 0.05);
  const waitWeeks = Math.min(PARAMS.maxWaitWeeks, (baseWaitWeeks * (rho * rho)) / (PARAMS.waitCeiling - rho));
  return { utilization, deliveredFraction, waitWeeks };
}

function newSector(id: SectorId): SectorState {
  const cfg = PARAMS.providerSectors[id];
  return {
    id,
    capacity: 0,
    baselineCapacity: 0,
    firms: cfg.initialFirms,
    expectedDemand: 0,
    pipeline: Array.from({ length: cfg.entryLagYears }, () => ({ capacity: 0, firms: 0 })),
  };
}

export function createProviderState(): ProviderState {
  return {
    hospital: newSector("hospital"),
    physician: newSector("physician"),
    initialized: false,
    baselineTotalDemand: 0,
  };
}

/**
 * On the first year, seed each sector's capacity to its realized demand divided
 * by the target utilization, so the baseline sits at a known, stable operating
 * point, and record baseline total demand (private + public) for sizing the
 * public delivery system. Idempotent after the first call.
 */
export function ensureCapacity(
  state: ProviderState,
  demand: Record<SectorId, number>,
  publicProvisionDemand = 0,
): void {
  if (state.initialized) return;
  for (const id of SECTOR_IDS) {
    const cap = demand[id] / PARAMS.targetUtilization;
    state[id].capacity = cap;
    state[id].baselineCapacity = cap;
    state[id].expectedDemand = demand[id];
  }
  state.baselineTotalDemand = demand.hospital + demand.physician + publicProvisionDemand;
  state.initialized = true;
}

export function hhiOf(firms: number): number {
  return 10_000 / firms;
}

export interface SectorClearing {
  commercialPriceIndex: number;
  publicPriceIndex: number;
  deliveredFraction: number;
  waitWeeks: number;
  utilization: number;
  hhi: number;
}

/**
 * Clear one sector for the year given realized demand: set the commercial
 * price index (rising with concentration and capacity tightness, capped by
 * any all-payer rate setting), ration delivery if demand exceeds capacity,
 * and compute the resulting wait time.
 */
export function clearSector(sector: SectorState, demand: number, policy: Policy): SectorClearing {
  const hhi = hhiOf(sector.firms);
  const hhi0 = hhiOf(PARAMS.providerSectors[sector.id].initialFirms);
  const { utilization, deliveredFraction, waitWeeks } = queueOutcome(
    demand,
    sector.capacity,
    PARAMS.providerSectors[sector.id].baseWaitWeeks,
  );

  // Commercial price: markup rises with concentration and with capacity
  // tightness, divided by insurer counter-leverage. Capacity slack does not
  // push prices below baseline (the max(1, ...) term).
  const concentration = Math.pow(hhi / hhi0, PARAMS.hhiPriceElasticity);
  const tightness = Math.pow(Math.max(1, utilization / PARAMS.targetUtilization), PARAMS.utilPriceElasticity);
  let commercialPriceIndex = (concentration * tightness) / PARAMS.insurerLeverage;
  if (policy.priceCapIndex !== null) {
    commercialPriceIndex = Math.min(commercialPriceIndex, policy.priceCapIndex);
  }
  commercialPriceIndex = Math.max(PARAMS.priceIndexFloor, commercialPriceIndex);

  // Administered public price (rate setting caps it too, since "all-payer").
  let publicPriceIndex = policy.publicPriceRatio;
  if (policy.priceCapIndex !== null) publicPriceIndex = Math.min(publicPriceIndex, policy.priceCapIndex);
  publicPriceIndex = Math.max(PARAMS.priceIndexFloor, publicPriceIndex);

  return { commercialPriceIndex, publicPriceIndex, deliveredFraction, waitWeeks, utilization, hhi };
}

/** What a sector learned this year, which drives its decisions for the next. */
export interface SectorSignals {
  /** Blended operating margin across all payers. */
  margin: number;
  /** Care demanded this year, before any rationing. */
  demand: number;
  /** Share of the sector's revenue that came from commercial payers (0 under single payer). */
  commercialShare: number;
  /** The commercial price index charged this year (after any price cap). */
  commercialPriceIndex: number;
}

/**
 * The proportional revenue gain a sector would get from one more merger: the
 * commercial price rise from having one fewer competitor (zero where a price
 * cap already binds), times the share of revenue that commercial payers
 * provide. Zero when prices are administered — there is nothing to gain.
 */
export function mergerGain(firms: number, signals: SectorSignals, policy: Policy): number {
  if (firms <= PARAMS.minFirms || signals.commercialShare <= 0 || signals.commercialPriceIndex <= 0) return 0;
  const after = Math.max(PARAMS.minFirms, firms - 1);
  let newPrice = signals.commercialPriceIndex * Math.pow(firms / after, PARAMS.hhiPriceElasticity);
  if (policy.priceCapIndex !== null) newPrice = Math.min(newPrice, policy.priceCapIndex);
  const priceGain = Math.max(0, newPrice / signals.commercialPriceIndex - 1);
  return signals.commercialShare * priceGain;
}

const pctOf = (x: number, base: number): number => Math.round((x / base) * 100);
const pct1Of = (x: number, base: number): number => Math.round((x / base) * 1000) / 10;
/** Supply changes smaller than this share of baseline capacity are not worth a narrative event. */
const NOTABLE = 0.005;

/**
 * Evolve a sector once the year's results are known.
 *
 *  • Supply follows demand. Providers plan for expected demand at the target
 *    utilization and commit to close part of any gap each year, on top of
 *    replacing capacity that retires. New capacity arrives after the sector's
 *    lag. Two policy gates sit on this: Certificate of Need blocks a share of
 *    new hospital capacity (replacement is exempt), and residency slots cap
 *    how many new physicians can enter training each year. Providers invest
 *    only if it pays: below `investMargin` they scale back, and at a zero
 *    margin they stop even replacing what retires.
 *  • Fat margins additionally pull in new firms (entry), which re-fragments a
 *    consolidated market.
 *  • Negative margins force immediate exit.
 *  • Mergers are proposed for the revenue they would bring (`mergerGain`),
 *    more urgently in distress, and antitrust review decides whether they
 *    go through. `draws` are this sector-year's two uniform random numbers
 *    (proposal, review); they are drawn every year whether or not they are
 *    used, so the merger process never shifts any other random draw.
 *
 * A sector with no patients (`active` false — all care has moved to a public
 * delivery system) is dormant: it has no margin or demand to react to, so
 * nothing is built, exits, or merges.
 */
export function updateSector(
  sector: SectorState,
  signals: SectorSignals,
  policy: Policy,
  draws: { propose: number; review: number },
  year: number,
  active = true,
): ExplanationEvent[] {
  const events: ExplanationEvent[] = [];
  const cfg = PARAMS.providerSectors[sector.id];
  const capacityPerFirm = sector.baselineCapacity / cfg.initialFirms;
  const isHospital = sector.id === "hospital";
  const label = isHospital ? "Hospital" : "Physician";
  const floor = PARAMS.capacityFloorFraction * sector.baselineCapacity;
  const { margin } = signals;

  if (!active) {
    advancePipeline(sector, floor);
    return events;
  }

  // ---- Supply: replacement + demand-driven expansion + profit-pull entry. ----
  sector.expectedDemand =
    (1 - PARAMS.demandExpectationWeight) * sector.expectedDemand + PARAMS.demandExpectationWeight * signals.demand;
  const pending = sector.pipeline.reduce((sum, slot) => sum + slot.capacity, 0);
  const gap = sector.expectedDemand / PARAMS.targetUtilization - sector.capacity - pending;
  const replacement = cfg.attritionRate * sector.capacity;
  const profitPull =
    margin > PARAMS.entryMargin ? PARAMS.entryRate * (margin - PARAMS.entryMargin) * sector.baselineCapacity : 0;
  // What providers would start building or training this year if nothing stood in the way.
  const desired = Math.max(0, replacement + PARAMS.supplyAdjustRate * gap + profitPull);

  // Policy gates.
  let allowed: number;
  if (cfg.trainingCapRate === null) {
    // Certificate of Need: replacement goes ahead, a share of new capacity is refused.
    const expansion = Math.max(0, desired - replacement);
    allowed = Math.min(desired, replacement) + expansion * (1 - Math.min(1, Math.max(0, policy.certificateOfNeed)));
  } else {
    // Residency slots: a ceiling on how many can enter training in a year.
    allowed = Math.min(desired, cfg.trainingCapRate * Math.max(0, policy.residencySlots) * sector.baselineCapacity);
  }
  const blocked = desired - allowed;

  // Willingness to invest at this margin.
  const willingness = Math.min(1, Math.max(0, margin / PARAMS.investMargin));
  const started = allowed * willingness;
  const net = started - replacement;

  // New firms come with the profit-pull share of any net expansion.
  const expansionWanted = Math.max(0, desired - replacement);
  const entrantShare = expansionWanted > 0 ? Math.min(1, profitPull / expansionWanted) : 0;
  const newFirms = net > 0 ? (net * entrantShare) / capacityPerFirm : 0;

  const slot = sector.pipeline[sector.pipeline.length - 1]!;
  slot.capacity += net;
  slot.firms += newFirms;

  const lagWord = isHospital ? "construction" : "training";
  if (newFirms > 0) {
    events.push({
      year,
      module: "provider",
      type: "provider-entry",
      data: {
        sector: sector.id,
        marginPct: Math.round(margin * 100),
        lagYears: cfg.entryLagYears,
        capacityAddedPct: pctOf(net, sector.baselineCapacity),
      },
      narrative:
        `${label} margins of ${Math.round(margin * 100)}% are drawing new entrants, but the capacity ` +
        `won't come online for ${cfg.entryLagYears} years (${lagWord} lag).`,
    });
  } else if (net >= 0.01 * sector.baselineCapacity && sector.expectedDemand > (PARAMS.targetUtilization + 0.01) * sector.capacity) {
    events.push({
      year,
      module: "provider",
      type: "capacity-expansion",
      data: {
        sector: sector.id,
        capacityAddedPct: pct1Of(net, sector.baselineCapacity),
        lagYears: cfg.entryLagYears,
        demandVsCapacityPct: pctOf(sector.expectedDemand, sector.capacity),
      },
      narrative:
        `${label}s expect demand at ${pctOf(sector.expectedDemand, sector.capacity)}% of their capacity, above the ` +
        `${Math.round(PARAMS.targetUtilization * 100)}% they plan for. They committed to expand capacity by ` +
        `${pct1Of(net, sector.baselineCapacity)}%, arriving in ${cfg.entryLagYears} years (${lagWord} lag).`,
    });
  }
  // A gate matters only for capacity providers would actually have started.
  const blockedInvestment = blocked * willingness;
  if (blockedInvestment >= NOTABLE * sector.baselineCapacity) {
    events.push({
      year,
      module: "provider",
      type: "supply-gate",
      data: {
        sector: sector.id,
        wantedPct: pct1Of(desired, sector.baselineCapacity),
        allowedPct: pct1Of(allowed, sector.baselineCapacity),
      },
      narrative: isHospital
        ? `Certificate of Need review refused new hospital capacity worth ${pct1Of(blocked, sector.baselineCapacity)}% of the sector — expansion that demand called for will not be built.`
        : `Residency slots are full. Training can admit new physicians worth ${pct1Of(allowed, sector.baselineCapacity)}% of the workforce a year ` +
          `(about ${pct1Of(replacement, sector.baselineCapacity)}% just replaces those retiring), but demand called for ${pct1Of(desired, sector.baselineCapacity)}%.`,
    });
  }
  // Losses are reported by the exit event below; this covers thin but positive margins.
  if (margin >= PARAMS.exitMargin && allowed - started >= NOTABLE * sector.baselineCapacity) {
    events.push({
      year,
      module: "provider",
      type: "underinvestment",
      data: { sector: sector.id, marginPct: Math.round(margin * 100), forgonePct: pctOf(allowed - started, sector.baselineCapacity) },
      narrative:
        `At a margin of ${Math.round(margin * 100)}%, ${label.toLowerCase()}s are not ${net < 0 ? "replacing capacity that retires" : "expanding as demand calls for"} ` +
        `— payment rates do not justify the investment, so capacity will ${net < 0 ? "shrink" : "lag demand"} in ${cfg.entryLagYears} years.`,
    });
  }

  // ---- Exit: losses close capacity (and firms) immediately. ----
  if (margin < PARAMS.exitMargin) {
    const removed = Math.min(
      sector.capacity - floor,
      PARAMS.exitRate * (PARAMS.exitMargin - margin) * sector.capacity,
    );
    if (removed > 0) {
      sector.capacity -= removed;
      sector.firms = Math.max(PARAMS.minFirms, sector.firms - removed / capacityPerFirm);
      events.push({
        year,
        module: "provider",
        type: "provider-exit",
        data: {
          sector: sector.id,
          marginPct: Math.round(margin * 100),
          capacityRemovedPct: pctOf(removed, sector.baselineCapacity),
        },
        narrative:
          `${label}s are losing money (margin ${Math.round(margin * 100)}%); ${pctOf(removed, sector.baselineCapacity)}% ` +
          `of baseline capacity has exited the market, tightening access.`,
      });
    }
  }

  // ---- Mergers: proposed for the revenue they would bring. ----
  const gain = mergerGain(sector.firms, signals, policy);
  const distressed = margin < PARAMS.mergerMargin;
  const propensity =
    1 - Math.exp(-PARAMS.mergerGainSensitivity * gain * (distressed ? PARAMS.distressMergerUrgency : 1));
  if (draws.propose < propensity) {
    if (draws.review > policy.antitrustStringency) {
      const priceGainPct = Math.round((gain / signals.commercialShare) * 100);
      sector.firms = Math.max(PARAMS.minFirms, sector.firms - 1);
      events.push({
        year,
        module: "provider",
        type: "merger-approved",
        data: {
          sector: sector.id,
          firms: Math.round(sector.firms),
          hhi: Math.round(hhiOf(sector.firms)),
          distressed: distressed ? 1 : 0,
          expectedPriceGainPct: priceGainPct,
        },
        narrative:
          `Two ${label.toLowerCase()}s merged${distressed ? " under margin pressure" : ""} ` +
          `(now ~${Math.round(sector.firms)} firms, HHI ${Math.round(hhiOf(sector.firms)).toLocaleString()}). ` +
          `With one fewer competitor they can raise commercial prices about ${priceGainPct}% next year.`,
      });
    } else {
      events.push({
        year,
        module: "provider",
        type: "merger-blocked",
        data: { sector: sector.id, antitrust: Math.round(policy.antitrustStringency * 100) },
        narrative: `Antitrust regulators blocked a proposed ${label.toLowerCase()} merger, preserving competition.`,
      });
    }
  }

  advancePipeline(sector, floor);
  return events;
}

/** This year's arrivals (or net retirements) take effect; the pipeline moves up a year. */
function advancePipeline(sector: SectorState, floor: number): void {
  const arriving = sector.pipeline.shift()!;
  sector.capacity = Math.max(Math.min(floor, sector.capacity), sector.capacity + arriving.capacity);
  sector.firms += arriving.firms;
  sector.pipeline.push({ capacity: 0, firms: 0 });
}

export function snapshot(
  sector: SectorState,
  clearing: SectorClearing,
  margin: number,
  active: boolean,
  avgPricePaid: number,
): SectorSnapshot {
  return {
    active,
    firms: sector.firms,
    hhi: clearing.hhi,
    capacity: sector.capacity,
    pipelineCapacity: sector.pipeline.reduce((sum, slot) => sum + slot.capacity, 0),
    utilization: clearing.utilization,
    commercialPriceIndex: clearing.commercialPriceIndex,
    avgPricePaid,
    waitWeeks: clearing.waitWeeks,
    margin,
    deliveredFraction: clearing.deliveredFraction,
  };
}
