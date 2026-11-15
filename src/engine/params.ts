/**
 * Calibration constants for the stylized 2024-ish US baseline (nonelderly
 * adult market). These are teaching-model parameters: chosen so qualitative
 * behavior matches the canonical literature (see DESIGN.md §8), not fitted to
 * microdata. Every constant here is a candidate for the instructor-facing
 * "model assumptions" page.
 */
export const PARAMS = {
  // ---- Population synthesis ----
  /** Median household income (lognormal location). */
  incomeMedian: 48_000,
  /** Lognormal sigma for income dispersion. */
  incomeSigma: 0.72,
  /** Age range simulated (under-26 on parents' plans and 65+ Medicare are abstracted out). */
  ageMin: 26,
  ageMax: 64,
  /** Poverty-line proxy for a household (eligibility/subsidy schedules scale off this). */
  povertyLine: 15_000,

  // ---- Health risk ----
  /** Mean expected annual morbidity cost for a median-age, median-frailty household (nonelderly-adult realistic). */
  baseAnnualCost: 4_700,
  /**
   * Flat accident/injury risk component of expected cost, independent of
   * health status — the reason even the healthiest household values
   * catastrophic coverage.
   */
  accidentRiskCost: 1_500,
  /** Frailty dispersion (lognormal sigma). Drives the 5%-of-people-50%-of-spend skew. */
  frailtySigma: 1.15,
  /** Expected cost grows by this factor per year of age. */
  ageCostGrowth: 1.025,
  /** How much a depleted health stock inflates expected cost (1 + k * (1 - stock)). */
  riskFromPoorHealth: 1.5,

  // ---- Annual health shock distribution (discrete, multipliers on expected cost) ----
  shockProbs: [0.3, 0.4, 0.2, 0.08, 0.02],
  shockMults: [0.1, 0.56, 1.6, 3.3, 8.0],

  // ---- Utilization / moral hazard ----
  /**
   * Demand responds to the effective coinsurance rate c as (c/cRef)^(-eps).
   * eps calibrated so free care raises spending ~40% over full-price care
   * (RAND HIE arc elasticity ≈ -0.2 ⇒ ~25-30% cut from free care to high
   * cost-sharing).
   */
  demandElasticityExp: 0.12,
  /** Reference coinsurance at which need is defined. */
  refCoinsurance: 0.25,
  /** Floor on effective price (free care still has time costs). */
  minCoinsurance: 0.05,
  /**
   * Households value care forgone below the adequate level at this multiple
   * of its cost when comparing coverage options — being uninsured is not
   * just a financial gamble, it means skipping care you needed.
   */
  forgoneCareValue: 1.2,

  // ---- Risk preferences / choice ----
  /**
   * Mean CARA-style risk-aversion coefficient (CE = E[OOP] + 0.5·r·Var[OOP]).
   * Deliberately high relative to textbook expected-utility values — it
   * stands in for loss aversion and default-following in real take-up
   * behavior.
   */
  riskAversionMean: 2.5e-4,
  riskAversionSigma: 0.5,
  /** Gumbel noise scale ($) on coverage choice — smooths discrete switching. */
  choiceNoise: 400,
  /** Uninsured OOP is capped at this share of income; the remainder is uncompensated care. */
  uninsuredOopIncomeCap: 0.3,
  /**
   * Enrollment hassle: the dollar-equivalent burden of signing up for coverage
   * on your own (forms, renewals, churn, not knowing you qualify). It is
   * `base + max × draw³ × exp(−cash income ÷ incomeScale)`: a persistent
   * household trait, skewed so most households find it minor and a minority
   * find it prohibitive, and heaviest at low incomes. Public coverage carries
   * all of it; individual-market plans carry `individualShare` of it; employer
   * coverage, where the firm does the paperwork, carries none. This is why
   * some people eligible for free coverage stay uninsured. Tuned, with the
   * exposure term below, so that under current law about 11% of the
   * low-income third and 3% of the high-income third are uninsured.
   */
  enrollHassle: { base: 150, max: 10_000, incomeScale: 30_000, individualShare: 0.3 },
  /**
   * Being uninsured costs more the more you have to lose: this share of cash
   * income above `uninsuredExposureFloor` is added to the certainty-equivalent
   * cost of going uninsured (assets at risk, and coverage as a normal good).
   */
  uninsuredIncomeExposure: 0.02,
  uninsuredExposureFloor: 40_000,

  // ---- Employer-sponsored insurance (Phase 3) ----
  /** Stylized marginal income-tax rate by bracket (used for the ESI tax exclusion). */
  taxRateVeryLow: 0.04,
  taxRateVeryLowBracket: 28_000,
  taxRateLow: 0.15,
  taxRateHigh: 0.32,
  taxRateBracket: 90_000,
  /** Combined employer+employee payroll tax rate (FICA) — also shielded by the ESI exclusion. */
  payrollTaxRate: 0.0765,
  /**
   * Firm-size distribution (by share of workers — most workers are at large
   * firms) and the group administrative load each size faces. Small firms bear
   * higher per-capita load; large firms self-insure cheaply. `employees` is
   * illustrative only.
   */
  firmSizes: {
    small: { baseProb: 0.3, adminLoad: 0.22, employees: 20 },
    medium: { baseProb: 0.3, adminLoad: 0.1, employees: 200 },
    large: { baseProb: 0.4, adminLoad: 0.05, employees: 3000 },
  },
  /** How strongly higher household income tilts a worker toward a larger (more-likely-to-offer) firm. */
  firmSizeIncomeTilt: 0.35,
  /**
   * Recruitment value of employer coverage: the effective cost penalty workers
   * face buying equivalent coverage on their own (individual-market load,
   * search/curation/stability costs employer plans spare them), as a fraction
   * of claims. This is what employees *genuinely gain* from ESI beyond the tax
   * break — so a firm that doesn't offer must make it up in wages to recruit.
   * Set above every firm-size admin load, so ESI carries a positive structural
   * (non-tax) value for all sizes → the offer (extensive) margin is sticky and
   * the tax exclusion acts mainly on generosity (intensive margin).
   */
  esiRecruitmentValue: 0.42,
  /** Per-worker fixed administrative/compliance cost of running a plan, by firm size — the real reason the smallest firms abstain (few workers to spread it over). */
  esiFixedCostPerWorker: { small: 2_300, medium: 400, large: 60 },
  /** Std. dev. ($) of idiosyncratic firm-level offer propensity (workforce health, management, local labor market) — smooths the extensive margin so it isn't an all-or-nothing cliff by size. */
  esiOfferDispersion: 1_300,
  /** Employee share of the ESI premium (the salient take-up cost); the rest is employer-paid and comes out of wages. */
  esiWorkerShare: 0.4,
  /**
   * Wage pass-through: an offering firm recovers its premium contributions by
   * paying lower cash wages to its workers. Cash wages cannot be pushed below
   * this floor (a full-time minimum-wage job); whatever cannot be shifted to
   * the worker is a cost the firm bears, which counts against offering.
   */
  minCashWage: 15_000,
  /** Take-up among offered workers that firms assume in year 0, before they have a previous year to go on. */
  esiInitialTakeup: 0.8,
  /** ACA affordability threshold: an ESI offer forfeits exchange-subsidy eligibility only if the employee share is below this fraction of income. */
  esiAffordabilityPct: 0.0985,
  /** Worker's stickiness bonus for the default ESI plan ($ subtracted from the ESI option's certainty-equivalent cost). */
  esiTakeupBonus: 0,

  // ---- Individual market ----
  /** Individual-market administrative load under community rating. */
  individualLoad: 0.18,
  /** Load when medical underwriting is allowed (screening costs, broker commissions — the pre-ACA pattern). */
  underwrittenLoad: 0.32,
  /** Year-0 premium seed uplift over the all-population average (insurers anticipate some selection). */
  seedPremiumUplift: 1.25,
  /** Premium credibility blending: weight on tier-specific experience vs market-wide. */
  tierCredibilityAt: 300, // enrollees at which tier experience gets ~half weight
  /** Cap on year-over-year premium movement (rate-review smoothing). */
  maxPremiumGrowth: 0.5,

  // ---- Public sector ----
  /** Marginal cost of public funds: each $1 of revenue costs society $1.30. */
  marginalCostOfFunds: 1.3,
  /** Public program admin load (lower than private). */
  publicLoad: 0.05,

  // ---- Provider market (Phase 2) ----
  /** Share of care quantity delivered by hospitals (rest by physicians). */
  hospitalShareOfCare: 0.55,
  /** Provider marginal cost per unit of care, relative to baseline commercial price index 1.0 — implies a ~15% baseline commercial margin. */
  providerMarginalCost: 0.85,
  /** Target capacity utilization at baseline (capacity is seeded to demand/this). */
  targetUtilization: 0.85,
  /** Commercial price index elasticity w.r.t. market concentration (HHI ratio). The consolidation lever. */
  hhiPriceElasticity: 0.7,
  /** Commercial price index elasticity w.r.t. capacity tightness (utilization ratio). */
  utilPriceElasticity: 0.5,
  /** Insurer counter-leverage divisor on commercial prices (>1 = strong insurers bargain prices down). */
  insurerLeverage: 1.0,
  /** Floor on any price index (providers cannot be paid arbitrarily little and survive accounting). */
  priceIndexFloor: 0.25,
  /** Default administered public price as a fraction of baseline commercial (Medicare/Medicaid pay below commercial). */
  defaultPublicPriceRatio: 0.6,
  /** Provider blended margin above which NEW FIRMS are drawn in (profit-pull entry, on top of demand-driven expansion). */
  entryMargin: 0.16,
  /** Provider blended margin below which capacity exits the market. */
  exitMargin: 0.0,
  /** Provider blended margin below which a sector is in distress (mergers become more urgent). */
  mergerMargin: 0.05,
  /**
   * Mergers are proposed for the revenue they would bring. The annual
   * probability a sector proposes one is 1 − exp(−sensitivity × gain), where
   * gain is the proportional revenue increase the merger would deliver: the
   * commercial price rise from one fewer competitor × the share of revenue
   * that comes from commercial payers. Calibrated so a 6-firm hospital market
   * under current law proposes a merger about one year in four. Where prices
   * are administered (single payer) or a binding price cap, the gain is zero
   * and so is the merger rate. Antitrust then decides whether it goes through.
   */
  mergerGainSensitivity: 2.4,
  /** Distressed sectors pursue any available merger gain this many times more urgently. */
  distressMergerUrgency: 3,
  /** Fraction of capacity added per year per unit of margin above the entry threshold. */
  entryRate: 0.6,
  /**
   * Demand-following supply: each year providers commit to close this fraction
   * of the gap between the capacity that expected demand calls for
   * (demand ÷ target utilization) and the capacity they have or have already
   * committed. New capacity arrives after the sector's lag.
   */
  supplyAdjustRate: 0.75,
  /** Weight on this year's demand when providers update the demand they plan for (the rest is last year's expectation). */
  demandExpectationWeight: 0.5,
  /** Providers invest fully only when the blended margin is at least this; below it investment scales down, to nothing at a zero margin. */
  investMargin: 0.05,
  /** Fraction of capacity removed per year per unit of margin below the exit threshold. */
  exitRate: 0.25,
  /** Capacity cannot fall below this fraction of its seeded baseline (providers are partly fixed assets). */
  capacityFloorFraction: 0.55,
  /** Per-sector firm-count floor (a market cannot consolidate past this). */
  minFirms: 3,
  /** Per-sector provider configuration: initial firms, entry lag (years), and a base wait-time scale (weeks). */
  /**
   * `attritionRate`: share of capacity that retires or wears out each year and
   * must be replaced just to stand still. `trainingCapRate` (physicians only):
   * the most new physician capacity the training pipeline can admit per year,
   * as a share of baseline capacity, at residency slots = 1.0 — a little above
   * replacement, so the physician workforce can grow about 1.5% a year at most
   * under current law. The residency-slots lever multiplies it.
   */
  providerSectors: {
    hospital: { initialFirms: 6, entryLagYears: 3, baseWaitWeeks: 1.8, attritionRate: 0.02, trainingCapRate: null },
    physician: { initialFirms: 18, entryLagYears: 7, baseWaitWeeks: 2.1, attritionRate: 0.03, trainingCapRate: 0.045 },
  },
  /** Utilization ceiling in the wait-time denominator (waits blow up as utilization approaches it). */
  waitCeiling: 1.4,
  /** Weeks of wait converted into an equivalent forgone-care fraction (access erosion from queues). */
  waitToForgone: 0.008,
  /** Hard cap on reported wait times (weeks). */
  maxWaitWeeks: 52,

  // ---- Government direct provision (VA/NHS-style public delivery) ----
  /**
   * Operating cost per unit of care for the government-run delivery system,
   * relative to the baseline commercial price index (1.0). Set modestly below
   * private marginal cost (no profit margin, bulk purchasing), partly offset by
   * public-sector overhead. Highly stylized / out-of-sample for the US.
   */
  publicProvisionUnitCost: 0.8,
  /** Base wait-time scale (weeks) for the public delivery system's queue. */
  publicProvisionBaseWaitWeeks: 1.8,

  // ---- Innovation (dynamic technological progress) ----
  /**
   * Innovation is an emergent index (starts at 1.0) capturing medical
   * technology. It is funded by the COMMERCIAL system's revenue and provider
   * margins — a well-funded, profitable system develops new treatments — with
   * a public/spillover floor (NIH, global science) so progress never fully
   * stops. Higher innovation raises the health return on care and slows
   * age-related decline; squeezing prices (caps, low single-payer rates,
   * all-public delivery) starves R&D and slows health gains over time. Highly
   * stylized and deliberately US-centric.
   */
  innovationBaseGrowth: 0.02,
  /** Public/spillover R&D floor as a share of the reference level — innovation continues even with no commercial surplus. */
  innovationRdFloor: 0.3,
  /** Reference per-capita commercial R&D signal (baseline system = intensity 1.0). Calibrated to the baseline. */
  innovationRdReference: 6800,
  /** How strongly provider profitability amplifies R&D funding. */
  innovationMarginBonus: 2.0,
  /** Clamp on R&D intensity (keeps innovation growth bounded). */
  innovationIntensityMin: 0.2,
  innovationIntensityMax: 2.2,

  // ---- Health dynamics ----
  /** Annual health-stock depreciation at the median age. */
  healthDepreciation: 0.004,
  /** Additional depreciation per year of age above the median. */
  healthDepreciationAgeSlope: 0.00012,
  /** Health-stock penalty per unit of unmet-need gap. */
  unmetNeedHealthPenalty: 0.05,
  /** Recovery toward full stock when care is adequate. */
  healthRecovery: 0.01,

  // ---- Economy scale ----
  /** GDP proxy = aggregate household income / laborShareOfGdp (tuned so GDP per capita ≈ the US headline ~$83k). */
  laborShareOfGdp: 0.75,
  /**
   * A calibration constant, not a demographic estimate. The sim models
   * nonelderly adults only, and its medical costs per adult run about 25%
   * below the real figure, so the spending share of GDP it produces directly
   * is too low. This factor scales the displayed share so that the first five
   * years of a current-law run average 17.5% of GDP (measured over 20 seeds;
   * see calibration.ts). Everyone else's spending is assumed to move in
   * proportion.
   */
  nheDisplayScale: 1.95,
  /**
   * Population used to scale the simulated sample's dollar totals to a
   * national figure for display (dashboard tiles and narrative text use the
   * same scaling). A legibility device: the sample is nonelderly adults, so
   * these are order-of-magnitude national numbers, not budget estimates.
   */
  displayPopulation: 330_000_000,
} as const;
