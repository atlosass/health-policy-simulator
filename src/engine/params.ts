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
  /** Employee share of the ESI premium (the salient take-up cost); the rest is employer-paid and shows up as wage incidence. */
  esiWorkerShare: 0.4,
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
  /** Take-up among the eligible (stigma/awareness frictions). */
  publicTakeup: 0.85,
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
  /** Provider blended margin above which new capacity is induced (entry). */
  entryMargin: 0.16,
  /** Provider blended margin below which capacity exits the market. */
  exitMargin: 0.0,
  /** Provider blended margin below which firms seek mergers out of distress (always propose). */
  mergerMargin: 0.05,
  /**
   * Baseline annual probability that a sector proposes an opportunistic merger
   * (firms seek market power even when healthy). Antitrust stringency is what
   * actually stops these — so this is the channel the antitrust lever acts on.
   */
  baseMergerPropensity: 0.25,
  /** Fraction of capacity added per year per unit of margin above the entry threshold. */
  entryRate: 0.6,
  /** Fraction of capacity removed per year per unit of margin below the exit threshold. */
  exitRate: 0.25,
  /** Capacity cannot fall below this fraction of its seeded baseline (providers are partly fixed assets). */
  capacityFloorFraction: 0.55,
  /** Per-sector firm-count floor (a market cannot consolidate past this). */
  minFirms: 3,
  /** Per-sector provider configuration: initial firms, entry lag (years), and a base wait-time scale (weeks). */
  providerSectors: {
    hospital: { initialFirms: 6, entryLagYears: 3, baseWaitWeeks: 1.8 },
    physician: { initialFirms: 18, entryLagYears: 7, baseWaitWeeks: 2.1 },
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
  /** Unmet-need gap above which a household counts as having unmet need. */
  unmetNeedThreshold: 0.15,

  // ---- Economy scale ----
  /** GDP proxy = aggregate household income / laborShareOfGdp (tuned so GDP per capita ≈ the US headline ~$83k). */
  laborShareOfGdp: 0.75,
  /**
   * The sim models nonelderly adults only; the displayed NHE-share-of-GDP is
   * extrapolated to the full population (elderly + children spending assumed
   * to move proportionally) so the headline matches the familiar ~17.5%.
   * Documented on the model-assumptions page.
   */
  nheDisplayScale: 1.75,
} as const;
