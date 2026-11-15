import { PARAMS } from "./params.ts";
import type { Rng } from "./rng.ts";
import type { ExplanationEvent, Policy, SectorSnapshot } from "./types.ts";

export type SectorId = "hospital" | "physician";
export const SECTOR_IDS: readonly SectorId[] = ["hospital", "physician"];

/**
 * Mutable state for one provider sector. Capacity and firm count evolve over
 * time via entry (lagged), exit, and mergers. `firms` is continuous so that
 * gradual entry/exit move the HHI smoothly; mergers move it in discrete steps.
 */
export interface SectorState {
  id: SectorId;
  capacity: number;
  baselineCapacity: number;
  firms: number;
  /** Capacity (and accompanying firms) in the construction/training pipeline, indexed by years-until-arrival − 1. */
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

/**
 * Evolve a sector after the year's margin is known: induce entry (lagged) when
 * margins are fat, force exit when they go negative, and let firms merge under
 * margin pressure (subject to antitrust). Advance the construction/training
 * pipeline. Returns any narrative events.
 *
 * A sector with no patients (`active` false — all care has moved to a public
 * delivery system) is dormant: it has no margin to react to, so nothing
 * enters, exits, or merges.
 */
export function updateSector(
  sector: SectorState,
  margin: number,
  policy: Policy,
  rng: Rng,
  year: number,
  active = true,
): ExplanationEvent[] {
  const events: ExplanationEvent[] = [];
  const cfg = PARAMS.providerSectors[sector.id];
  const capacityPerFirm = sector.baselineCapacity / cfg.initialFirms;
  const label = sector.id === "hospital" ? "Hospital" : "Physician";

  if (!active) {
    const arriving = sector.pipeline.shift()!;
    sector.capacity += arriving.capacity;
    sector.firms += arriving.firms;
    sector.pipeline.push({ capacity: 0, firms: 0 });
    return events;
  }

  // Entry: fat margins attract new capacity, arriving after the sector's lag.
  if (margin > PARAMS.entryMargin) {
    const entryScale =
      sector.id === "hospital" ? 1 - policy.certificateOfNeed : policy.residencySlots;
    const added = PARAMS.entryRate * (margin - PARAMS.entryMargin) * sector.baselineCapacity * Math.max(0, entryScale);
    if (added > 0) {
      const slot = sector.pipeline[sector.pipeline.length - 1]!;
      slot.capacity += added;
      slot.firms += added / capacityPerFirm;
      events.push({
        year,
        module: "provider",
        type: "provider-entry",
        data: {
          sector: sector.id,
          marginPct: Math.round(margin * 100),
          lagYears: cfg.entryLagYears,
          capacityAddedPct: Math.round((added / sector.baselineCapacity) * 100),
        },
        narrative:
          `${label} margins of ${Math.round(margin * 100)}% are drawing new entrants, but the capacity ` +
          `won't come online for ${cfg.entryLagYears} years (${sector.id === "hospital" ? "construction" : "training"} lag).`,
      });
    }
  }

  // Exit: sustained losses shrink capacity (and firm count) immediately.
  if (margin < PARAMS.exitMargin) {
    const floor = PARAMS.capacityFloorFraction * sector.baselineCapacity;
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
          capacityRemovedPct: Math.round((removed / sector.baselineCapacity) * 100),
        },
        narrative:
          `${label}s are losing money (margin ${Math.round(margin * 100)}%); ${Math.round((removed / sector.baselineCapacity) * 100)}% ` +
          `of baseline capacity has exited the market, tightening access.`,
      });
    }
  }

  // Mergers: firms seek market power opportunistically (base propensity), and
  // always try when margins are distressed. Antitrust stringency is what stops
  // them — the policy lever's main channel. Entry (above) is the counter-force.
  const distressed = margin < PARAMS.mergerMargin;
  const propensity = distressed ? 1 : PARAMS.baseMergerPropensity;
  if (sector.firms > PARAMS.minFirms && rng() < propensity) {
    if (rng() > policy.antitrustStringency) {
      sector.firms -= 1;
      events.push({
        year,
        module: "provider",
        type: "merger-approved",
        data: {
          sector: sector.id,
          firms: Math.round(sector.firms),
          hhi: Math.round(hhiOf(sector.firms)),
          distressed: distressed ? 1 : 0,
        },
        narrative:
          `Two ${label.toLowerCase()}s merged${distressed ? " under margin pressure" : ""} ` +
          `(now ~${Math.round(sector.firms)} firms, HHI ${Math.round(hhiOf(sector.firms)).toLocaleString()}).` +
          (policy.singlePayer ? "" : ` Expect commercial prices to rise next year.`),
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

  // Advance the pipeline: this year's arrivals become live capacity.
  const arriving = sector.pipeline.shift()!;
  sector.capacity += arriving.capacity;
  sector.firms += arriving.firms;
  sector.pipeline.push({ capacity: 0, firms: 0 });

  return events;
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
    utilization: clearing.utilization,
    commercialPriceIndex: clearing.commercialPriceIndex,
    avgPricePaid,
    waitWeeks: clearing.waitWeeks,
    margin,
    deliveredFraction: clearing.deliveredFraction,
  };
}
