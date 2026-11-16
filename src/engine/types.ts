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
  /** The employee's share of the premium, after tax: the salient cost of enrolling. */
  workerCost: number;
  /** The employer's contribution per enrolled worker, which the firm recovers through lower wages. */
  employerContribution: number;
}

export interface Household {
  id: number;
  age: number;
  /** Total annual compensation the worker's labor commands (wages plus any employer premium contribution). Fixed. */
  income: number;
  /**
   * Cash wages this year: total compensation less what the employer recovers
   * for premium contributions. This is the income that eligibility rules,
   * affordability tests and out-of-pocket limits see.
   */
  cashIncome: number;
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
  /** Persistent draw in (0, 1): how much trouble this household has signing up for coverage on its own (see `enrollmentHassle`). */
  hassleDraw: number;
  /** Current-year coverage state. */
  coverage: CoverageKind;
  tier: TierId | null;
}

/**
 * How a reform raises health revenue beyond what the government raised before
 * it: the existing tax mix, a payroll tax, an income tax on high earners, or a
 * flat premium. See financing.ts.
 */
export type Financing = "general" | "payroll" | "topIncome" | "flat";

/** Student-facing policy package: every lever the simulator exposes. */
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

  // ---- Financing ----
  /** How health revenue beyond the pre-reform level is raised. Changes who pays and the deadweight loss; "general" is current law. */
  financing: Financing;
}

export interface SimConfig {
  seed: number;
  populationSize: number;
  /** Total simulated years, including any years before the reform. */
  years: number;
  /** The reform package under study. */
  policy: Policy;
  /**
   * Policy in force before the reform (normally current law). When set, the run
   * starts under it — provider capacity and premiums settle to that system —
   * and `policy` takes over from `reformYear`. When omitted, `policy` applies
   * from year 0 (steady-state mode).
   */
  priorPolicy?: Policy;
  /** Year index in which the reform begins. Only meaningful with `priorPolicy`. Default 0. */
  reformYear?: number;
  /** Years over which the reform phases in (see `policyForYear`). Default 0 = all at once. */
  phaseInYears?: number;
}

/** Premiums posted for the year, by individual-market tier (community-rated). */
export type TierPremiums = Record<TierId, number>;

export interface ExplanationEvent {
  year: number;
  module: "insurer" | "coverage" | "government" | "market" | "provider" | "employer" | "policy";
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

/**
 * What the average household in a group pays toward health care in a year, by
 * channel, in dollars. The four payment channels add up, across everyone, to
 * national health spending (less care that nobody paid for).
 */
export interface HealthBurden {
  /** Mean total compensation of the group: the base for "share of income". */
  income: number;
  /** Paid at the point of care. */
  outOfPocket: number;
  /** Premiums the household pays itself, after any subsidy and after the tax break on its share; plus any mandate penalty. */
  premiums: number;
  /** Cash wages given up because the employer pays toward premiums, net of the tax break on that contribution. */
  wages: number;
  /** The household's share of the taxes that finance government health costs. */
  taxes: number;
  /** Its share of the deadweight loss of raising those taxes: income lost, though not paid to anyone. */
  drag: number;
}

export interface YearResult {
  year: number;
  /** The policy actually in force this year (differs from the reform package before and during a phase-in). */
  policy: Policy;
  /** 0 before the reform, between 0 and 1 during a phase-in, 1 once fully in force. */
  reformProgress: number;
  coverage: CoverageCounts;
  insuredRate: number;
  /** Uninsured rate by income tercile (low/mid/high) — distributional lens. */
  uninsuredRateByIncome: { low: number; mid: number; high: number };
  /**
   * Who pays for health care: average payments per household by channel, for
   * each third of the income distribution and for everyone. Taxes are shared
   * out in proportion to each household's stylized tax bill.
   */
  burden: { low: HealthBurden; mid: HealthBurden; high: HealthBurden; all: HealthBurden };
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
    /** The part of `revenueRequired` raised with the reform's chosen instrument: revenue above the pre-reform level. Zero under general-revenue financing. */
    newRevenue: number;
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
  /** Employer-market state for the year. All zero under single payer, where there is no employer coverage. */
  employer: {
    /** Share of all workers who receive an ESI offer. */
    offerRate: number;
    /** Average full group premium among offered plans. */
    avgPremium: number;
    /** Average actuarial value of offered plans (generosity). */
    avgActuarialValue: number;
    /** Average employee premium share per ESI enrollee, after tax (what workers see deducted). */
    employeeSharePerEnrollee: number;
    /** Average cash wages given up per worker at an offering firm, to pay for the employer's premium contributions. */
    wageOffsetPerOfferedWorker: number;
  };
  health: {
    meanHealthStock: number;
    /**
     * Average share of needed care that households did not receive (0–1):
     * care skipped because of cost-sharing or being uninsured, care rationed
     * when demand exceeds capacity, and the access lost to waiting.
     */
    careGap: number;
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
  /** Whether any patients used this private sector this year (false when all care moved to a public delivery system). */
  active: boolean;
  /** Number of competing firms (continuous; mergers and entry/exit move it). */
  firms: number;
  /** Herfindahl–Hirschman Index (10000/firms under the symmetric-firm stylization). */
  hhi: number;
  /** Annual care capacity (in baseline-price care units). */
  capacity: number;
  /** Net capacity change already committed and on its way (under construction or in training); negative when retirements will outrun replacements. */
  pipelineCapacity: number;
  /** Realized demand/capacity this year. */
  utilization: number;
  /** Commercial price index relative to the baseline (1.0). What private insurers are charged; nobody pays it under single payer. */
  commercialPriceIndex: number;
  /** Average price providers actually collected per unit of care, across all payers (0 when inactive). */
  avgPricePaid: number;
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
