import { PARAMS } from "./params.ts";
import { PUBLIC_PLAN, TIER_BY_ID, oopFor, type PlanTier, type TierId } from "./plans.ts";
import { mulberry32, hashUniform, categoricalFrom, DRAW } from "./rng.ts";
import { generatePopulation, agePopulation, expectedCost, taxLiability } from "./population.ts";
import { chooseCoverage, type ChoiceResult } from "./choice.ts";
import { realizedSpend, adequateSpend } from "./utilization.ts";
import { seedPremiums, updatePremiums, emptyExperience, type PoolExperience } from "./insurer.ts";
import { buildEsiContext, setEmployerOffers, clearEmployerOffers, tierAv } from "./employer.ts";
import { policyForYear, describeChanges } from "./reform.ts";
import { FINANCING } from "./financing.ts";
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
  HealthBurden,
  Household,
  SimConfig,
  SimResult,
  YearResult,
} from "./types.ts";

function pct(x: number): number {
  return Math.round(x * 1000) / 10;
}

/** Format a national-scale dollar amount for narrative text. */
function fmtDollars(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e12) return `$${(x / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `$${Math.round(x / 1e9)} billion`;
  return `$${Math.round(x / 1e6)} million`;
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
  // Three independent sources of randomness, so nothing a policy does can
  // reshuffle anyone's luck:
  //  • `rng` builds the population and its yearly new entrants (who ages out
  //    never depends on policy);
  //  • each household's health shock and choice noise are looked up by
  //    (seed, household, year), see rng.ts;
  //  • the provider market has its own stream with a fixed number of draws a year.
  const rng = mulberry32(config.seed);
  const providerRng = mulberry32((config.seed ^ 0x9e3779b9) >>> 0);
  const pop = generatePopulation(rng, config.populationSize);
  let nextId = config.populationSize;

  let premiums = seedPremiums(pop);
  let lastExperience: PoolExperience | null = null;
  let prevCoverage: CoverageCounts | null = null;
  let prevPriceIndex = 1; // households' adaptive expectation of provider prices
  let prevEsiTakeup: number = PARAMS.esiInitialTakeup; // share of offered workers who enrolled last year
  let prevWageOffset: number | null = null; // last wage offset reported in a narrative event
  let prevOfferRate: number | null = null;
  let prevRdIntensity: number | null = null; // last R&D intensity reported in a narrative event
  // What the government was raising for health in the last year before the
  // reform. Revenue up to this keeps coming from general revenue; the reform's
  // financing choice applies to anything above it. (Zero when the policy
  // applies from year 0: then all revenue is raised the chosen way.)
  let preReformRevenue = 0;
  const seedSilver = premiums.silver;

  const providers = createProviderState();
  let innovationIndex = 1; // emergent medical-technology stock, carried across years
  const years: YearResult[] = [];

  // Reform timeline (only when the run starts under a prior policy).
  const reformStart = config.priorPolicy ? (config.reformYear ?? 0) : -1;
  const phaseIn = Math.max(0, Math.round(config.phaseInYears ?? 0));
  const reformChanges = config.priorPolicy ? describeChanges(config.priorPolicy, config.policy) : [];
  // Sample dollars → national dollars, so narrative text matches the dashboard.
  const national = PARAMS.displayPopulation / config.populationSize;

  for (let year = 0; year < config.years; year++) {
    const events: ExplanationEvent[] = [];
    const { policy, progress: reformProgress } = policyForYear(config, year);

    if (reformChanges.length > 0 && year === reformStart) {
      events.push({
        year,
        module: "policy",
        type: "reform-begins",
        data: { changes: reformChanges.length, phaseInYears: phaseIn },
        narrative:
          (phaseIn > 0
            ? `The reform begins and phases in over ${phaseIn} year${phaseIn === 1 ? "" : "s"}: dials move gradually, and on/off changes take effect in year ${reformStart + phaseIn}. `
            : `The reform takes effect this year. `) + `What changes — ${reformChanges.join("; ")}.`,
      });
    }
    if (reformChanges.length > 0 && phaseIn > 0 && year === reformStart + phaseIn) {
      events.push({
        year,
        module: "policy",
        type: "reform-complete",
        data: { phaseInYears: phaseIn },
        narrative: `The reform is now fully in force.`,
      });
    }

    // 1. Insurers post this year's individual-market premiums from last year's claims.
    if (lastExperience) {
      const updated = updatePremiums(premiums, lastExperience, year, policy.riskAdjustment);
      premiums = updated.premiums;
      // Posted premiums are moot in a year with no private insurance market.
      if (!policy.singlePayer) events.push(...updated.events);
    }

    // 2. Employers decide whether (and how generously) to offer ESI, using a
    // representative-worker valuation at the prevailing provider prices. Under
    // single payer there is no employer coverage to offer.
    let offeredCount = 0;
    let offeredPremiumTotal = 0;
    let offeredAvTotal = 0;
    if (policy.singlePayer) {
      clearEmployerOffers(pop);
    } else {
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
      setEmployerOffers(pop, esiCtx, policy, prevEsiTakeup);
      for (const h of pop) {
        if (h.esiOffer) {
          offeredCount++;
          offeredPremiumTotal += h.esiOffer.premium;
          offeredAvTotal += tierAv(h.esiOffer.tier);
        }
      }
    }

    // ---- Demand pass: choose coverage, realize shocks, compute care demand. ----
    const hasPublicProvision = policy.publicProvisionLevel > 0;
    const records: HouseholdYear[] = [];
    let demandHosp = 0;
    let demandPhys = 0;
    let publicProvisionDemand = 0;
    for (const h of pop) {
      const choice = policy.singlePayer
        ? SINGLE_PAYER_CHOICE
        : chooseCoverage(
            h,
            {
              premiums,
              policy,
              expectedPriceIndex: prevPriceIndex,
              seed: config.seed,
              year,
            },
          );
      h.coverage = choice.coverage;
      h.tier = choice.tier;

      const mu = expectedCost(h);
      const shockMult =
        PARAMS.shockMults[categoricalFrom(hashUniform(config.seed, h.id, year, DRAW.shock), PARAMS.shockProbs)]!;

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
    const clearH = clearSector(providers.hospital, demandHosp, policy);
    const clearP = clearSector(providers.physician, demandPhys, policy);
    const publicCapacity = policy.publicProvisionLevel * providers.baselineTotalDemand;
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
    let esiWorkerCostTotal = 0; // employee premium shares paid by enrollees
    let wageOffsetTotal = 0; // cash wages given up at offering firms
    let subsidyOutlays = 0;
    let penaltyRevenue = 0;
    let publicProvisionOutlays = 0;
    let publicProvisionDelivered = 0; // care quantity delivered by the public system
    let totalCareDelivered = 0; // all delivered care quantity (for the public-share metric)
    let commercialSpend = 0; // ESI + individual payments — the pool that funds R&D
    let oopBurdenTotal = 0;
    let totalIncome = 0;
    let healthStockTotal = 0;
    let careGapTotal = 0;
    const revenue = { hospital: 0, physician: 0 };
    const commercialRevenue = { hospital: 0, physician: 0 };
    const cost = { hospital: 0, physician: 0 };
    const deliveredPrivate = { hospital: 0, physician: 0 };
    const uninsuredByIncome: number[] = [];
    const incomes: number[] = [];
    // What each household paid this year, by channel (same order as `incomes`).
    const instrument = FINANCING[policy.financing];
    const paid: { outOfPocket: number; premiums: number; wages: number; taxBill: number; newBase: number }[] = [];

    for (const rec of records) {
      const { h, choice, mu, shockMult } = rec;
      // Wages given up to the employer's premium contributions are part of
      // what the household pays for health care.
      const wageOffset = h.income - h.cashIncome;
      wageOffsetTotal += wageOffset;

      // ---- Public delivery system: free at point of use, funded by the budget. ----
      if (rec.usesPublicProvision) {
        const delivered = rec.q * clearPub.deliveredFraction;
        const opCost = delivered * PARAMS.publicProvisionUnitCost;
        publicProvisionOutlays += opCost;
        publicProvisionDelivered += delivered;
        totalCareDelivered += delivered;
        medical += opCost;
        coverage[choice.coverage]++;
        oopBurdenTotal += wageOffset / h.income; // free at the point of use; no premium for public/uninsured
        totalIncome += h.income;
        incomes.push(h.income);
        uninsuredByIncome.push(choice.coverage === "uninsured" ? 1 : 0);
        if (choice.coverage === "uninsured") penaltyRevenue += policy.mandatePenalty;
        paid.push({
          outOfPocket: 0,
          premiums: choice.coverage === "uninsured" ? policy.mandatePenalty : 0,
          wages: wageOffset,
          taxBill: taxLiability(h.cashIncome),
          newBase: instrument.base(h.cashIncome),
        });

        const gapQuantity = rec.adequate > 0 ? Math.max(0, (rec.adequate - delivered) / rec.adequate) : 0;
        const waitGap = Math.min(0.6, clearPub.waitWeeks * PARAMS.waitToForgone);
        const gap = Math.min(1, gapQuantity + waitGap);
        careGapTotal += gap;
        updateHealthStock(h, gap, innovationIndex);
        healthStockTotal += h.healthStock;
        continue;
      }

      const plan = planFor(choice.coverage, choice.tier);
      const isPublic = choice.coverage === "public";

      // Public programs pay the administered rate; individual-market plans pay a
      // discount off the commercial price (narrower networks); employer plans
      // and the uninsured face the commercial price.
      const network = choice.coverage === "individual" ? PARAMS.individualPriceRatio : 1;
      const priceHosp = isPublic ? clearH.publicPriceIndex : clearH.commercialPriceIndex * network;
      const pricePhys = isPublic ? clearP.publicPriceIndex : clearP.commercialPriceIndex * network;
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
        oop = Math.min(bill, PARAMS.uninsuredOopIncomeCap * h.cashIncome);
        claims = 0;
        uncompensated += bill - oop;
        collectedFraction = bill > 0 ? oop / bill : 0;
        penaltyRevenue += policy.mandatePenalty;
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
      if (choice.coverage === "esi" || choice.coverage === "individual") {
        commercialRevenue.hospital += billHosp;
        commercialRevenue.physician += billPhys;
      }
      cost.hospital += deliveredQHosp * PARAMS.providerMarginalCost;
      cost.physician += deliveredQPhys * PARAMS.providerMarginalCost;
      deliveredPrivate.hospital += deliveredQHosp;
      deliveredPrivate.physician += deliveredQPhys;

      coverage[choice.coverage]++;
      medical += bill;
      totalCareDelivered += deliveredQuantity;
      oopBurdenTotal += (oop + choice.premiumPaid + wageOffset) / h.income;
      totalIncome += h.income;
      incomes.push(h.income);
      uninsuredByIncome.push(choice.coverage === "uninsured" ? 1 : 0);
      // An enrolled worker's tax break covers both halves of the premium: the
      // employee share (already netted out of `premiumPaid`) and the employer's
      // contribution, which is netted out of the wages given up.
      let wagesPaid = wageOffset;
      if (choice.coverage === "esi") {
        const offer = h.esiOffer!;
        const breakOnOwnShare = PARAMS.esiWorkerShare * offer.premium - offer.workerCost;
        wagesPaid -= offer.taxSubsidy - breakOnOwnShare;
      }
      paid.push({
        outOfPocket: oop,
        premiums: choice.premiumPaid + (plan === null ? policy.mandatePenalty : 0),
        wages: wagesPaid,
        taxBill: taxLiability(h.cashIncome),
        newBase: instrument.base(h.cashIncome),
      });

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
      careGapTotal += gap;
      updateHealthStock(h, gap, innovationIndex);
      healthStockTotal += h.healthStock;
    }

    experience.poolAvgRisk =
      coverage.individual > 0 ? individualRiskTotal / coverage.individual : 0;

    // ---- Provider dynamics: entry/exit/mergers from this year's margins. ----
    // A private sector nobody used this year (all care in the public delivery
    // system) is dormant: no margin, no price anyone paid, no dynamics.
    const activeHosp = demandHosp > 0;
    const activePhys = demandPhys > 0;
    const marginHosp = revenue.hospital > 0 ? (revenue.hospital - cost.hospital) / revenue.hospital : 0;
    const marginPhys = revenue.physician > 0 ? (revenue.physician - cost.physician) / revenue.physician : 0;
    const paidHosp = deliveredPrivate.hospital > 0 ? revenue.hospital / deliveredPrivate.hospital : 0;
    const paidPhys = deliveredPrivate.physician > 0 ? revenue.physician / deliveredPrivate.physician : 0;
    const snapHosp = snapshot(providers.hospital, clearH, marginHosp, activeHosp, paidHosp);
    const snapPhys = snapshot(providers.physician, clearP, marginPhys, activePhys, paidPhys);
    const commercialPayers = commercialSpend > 0;
    events.push(...emitProviderEvents(year, "hospital", clearH, snapHosp, prevYear(years)?.providers.hospital, commercialPayers));
    events.push(...emitProviderEvents(year, "physician", clearP, snapPhys, prevYear(years)?.providers.physician, commercialPayers));
    const signalsHosp = {
      margin: marginHosp,
      demand: demandHosp,
      commercialShare: revenue.hospital > 0 ? commercialRevenue.hospital / revenue.hospital : 0,
      commercialPriceIndex: clearH.commercialPriceIndex,
    };
    const signalsPhys = {
      margin: marginPhys,
      demand: demandPhys,
      commercialShare: revenue.physician > 0 ? commercialRevenue.physician / revenue.physician : 0,
      commercialPriceIndex: clearP.commercialPriceIndex,
    };
    const drawsHosp = { propose: providerRng(), review: providerRng() };
    const drawsPhys = { propose: providerRng(), review: providerRng() };
    events.push(...updateSector(providers.hospital, signalsHosp, policy, drawsHosp, year, activeHosp));
    events.push(...updateSector(providers.physician, signalsPhys, policy, drawsPhys, year, activePhys));

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
    // Financing: revenue up to the pre-reform level comes from general revenue;
    // the rest is raised with the reform's instrument, at that instrument's cost.
    if (reformStart >= 0 && year < reformStart) preReformRevenue = revenueRequired;
    const newRevenue = policy.financing === "general" ? 0 : Math.max(0, revenueRequired - preReformRevenue);
    const generalRevenue = revenueRequired - newRevenue;
    const dragGeneral = (PARAMS.marginalCostOfFunds - 1) * generalRevenue;
    const dragNew = (instrument.costOfFunds - 1) * newRevenue;
    const deadweightLoss = dragGeneral + dragNew;

    // Distributional lens: uninsured rate by income tercile.
    const sorted = [...incomes].sort((a, b) => a - b);
    const t1 = sorted[Math.floor(sorted.length / 3)]!;
    const t2 = sorted[Math.floor((2 * sorted.length) / 3)]!;
    const newBucket = () => ({ uninsured: 0, n: 0, income: 0, outOfPocket: 0, premiums: 0, wages: 0, taxBill: 0, newBase: 0 });
    const bucket = { low: newBucket(), mid: newBucket(), high: newBucket() };
    for (let i = 0; i < incomes.length; i++) {
      const b = incomes[i]! <= t1 ? bucket.low : incomes[i]! <= t2 ? bucket.mid : bucket.high;
      const p = paid[i]!;
      b.uninsured += uninsuredByIncome[i]!;
      b.n++;
      b.income += incomes[i]!;
      b.outOfPocket += p.outOfPocket;
      b.premiums += p.premiums;
      b.wages += p.wages;
      b.taxBill += p.taxBill;
      b.newBase += p.newBase;
    }
    // Who pays: general revenue (and the drag of raising it) is shared out in
    // proportion to each household's tax bill; new revenue in proportion to the
    // base of the instrument the reform chose.
    const allBuckets = [bucket.low, bucket.mid, bucket.high];
    const totalTaxBill = allBuckets.reduce((sum, b) => sum + b.taxBill, 0);
    const totalNewBase = allBuckets.reduce((sum, b) => sum + b.newBase, 0);
    const burdenOf = (groups: (typeof bucket.low)[]): HealthBurden => {
      const sum = (read: (b: typeof bucket.low) => number) => groups.reduce((total, b) => total + read(b), 0);
      const n = Math.max(1, sum((b) => b.n));
      const taxShare = totalTaxBill > 0 ? sum((b) => b.taxBill) / totalTaxBill : 0;
      const newShare = totalNewBase > 0 ? sum((b) => b.newBase) / totalNewBase : 0;
      return {
        income: sum((b) => b.income) / n,
        outOfPocket: sum((b) => b.outOfPocket) / n,
        premiums: sum((b) => b.premiums) / n,
        wages: sum((b) => b.wages) / n,
        taxes: (taxShare * generalRevenue + newShare * newRevenue) / n,
        drag: (taxShare * dragGeneral + newShare * dragNew) / n,
      };
    };
    const burden = {
      low: burdenOf([bucket.low]),
      mid: burdenOf([bucket.mid]),
      high: burdenOf([bucket.high]),
      all: burdenOf(allBuckets),
    };
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
          data: { deltaPct: pct(delta / pop.length), insuredRate: pct(insuredRate) },
          narrative:
            `${pct(Math.abs(delta) / pop.length)}% of households ${delta > 0 ? "lost or dropped" : "gained"} coverage this year; ` +
            `the insured rate is now ${pct(insuredRate)}%.`,
        });
      }
    }
    if (
      !policy.singlePayer &&
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
    // Employer offers: report a move of three points or more.
    const offerRate = offeredCount / pop.length;
    if (prevOfferRate !== null && Math.abs(offerRate - prevOfferRate) >= 0.03) {
      const fell = offerRate < prevOfferRate;
      events.push({
        year,
        module: "employer",
        type: "offer-shift",
        data: { offerRatePct: pct(offerRate), previousPct: pct(prevOfferRate) },
        narrative: policy.singlePayer
          ? `Employer coverage ended: under single payer there is nothing for firms to offer.`
          : `The share of workers offered employer coverage ${fell ? "fell" : "rose"} from ${pct(prevOfferRate)}% to ${pct(offerRate)}%` +
            (policy.employerMandate && !fell
              ? `, because the employer mandate requires every firm to offer.`
              : fell
                ? `: for more firms, mostly small ones, the value of offering no longer covers its cost.`
                : `: offering now pays for more firms.`),
      });
    }
    prevOfferRate = offerRate;

    // Innovation: report a move of 15% or more in R&D intensity.
    if (prevRdIntensity === null) prevRdIntensity = rdIntensity;
    else if (Math.abs(rdIntensity / prevRdIntensity - 1) >= 0.15) {
      const fell = rdIntensity < prevRdIntensity;
      events.push({
        year,
        module: "market",
        type: "innovation-shift",
        data: { rdIntensity: Math.round(rdIntensity * 100) / 100, previous: Math.round(prevRdIntensity * 100) / 100 },
        narrative:
          `R&D intensity ${fell ? "fell" : "rose"} from ${prevRdIntensity.toFixed(2)}× to ${rdIntensity.toFixed(2)}×. ` +
          (commercialSpend <= 0
            ? `With no commercial revenue, only the public and spillover floor still funds new treatments, so the innovation index grows more slowly from here.`
            : `It tracks commercial revenue and provider margins, which ${fell ? "shrank" : "grew"}; the innovation index will grow ${fell ? "more slowly" : "faster"}.`),
      });
      prevRdIntensity = rdIntensity;
    }

    // Wage pass-through: say so in the first year, when it moves by 5% or
    // more, and when employer coverage ends.
    const wageOffsetPerOffered = offeredCount > 0 ? wageOffsetTotal / offeredCount : 0;
    if (offeredCount > 0 && (prevWageOffset === null || prevWageOffset === 0 || Math.abs(wageOffsetPerOffered / prevWageOffset - 1) >= 0.05)) {
      const direction =
        prevWageOffset === null || prevWageOffset === 0 ? "" : wageOffsetPerOffered > prevWageOffset ? ", up from" : ", down from";
      events.push({
        year,
        module: "employer",
        type: "wage-offset",
        data: { wageOffset: Math.round(wageOffsetPerOffered), offerRatePct: pct(offeredCount / pop.length) },
        narrative:
          `Employer coverage is paid for out of wages: workers at firms that offer it take home about ` +
          `$${Math.round(wageOffsetPerOffered).toLocaleString()} a year less than their work earns, the employer's share of premiums` +
          (direction ? `${direction} $${Math.round(prevWageOffset!).toLocaleString()}.` : `.`),
      });
      prevWageOffset = wageOffsetPerOffered;
    } else if (offeredCount === 0 && prevWageOffset !== null && prevWageOffset > 0) {
      events.push({
        year,
        module: "employer",
        type: "wage-offset",
        data: { wageOffset: 0, offerRatePct: 0 },
        narrative:
          `With no employer coverage, the roughly $${Math.round(prevWageOffset).toLocaleString()} a year that offering firms held back ` +
          `from each worker's pay for premiums returns to wages. Households now pay for coverage through taxes instead; ` +
          `the “Who pays” chart shows the net effect by income.`,
      });
      prevWageOffset = 0;
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
      // Reported at national scale (same scaling as the dashboard tiles).
      const parts = [
        ["premium subsidies", subsidyOutlays],
        ["public insurance", publicOutlays],
        ["direct provision", publicProvisionOutlays],
        ["the ESI tax break", esiTaxExpenditure],
      ] as const;
      const breakdown = parts
        .filter(([, v]) => v > 0)
        .map(([label, v]) => `${label} ${fmtDollars(v * national)}`)
        .join(", ");
      events.push({
        year,
        module: "government",
        type: "fiscal-ledger",
        data: {
          subsidies: Math.round(subsidyOutlays * national),
          publicOutlays: Math.round(publicOutlays * national),
          publicProvisionOutlays: Math.round(publicProvisionOutlays * national),
          esiTaxExpenditure: Math.round(esiTaxExpenditure * national),
          deadweightLoss: Math.round(deadweightLoss * national),
        },
        narrative:
          `Government health costs came to ${fmtDollars(revenueRequired * national)} (${breakdown}` +
          `${penaltyRevenue > 0 ? `, less ${fmtDollars(penaltyRevenue * national)} in mandate penalties` : ""}); ` +
          `raising that revenue cost society a further ${fmtDollars(deadweightLoss * national)} in deadweight loss.` +
          (newRevenue > 0
            ? ` Of the total, ${fmtDollars(newRevenue * national)} is new revenue, raised by ${instrument.phrase}; ` +
              `each dollar raised that way costs society ${Math.round((instrument.costOfFunds - 1) * 100)} cents in lost output.`
            : ""),
      });
    }

    years.push({
      year,
      policy: { ...policy },
      reformProgress,
      coverage: { ...coverage },
      insuredRate,
      uninsuredRateByIncome,
      burden,
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
        newRevenue,
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
        careGap: careGapTotal / pop.length,
      },
      innovation: {
        index: innovationThisYear,
        rdIntensity,
      },
      employer: {
        offerRate,
        avgPremium: offeredCount > 0 ? offeredPremiumTotal / offeredCount : 0,
        avgActuarialValue: offeredCount > 0 ? offeredAvTotal / offeredCount : 0,
        employeeSharePerEnrollee: coverage.esi > 0 ? esiWorkerCostTotal / coverage.esi : 0,
        wageOffsetPerOfferedWorker: wageOffsetPerOffered,
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
    if (offeredCount > 0) prevEsiTakeup = coverage.esi / offeredCount;

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
  snap: { active: boolean; commercialPriceIndex: number; waitWeeks: number; hhi: number },
  prev: { active: boolean; commercialPriceIndex: number; waitWeeks: number } | undefined,
  commercialPayers: boolean,
): ExplanationEvent[] {
  const events: ExplanationEvent[] = [];
  const label = sectorId === "hospital" ? "Hospital" : "Physician";
  if (prev && prev.active && snap.active) {
    const priceChange = snap.commercialPriceIndex / prev.commercialPriceIndex - 1;
    // Commercial prices only matter in years when someone pays them.
    if (commercialPayers && Math.abs(priceChange) > 0.05) {
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
