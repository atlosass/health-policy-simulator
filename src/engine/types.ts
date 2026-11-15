import type { TierId } from "./plans.ts";

export type CoverageKind = "esi" | "individual" | "public" | "uninsured";
export type FirmSize = "small" | "medium" | "large";

/** An employer's standing ESI offer to a worker for the year (endogenous, Phase 3). */
export interface EsiOffer {
  tier: TierId;
  /** Full group premium for the offered plan (employer + employee, pre-tax). */
  premium: number;
  /** Forgone tax revenue on the excluded premium — a government tax expenditure. */
  taxSubsidy: number;
  /** What the worker effectively bears (premium net of the tax subsidy), via wages + employee share. */
  workerCost: number;
}

export interface Household {
  id: number;
  age: number;
  income: number;
  /** Persistent multiplicative health-risk factor (lognormal, income-graded). */
  frailty: number;
  /** CARA-style risk-aversion coefficient. */
  riskAversion: number;
  /** Health capital stock in [0.2, 1]. Depletes with age and unmet need. */
  healthStock: number;
  /** Size of the firm the worker is attached to (drives the group admin load). */
  firmSize: FirmSize;
  /** Group administrative load the worker's firm faces (smaller firms → higher). */
  firmAdminLoad: number;
  /** Standard-normal idiosyncratic firm offer-propensity shock (workforce health, management, local labor market). */
  firmOfferShock: number;
  /** This year's employer ESI offer, or null if the firm does not offer. */
  esiOffer: EsiOffer | null;
  /** Idiosyncratic hassle/stigma cost of enrolling in public coverage ($/yr). */
  publicHassleCost: number;
  /** Current-year coverage state. */
  coverage: CoverageKind;
  tier: TierId | null;
}

/**
 * Student-facing policy package (Phase 1 subset — provider and employer
 * levers arrive in Phases 2-3).
 */
export interface Policy {
  /** Community rating on the individual market (vs. full medical underwriting). */
  communityRating: boolean;
  /**
   * Risk adjustment across plan tiers: insurers are compensated for enrolling
   * sicker members, so tiers are priced off the pooled market rather than
   * each tier's own selection-distorted experience. Only meaningful under
   * community rating.
   */
  riskAdjustment: boolean;
  /** Flat annual penalty for going uninsured ($). 0 = no mandate. */
  mandatePenalty: number;
  /** Income-scaled premium subsidies (ACA-style benchmark design). */
  subsidiesEnabled: boolean;
  /** Subsidy eligibility cutoff as a multiple of the poverty line. */
  subsidyCutoffMultiple: number;
  /** Public-insurance eligibility cutoff as a multiple of the poverty line. 0 disables. */
  publicEligibilityMultiple: number;

  // ---- Provider-market levers (Phase 2) ----
  /**
   * Single-payer toggle: every household is enrolled in the public plan,
   * financed by taxation; the ESI and individual markets are switched off.
   */
  singlePayer: boolean;
  /**
   * All-payer rate setting: hard cap on the commercial price index (1.0 = cap
   * at the baseline commercial level; below 1 is aggressive). null = no cap.
   */
  priceCapIndex: number | null;
  /** Administered public price as a fraction of the baseline commercial price (what the government pays *private* providers for public enrollees). */
  publicPriceRatio: number;
  /**
   * Government-operated (VA/NHS-style) delivery capacity, as a multiple of
   * baseline total care demand. 0 = no public provision (public enrollees buy
   * from private providers at the administered price). When > 0, the public
   * delivery system serves public-program enrollees and the uninsured (and
   * everyone under single-payer = the NHS case), free at the point of use,
   * funded from the budget — with its own queue if capacity is short.
   */
  publicProvisionLevel: number;
  /** Merger-review stringency in [0,1]: probability a proposed provider merger is blocked. */
  antitrustStringency: number;
  /** Certificate-of-Need stringency in [0,1]: friction on new hospital capacity (1 = entry frozen). */
  certificateOfNeed: number;
  /** Residency-slot / scope-of-practice multiplier on physician entry (1 = baseline; >1 speeds new supply). */
  residencySlots: number;

  // ---- Employer-market levers (Phase 3) ----
  /** Employer mandate: all firms must offer ESI regardless of whether it pencils out. */
  employerMandate: boolean;
  /** Cap on the premium amount shielded by the tax exclusion ($). null = uncapped (current law). */
  taxExclusionCap: number | null;
}

export interface SimConfig {
  seed: number;
  populationSize: number;
  years: number;
  policy: Policy;
}

/** Premiums posted for the year, by individual-market tier (community-rated). */
export type TierPremiums = Record<TierId, number>;

export interface ExplanationEvent {
  year: number;
  module: "insurer" | "coverage" | "government" | "market" | "provider";
  type: string;
  /** Structured drivers backing the narrative — feeds the drill-down UI. */
  data: Record<string, number | string>;
  narrative: string;
}

export interface CoverageCounts {
  esi: number;
  individual: number;
  public: number;
  uninsured: number;
}

export interface YearResult {
  year: number;
  coverage: CoverageCounts;
  insuredRate: number;
  /** Uninsured rate by income tercile (low/mid/high) — distributional lens. */
  uninsuredRateByIncome: { low: number; mid: number; high: number };
  /** Individual-market posted premiums (community rating) for this year. */
  premiums: TierPremiums;
  /** Average expected cost (risk) of the individual-market pool — selection gauge. */
  individualPoolAvgRisk: number;
  individualEnrollmentByTier: Record<TierId, number>;
  spending: {
    medical: number;
    admin: number;
    nhe: number;
    nhePerCapita: number;
    nheShareOfGdp: number;
    uncompensatedCare: number;
    meanOopBurden: number;
  };
  government: {
    subsidyOutlays: number;
    publicOutlays: number;
    /** Operating cost of the government-run delivery system (direct provision). */
    publicProvisionOutlays: number;
    penaltyRevenue: number;
    /** Forgone income+payroll tax revenue from the ESI exclusion. */
    esiTaxExpenditure: number;
    revenueRequired: number;
    deadweightLoss: number;
    totalSocialCost: number;
  };
  /** Government direct-provision (VA/NHS) state for the year; null when no public delivery system exists. */
  publicProvision: {
    /** Share of all care (by quantity) delivered through the public system. */
    careShare: number;
    utilization: number;
    waitWeeks: number;
    deliveredFraction: number;
  } | null;
  /** Employer-market state for the year. */
  employer: {
    /** Share of all workers who receive an ESI offer. */
    offerRate: number;
    /** Average full group premium among offered plans. */
    avgPremium: number;
    /** Average actuarial value of offered plans (generosity). */
    avgActuarialValue: number;
    /** Average compensation per ESI enrollee diverted into health premiums (wage incidence). */
    wageIncidencePerEnrollee: number;
  };
  health: {
    meanHealthStock: number;
    unmetNeedRate: number;
  };
  /** Emergent medical-technology index (1.0 = start) and the R&D intensity funding it this year. */
  innovation: {
    index: number;
    rdIntensity: number;
  };
  /** Per-sector provider-market state (hospitals and physicians). */
  providers: {
    hospital: SectorSnapshot;
    physician: SectorSnapshot;
  };
  events: ExplanationEvent[];
}

/** Observable provider-sector state for a year — feeds the market-structure dashboard. */
export interface SectorSnapshot {
  /** Number of competing firms (continuous; mergers and entry/exit move it). */
  firms: number;
  /** Herfindahl–Hirschman Index (10000/firms under the symmetric-firm stylization). */
  hhi: number;
  /** Annual care capacity (in baseline-price care units). */
  capacity: number;
  /** Realized demand/capacity this year. */
  utilization: number;
  /** Commercial price index relative to the baseline (1.0). */
  commercialPriceIndex: number;
  /** Mean wait time experienced this year (weeks). */
  waitWeeks: number;
  /** Blended provider operating margin this year. */
  margin: number;
  /** Fraction of demanded care actually delivered (1 = no rationing). */
  deliveredFraction: number;
}

export interface SimResult {
  config: SimConfig;
  years: YearResult[];
}
