import { PARAMS } from "./params.ts";
import { PUBLIC_PLAN, TIER_BY_ID, oopFor, type PlanTier, type TierId } from "./plans.ts";
import { mulberry32, categorical } from "./rng.ts";
import { generatePopulation, agePopulation, expectedCost } from "./population.ts";
import { chooseCoverage, type ChoiceResult } from "./choice.ts";
import { realizedSpend, adequateSpend } from "./utilization.ts";
import { seedPremiums, updatePremiums, emptyExperience, type PoolExperience } from "./insurer.ts";
import { buildEsiContext, setEmployerOffers, tierAv } from "./employer.ts";
import {
  createProviderState,
  ensureCapacity,
  clearSector,
  updateSector,
  snapshot,
  queueOutcome,
  type SectorClearing,
} from "./provider.ts";
import type {
  CoverageCounts,
  CoverageKind,
  ExplanationEvent,
  Household,
  SimConfig,
  SimResult,
  YearResult,
} from "./types.ts";

function pct(x: number): number {
  return Math.round(x * 1000) / 10;
}

/** Cost-sharing the household faces given its chosen coverage. */
function planFor(coverage: CoverageKind, tier: TierId | null): PlanTier | null {
  switch (coverage) {
    case "uninsured":
      return null;
    case "public":
      return PUBLIC_PLAN;
    case "esi":
    case "individual":
      return TIER_BY_ID[tier!];
  }
}

/**
 * Advance one household's health stock. Innovation raises the health return on
 * care (recovery scales with the index) and slows age-related decline
 * (depreciation shrinks as the index rises above 1); at index 1.0 this reduces
 * to the static dynamics.
 */
function updateHealthStock(h: Household, gap: number, innovationIndex: number): void {
  const innoDep = Math.max(0.5, Math.min(1.5, 2 - innovationIndex));
  const depreciation =
    (PARAMS.healthDepreciation + PARAMS.healthDepreciationAgeSlope * (h.age - 45)) * innoDep;
  const recovery = PARAMS.healthRecovery * innovationIndex;
  h.healthStock = Math.min(
    1,
    Math.max(
      0.2,
      h.healthStock + recovery * (1 - gap) * (1 - h.healthStock) - depreciation - PARAMS.unmetNeedHealthPenalty * gap,
    ),
  );
}

/** Single-payer choice: everyone is in the public plan, no premium. */
const SINGLE_PAYER_CHOICE: ChoiceResult = {
  coverage: "public",
  tier: null,
  subsidyUsed: 0,
  premiumPaid: 0,
};

/** Per-household intermediate state carried from the demand pass to the billing pass. */
interface HouseholdYear {
  h: Household;
  choice: ChoiceResult;
  mu: number;
  shockMult: number;
  /** Care quantity demanded (baseline-price units); split by sector for private care, or total for public-provision users. */
  qHosp: number;
  qPhys: number;
  /** Whether this household's care is delivered through the government-run system. */
  usesPublicProvision: boolean;
  /** Total care quantity demanded (used for public-provision users). */
  q: number;
  adequate: number;
}

export function runSimulation(config: SimConfig): SimResult {
  const rng = mulberry32(config.seed);
  const pop = generatePopulation(rng, config.populationSize);
  let nextId = config.populationSize;

  let premiums = seedPremiums(pop);
  let lastExperience: PoolExperience | null = null;
  let prevCoverage: CoverageCounts | null = null;
  let prevPriceIndex = 1; // households' adaptive expectation of provider prices
  const seedSilver = premiums.silver;

  const providers = createProviderState();
  let innovationIndex = 1; // emergent medical-technology stock, carried across years
  const years: YearResult[] = [];

  for (let year = 0; year < config.years; year++) {
    const events: ExplanationEvent[] = [];

    // 1. Insurers post this year's individual-market premiums from last year's claims.
    if (lastExperience) {
      const updated = updatePremiums(premiums, lastExperience, year, config.policy.riskAdjustment);
      premiums = updated.premiums;
      events.push(...updated.events);
    }

    // 2. Employers decide whether (and how generously) to offer ESI, using a
    // representative-worker valuation at the prevailing provider prices.
    let muTotal = 0;
    let raTotal = 0;
    let incomeTotal = 0;
    for (const h of pop) {
      muTotal += expectedCost(h);
      raTotal += h.riskAversion;
      incomeTotal += h.income;
    }
    const esiCtx = buildEsiContext(
      muTotal / pop.length,
      raTotal / pop.length,
      incomeTotal / pop.length,
      prevPriceIndex,
    );
    setEmployerOffers(pop, esiCtx, config.policy);
    let offeredCount = 0;
    let offeredPremiumTotal = 0;
    let offeredAvTotal = 0;
    for (const h of pop) {
      if (h.esiOffer) {
        offeredCount++;
        offeredPremiumTotal += h.esiOffer.premium;
        offeredAvTotal += tierAv(h.esiOffer.tier);
      }
    }

    // ---- Demand pass: choose coverage, realize shocks, compute care demand. ----
    const hasPublicProvision = config.policy.publicProvisionLevel > 0;
    const records: HouseholdYear[] = [];
    let demandHosp = 0;
    let demandPhys = 0;
    let publicProvisionDemand = 0;
    for (const h of pop) {
      const choice = config.policy.singlePayer
        ? SINGLE_PAYER_CHOICE
        : chooseCoverage(
            h,
            {
              premiums,
              policy: config.policy,
              expectedPriceIndex: prevPriceIndex,
            },
            rng,
          );
      h.coverage = choice.coverage;
      h.tier = choice.tier;

      const mu = expectedCost(h);
      const shockMult = PARAMS.shockMults[categorical(rng, PARAMS.shockProbs)]!;

      // Public-program enrollees and the uninsured use the government delivery
      // system where one exists (the uninsured thereby gain real access). Care
      // there is free at the point of use, so demand reflects near-zero
      // cost-sharing rather than their nominal plan.
      const usesPublicProvision =
        hasPublicProvision && (choice.coverage === "public" || choice.coverage === "uninsured");
      const coinsurance = usesPublicProvision
        ? PUBLIC_PLAN.coinsurance
        : planFor(choice.coverage, choice.tier)?.coinsurance ?? 1.0;
      const q = realizedSpend(mu, shockMult, coinsurance);

      let qHosp = 0;
      let qPhys = 0;
      if (usesPublicProvision) {
        publicProvisionDemand += q;
      } else {
        qHosp = PARAMS.hospitalShareOfCare * q;
        qPhys = q - qHosp;
        demandHosp += qHosp;
        demandPhys += qPhys;
      }
      records.push({
        h,
        choice,
        mu,
        shockMult,
        qHosp,
        qPhys,
        usesPublicProvision,
        q,
        adequate: adequateSpend(mu, shockMult),
      });
    }

    // ---- Provider markets clear: private prices/queues, and the public system. ----
    ensureCapacity(providers, { hospital: demandHosp, physician: demandPhys }, publicProvisionDemand);
    const clearH = clearSector(providers.hospital, demandHosp, config.policy);
    const clearP = clearSector(providers.physician, demandPhys, config.policy);
    const publicCapacity = config.policy.publicProvisionLevel * providers.baselineTotalDemand;
    const clearPub = queueOutcome(
      publicProvisionDemand,
      publicCapacity,
      PARAMS.publicProvisionBaseWaitWeeks,
    );

    // ---- Billing pass: dollars, payment splits, provider margins, health. ----
    const experience = emptyExperience();
    const coverage: CoverageCounts = { esi: 0, individual: 0, public: 0, uninsured: 0 };
    const enrollmentByTier: Record<TierId, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
    let individualRiskTotal = 0;
    let medical = 0;
    let uncompensated = 0;
    let publicClaims = 0;
    let individualClaims = 0;
    let individualPremiumsGross = 0;
    let esiClaims = 0;
    let esiGrossPremium = 0; // full group premiums of enrolled workers
    let esiTaxExpenditure = 0; // forgone tax revenue on those premiums
    let esiWorkerCostTotal = 0; // wage incidence borne by enrollees
    let subsidyOutlays = 0;
    let penaltyRevenue = 0;
    let publicProvisionOutlays = 0;
    let publicProvisionDelivered = 0; // care quantity delivered by the public system
    let totalCareDelivered = 0; // all delivered care quantity (for the public-share metric)
    let commercialSpend = 0; // ESI + individual payments — the pool that funds R&D
    let oopBurdenTotal = 0;
    let totalIncome = 0;
    let healthStockTotal = 0;
    let unmetCount = 0;
    const revenue = { hospital: 0, physician: 0 };
    const cost = { hospital: 0, physician: 0 };
    const uninsuredByIncome: number[] = [];
    const incomes: number[] = [];

    for (const rec of records) {
      const { h, choice, mu, shockMult } = rec;

      // ---- Public delivery system: free at point of use, funded by the budget. ----
      if (rec.usesPublicProvision) {
        const delivered = rec.q * clearPub.deliveredFraction;
        const opCost = delivered * PARAMS.publicProvisionUnitCost;
        publicProvisionOutlays += opCost;
        publicProvisionDelivered += delivered;
        totalCareDelivered += delivered;
        medical += opCost;
        coverage[choice.coverage]++;
        oopBurdenTotal += 0; // free at the point of use; no premium for public/uninsured
        totalIncome += h.income;
        incomes.push(h.income);
        uninsuredByIncome.push(choice.coverage === "uninsured" ? 1 : 0);
        if (choice.coverage === "uninsured") penaltyRevenue += config.policy.mandatePenalty;

        const gapQuantity = rec.adequate > 0 ? Math.max(0, (rec.adequate - delivered) / rec.adequate) : 0;
        const waitGap = Math.min(0.6, clearPub.waitWeeks * PARAMS.waitToForgone);
        const gap = Math.min(1, gapQuantity + waitGap);
        if (gap > PARAMS.unmetNeedThreshold) unmetCount++;
        updateHealthStock(h, gap, innovationIndex);
        healthStockTotal += h.healthStock;
        continue;
      }

      const plan = planFor(choice.coverage, choice.tier);
      const isPublic = choice.coverage === "public";

      const priceHosp = isPublic ? clearH.publicPriceIndex : clearH.commercialPriceIndex;
      const pricePhys = isPublic ? clearP.publicPriceIndex : clearP.commercialPriceIndex;
      const deliveredQHosp = rec.qHosp * clearH.deliveredFraction;
      const deliveredQPhys = rec.qPhys * clearP.deliveredFraction;
      const billHosp = deliveredQHosp * priceHosp;
      const billPhys = deliveredQPhys * pricePhys;
      const bill = billHosp + billPhys;
      const deliveredQuantity = deliveredQHosp + deliveredQPhys;

      let oop: number;
      let claims: number;
      let collectedFraction: number; // share of the bill the provider actually collects
      if (plan === null) {
        // Uninsured: pay full price out of pocket up to an income cap; the rest
        // is uncompensated care the provider eats.
        oop = Math.min(bill, PARAMS.uninsuredOopIncomeCap * h.income);
        claims = 0;
        uncompensated += bill - oop;
        collectedFraction = bill > 0 ? oop / bill : 0;
        penaltyRevenue += config.policy.mandatePenalty;
      } else {
        oop = oopFor(plan, bill);
        claims = bill - oop;
        collectedFraction = 1;
        if (isPublic) publicClaims += claims;
        else if (choice.coverage === "esi") {
          esiClaims += claims;
          commercialSpend += bill;
          const offer = h.esiOffer!;
          esiGrossPremium += offer.premium;
          esiTaxExpenditure += offer.taxSubsidy;
          esiWorkerCostTotal += offer.workerCost;
        } else {
          const tier = TIER_BY_ID[choice.tier!];
          experience.claimsByTier[tier.id] += claims;
          experience.enrollmentByTier[tier.id]++;
          enrollmentByTier[tier.id]++;
          individualClaims += claims;
          individualPremiumsGross += choice.premiumPaid + choice.subsidyUsed;
          subsidyOutlays += choice.subsidyUsed;
          individualRiskTotal += mu;
          commercialSpend += bill;
        }
      }

      revenue.hospital += billHosp * collectedFraction;
      revenue.physician += billPhys * collectedFraction;
      cost.hospital += deliveredQHosp * PARAMS.providerMarginalCost;
      cost.physician += deliveredQPhys * PARAMS.providerMarginalCost;

      coverage[choice.coverage]++;
      medical += bill;
      totalCareDelivered += deliveredQuantity;
      oopBurdenTotal += (oop + choice.premiumPaid) / h.income;
      totalIncome += h.income;
      incomes.push(h.income);
      uninsuredByIncome.push(choice.coverage === "uninsured" ? 1 : 0);

      // Health stock: the gap between adequate care and what was actually
      // delivered (cost-sharing + rationing) plus a wait-time access penalty.
      const q = rec.qHosp + rec.qPhys;
      const gapQuantity = rec.adequate > 0 ? Math.max(0, (rec.adequate - deliveredQuantity) / rec.adequate) : 0;
      const waitGap =
        q > 0
          ? (rec.qHosp / q) * Math.min(0.6, clearH.waitWeeks * PARAMS.waitToForgone) +
            (rec.qPhys / q) * Math.min(0.6, clearP.waitWeeks * PARAMS.waitToForgone)
          : 0;
      const gap = Math.min(1, gapQuantity + waitGap);
      if (gap > PARAMS.unmetNeedThreshold) unmetCount++;
      updateHealthStock(h, gap, innovationIndex);
      healthStockTotal += h.healthStock;
    }

    experience.poolAvgRisk =
      coverage.individual > 0 ? individualRiskTotal / coverage.individual : 0;

    // ---- Provider dynamics: entry/exit/mergers from this year's margins. ----
    const marginHosp = revenue.hospital > 0 ? (revenue.hospital - cost.hospital) / revenue.hospital : 0;
    const marginPhys = revenue.physician > 0 ? (revenue.physician - cost.physician) / revenue.physician : 0;
    const snapHosp = snapshot(providers.hospital, clearH, marginHosp);
    const snapPhys = snapshot(providers.physician, clearP, marginPhys);
    events.push(...emitProviderEvents(year, "hospital", clearH, snapHosp, prevYear(years)?.providers.hospital));
    events.push(...emitProviderEvents(year, "physician", clearP, snapPhys, prevYear(years)?.providers.physician));
    events.push(...updateSector(providers.hospital, marginHosp, config.policy, rng, year));
    events.push(...updateSector(providers.physician, marginPhys, config.policy, rng, year));

    // ---- Innovation: R&D funded by commercial revenue + provider margins. ----
    const avgMargin = (marginHosp + marginPhys) / 2;
    const rdSignal = (commercialSpend / pop.length) * (1 + PARAMS.innovationMarginBonus * Math.max(0, avgMargin));
    const rdRelative = rdSignal / PARAMS.innovationRdReference;
    const rdIntensity = Math.max(
      PARAMS.innovationIntensityMin,
      Math.min(PARAMS.innovationIntensityMax, PARAMS.innovationRdFloor + (1 - PARAMS.innovationRdFloor) * rdRelative),
    );
    const innovationThisYear = innovationIndex; // the level that shaped this year's health
    innovationIndex = innovationIndex * (1 + PARAMS.innovationBaseGrowth * rdIntensity);

    // ---- Ledgers. ----
    const adminIndividual = Math.max(0, individualPremiumsGross - individualClaims);
    const adminEsi = Math.max(0, esiGrossPremium - esiClaims);
    const adminPublic = PARAMS.publicLoad * publicClaims;
    const admin = adminIndividual + adminEsi + adminPublic;
    const nhe = medical + admin;
    const gdp = totalIncome / PARAMS.laborShareOfGdp;

    const publicOutlays = publicClaims * (1 + PARAMS.publicLoad);
    // The ESI tax exclusion is forgone revenue that must be raised elsewhere —
    // so it carries the same marginal cost of public funds as direct outlays.
    // Direct provision (running public hospitals/clinics) is funded the same way.
    const revenueRequired = Math.max(
      0,
      subsidyOutlays + publicOutlays + publicProvisionOutlays + esiTaxExpenditure - penaltyRevenue,
    );
    const deadweightLoss = (PARAMS.marginalCostOfFunds - 1) * revenueRequired;

    // Distributional lens: uninsured rate by income tercile.
    const sorted = [...incomes].sort((a, b) => a - b);
    const t1 = sorted[Math.floor(sorted.length / 3)]!;
    const t2 = sorted[Math.floor((2 * sorted.length) / 3)]!;
    const bucket = {
      low: { uninsured: 0, n: 0 },
      mid: { uninsured: 0, n: 0 },
      high: { uninsured: 0, n: 0 },
    };
    for (let i = 0; i < incomes.length; i++) {
      const b = incomes[i]! <= t1 ? bucket.low : incomes[i]! <= t2 ? bucket.mid : bucket.high;
      b.uninsured += uninsuredByIncome[i]!;
      b.n++;
    }
    const uninsuredRateByIncome = {
      low: bucket.low.uninsured / Math.max(1, bucket.low.n),
      mid: bucket.mid.uninsured / Math.max(1, bucket.mid.n),
      high: bucket.high.uninsured / Math.max(1, bucket.high.n),
    };

    const insuredRate = 1 - coverage.uninsured / pop.length;

    // ---- Narrative events: coverage flows, fiscal ledger, market collapse. ----
    if (prevCoverage) {
      const delta = coverage.uninsured - prevCoverage.uninsured;
      if (Math.abs(delta) >= pop.length * 0.01) {
        events.push({
          year,
          module: "coverage",
          type: "uninsured-shift",
          data: { delta, uninsured: coverage.uninsured, insuredRate: pct(insuredRate) },
          narrative:
            `${Math.abs(delta).toLocaleString()} households ${delta > 0 ? "lost or dropped" : "gained"} coverage this year; ` +
            `the insured rate is now ${pct(insuredRate)}%.`,
        });
      }
    }
    if (
      !config.policy.singlePayer &&
      coverage.individual < pop.length * 0.005 &&
      premiums.silver > 2 * seedSilver
    ) {
      events.push({
        year,
        module: "market",
        type: "individual-market-collapse",
        data: { enrollment: coverage.individual, silverPremium: Math.round(premiums.silver) },
        narrative:
          `The individual market has effectively collapsed: only ${coverage.individual} enrollees remain ` +
          `and silver premiums have reached $${Math.round(premiums.silver).toLocaleString()} — ` +
          `an adverse-selection death spiral.`,
      });
    }
    if (hasPublicProvision && publicProvisionDelivered > 0) {
      const careShare = totalCareDelivered > 0 ? publicProvisionDelivered / totalCareDelivered : 0;
      events.push({
        year,
        module: "government",
        type: "public-provision",
        data: {
          careSharePct: Math.round(careShare * 100),
          utilizationPct: Math.round(clearPub.utilization * 100),
          waitWeeks: Math.round(clearPub.waitWeeks),
        },
        narrative:
          `The public delivery system handled ${Math.round(careShare * 100)}% of all care at ` +
          `${Math.round(clearPub.utilization * 100)}% of its capacity` +
          (clearPub.waitWeeks > 6
            ? `, with waits of ~${Math.round(clearPub.waitWeeks)} weeks — it is underfunded relative to demand.`
            : `, with short waits (~${Math.round(clearPub.waitWeeks)} weeks).`),
      });
    }
    if (revenueRequired > 0) {
      events.push({
        year,
        module: "government",
        type: "fiscal-ledger",
        data: {
          subsidies: Math.round(subsidyOutlays),
          publicOutlays: Math.round(publicOutlays),
          publicProvisionOutlays: Math.round(publicProvisionOutlays),
          deadweightLoss: Math.round(deadweightLoss),
        },
        narrative:
          `Government spent $${Math.round((subsidyOutlays + publicOutlays + publicProvisionOutlays) / 1e6)}M ` +
          `(subsidies + public coverage${publicProvisionOutlays > 0 ? " + running public clinics/hospitals" : ""}); ` +
          `raising that revenue cost society an additional $${Math.round(deadweightLoss / 1e6)}M in deadweight loss.`,
      });
    }

    years.push({
      year,
      coverage: { ...coverage },
      insuredRate,
      uninsuredRateByIncome,
      premiums: { ...premiums },
      individualPoolAvgRisk: experience.poolAvgRisk,
      individualEnrollmentByTier: { ...enrollmentByTier },
      spending: {
        medical,
        admin,
        nhe,
        nhePerCapita: nhe / pop.length,
        nheShareOfGdp: (nhe / gdp) * PARAMS.nheDisplayScale,
        uncompensatedCare: uncompensated,
        meanOopBurden: oopBurdenTotal / pop.length,
      },
      government: {
        subsidyOutlays,
        publicOutlays,
        publicProvisionOutlays,
        penaltyRevenue,
        esiTaxExpenditure,
        revenueRequired,
        deadweightLoss,
        totalSocialCost: revenueRequired + deadweightLoss,
      },
      publicProvision: hasPublicProvision
        ? {
            careShare: totalCareDelivered > 0 ? publicProvisionDelivered / totalCareDelivered : 0,
            utilization: clearPub.utilization,
            waitWeeks: clearPub.waitWeeks,
            deliveredFraction: clearPub.deliveredFraction,
          }
        : null,
      health: {
        meanHealthStock: healthStockTotal / pop.length,
        unmetNeedRate: unmetCount / pop.length,
      },
      innovation: {
        index: innovationThisYear,
        rdIntensity,
      },
      employer: {
        offerRate: offeredCount / pop.length,
        avgPremium: offeredCount > 0 ? offeredPremiumTotal / offeredCount : 0,
        avgActuarialValue: offeredCount > 0 ? offeredAvTotal / offeredCount : 0,
        wageIncidencePerEnrollee: coverage.esi > 0 ? esiWorkerCostTotal / coverage.esi : 0,
      },
      providers: { hospital: snapHosp, physician: snapPhys },
      events,
    });

    // Blended commercial price index becomes next year's household expectation.
    const totalDemand = demandHosp + demandPhys;
    prevPriceIndex =
      totalDemand > 0
        ? (demandHosp * clearH.commercialPriceIndex + demandPhys * clearP.commercialPriceIndex) / totalDemand
        : 1;
    lastExperience = experience;
    prevCoverage = coverage;

    nextId = agePopulation(rng, pop, nextId);
  }

  return { config, years };
}

function prevYear(years: YearResult[]): YearResult | undefined {
  return years[years.length - 1];
}

/** Emit price-spike and wait-time narrative events by comparing to last year. */
function emitProviderEvents(
  year: number,
  sectorId: "hospital" | "physician",
  clearing: SectorClearing,
  snap: { commercialPriceIndex: number; waitWeeks: number; hhi: number },
  prev: { commercialPriceIndex: number; waitWeeks: number } | undefined,
): ExplanationEvent[] {
  const events: ExplanationEvent[] = [];
  const label = sectorId === "hospital" ? "Hospital" : "Physician";
  if (prev) {
    const priceChange = snap.commercialPriceIndex / prev.commercialPriceIndex - 1;
    if (Math.abs(priceChange) > 0.05) {
      events.push({
        year,
        module: "provider",
        type: "price-change",
        data: {
          sector: sectorId,
          changePct: Math.round(priceChange * 100),
          priceIndex: Math.round(snap.commercialPriceIndex * 100) / 100,
          hhi: Math.round(snap.hhi),
        },
        narrative:
          `${label} commercial prices ${priceChange > 0 ? "rose" : "fell"} ${Math.abs(Math.round(priceChange * 100))}% ` +
          `(index ${snap.commercialPriceIndex.toFixed(2)}), tracking market concentration (HHI ${Math.round(snap.hhi).toLocaleString()}) and capacity pressure.`,
      });
    }
    if (snap.waitWeeks > 6 && snap.waitWeeks > prev.waitWeeks * 1.25) {
      events.push({
        year,
        module: "provider",
        type: "wait-times",
        data: { sector: sectorId, waitWeeks: Math.round(snap.waitWeeks), utilization: Math.round(clearing.utilization * 100) },
        narrative:
          `${label} wait times have climbed to ~${Math.round(snap.waitWeeks)} weeks as demand ` +
          `(${Math.round(clearing.utilization * 100)}% of capacity) outpaces supply — rationing by queue.`,
      });
    }
  }
  return events;
}
