export { runSimulation } from "./simulate.ts";
export { PARAMS } from "./params.ts";
export { TIERS, TIER_BY_ID, PUBLIC_PLAN } from "./plans.ts";
export { policyForYear, describeChanges } from "./reform.ts";
export type * from "./types.ts";
export type { TierId, PlanTier } from "./plans.ts";
import { PARAMS } from "./params.ts";
import type { Policy, SimConfig } from "./types.ts";

/** Provider- and employer-market lever defaults: competitive baseline, no rate setting, no supply frictions, no employer mandate, uncapped tax exclusion (current law). */
const MARKET_DEFAULTS = {
  singlePayer: false,
  priceCapIndex: null,
  publicPriceRatio: PARAMS.defaultPublicPriceRatio,
  antitrustStringency: 0.8,
  certificateOfNeed: 0,
  residencySlots: 1,
  publicProvisionLevel: 0,
  employerMandate: false,
  taxExclusionCap: null,
} satisfies Pick<
  Policy,
  | "singlePayer"
  | "priceCapIndex"
  | "publicPriceRatio"
  | "antitrustStringency"
  | "certificateOfNeed"
  | "residencySlots"
  | "publicProvisionLevel"
  | "employerMandate"
  | "taxExclusionCap"
>;

/**
 * Stylized current-law-ish baseline: community rating with risk adjustment,
 * ARPA-style subsidies with no income cliff (contribution capped as a share
 * of income at every income), no mandate penalty (post-2019),
 * Medicaid-expansion-style public eligibility.
 */
export const BASELINE_POLICY: Policy = {
  communityRating: true,
  riskAdjustment: true,
  mandatePenalty: 0,
  subsidiesEnabled: true,
  subsidyCutoffMultiple: 99,
  publicEligibilityMultiple: 1.38,
  ...MARKET_DEFAULTS,
};

/** Community rating with no take-up supports — the death-spiral configuration (pre-ACA New York pattern). */
export const UNSUPPORTED_COMMUNITY_RATING: Policy = {
  communityRating: true,
  riskAdjustment: false,
  mandatePenalty: 0,
  subsidiesEnabled: false,
  subsidyCutoffMultiple: 0,
  publicEligibilityMultiple: 0,
  ...MARKET_DEFAULTS,
};

/** Fully underwritten individual market, no public programs — the laissez-faire configuration. */
export const UNDERWRITTEN_NO_SUPPORTS: Policy = {
  communityRating: false,
  riskAdjustment: false,
  mandatePenalty: 0,
  subsidiesEnabled: false,
  subsidyCutoffMultiple: 0,
  publicEligibilityMultiple: 0,
  ...MARKET_DEFAULTS,
};

/** Lax antitrust on top of the baseline — invites provider consolidation and rising prices. */
export const LAX_ANTITRUST: Policy = {
  ...BASELINE_POLICY,
  antitrustStringency: 0.3,
};

/**
 * Aggressive all-payer rate setting (commercial prices capped below provider
 * cost) with the baseline coverage architecture — short-run savings, then
 * capacity exit and rising waits.
 */
export const AGGRESSIVE_PRICE_CAPS: Policy = {
  ...BASELINE_POLICY,
  priceCapIndex: 0.8,
};

/** Single payer paying near provider cost — universal coverage, lower admin, large tax bill, modest waits. */
export const SINGLE_PAYER_ADEQUATE: Policy = {
  ...BASELINE_POLICY,
  singlePayer: true,
  publicPriceRatio: 0.9,
};

/** Single payer at low administered rates — universal coverage but provider exit and serious queues. */
export const SINGLE_PAYER_LOW_RATES: Policy = {
  ...BASELINE_POLICY,
  singlePayer: true,
  publicPriceRatio: 0.7,
};

/** Safety-net public clinics on top of the baseline — government delivery for the uninsured and Medicaid enrollees. */
export const SAFETY_NET_CLINICS: Policy = {
  ...BASELINE_POLICY,
  publicProvisionLevel: 0.35,
};

/**
 * NHS-style: single-payer public insurance AND public delivery, well funded.
 * Care that is free at the point of use raises demand roughly 15–20% above
 * today's, so "well funded" means capacity of about 1.35× today's total demand
 * — enough to run near the usual 85–90% utilization.
 */
export const NHS_WELL_FUNDED: Policy = {
  ...BASELINE_POLICY,
  singlePayer: true,
  publicProvisionLevel: 1.35,
};

/**
 * NHS-style but underfunded: capacity roughly equal to today's demand, which
 * is not enough once care is free → universal coverage with long queues that
 * worsen as delayed care erodes health (the classic critique).
 */
export const NHS_UNDERFUNDED: Policy = {
  ...BASELINE_POLICY,
  singlePayer: true,
  publicProvisionLevel: 0.95,
};

/** Employer mandate on top of the baseline — pushes offer rates up, but premiums come out of wages. */
export const EMPLOYER_MANDATE: Policy = {
  ...BASELINE_POLICY,
  employerMandate: true,
};

/** Cap the ESI tax exclusion (a "Cadillac tax"-style limit) — trims generous offers and the tax expenditure, with little effect on coverage. */
export const TAX_EXCLUSION_CAPPED: Policy = {
  ...BASELINE_POLICY,
  taxExclusionCap: 5_000,
};

/** Repeal the ESI tax exclusion entirely — erodes employer offers, shifting workers to other markets. */
export const TAX_EXCLUSION_REPEALED: Policy = {
  ...BASELINE_POLICY,
  taxExclusionCap: 0,
};

/** Steady-state run: the policy applies from year 0 and the system starts already adapted to it. */
export function defaultConfig(policy: Policy, seed = 42, years = 15): SimConfig {
  return { seed, populationSize: 10_000, years, policy };
}

/**
 * Reform run: the system spends `reformYear` years under current law
 * (BASELINE_POLICY), so provider capacity and premiums reflect today's system,
 * and then the reform arrives — optionally phased in. This is the mode the web
 * app uses, because it shows what a reform does to an existing system.
 */
export function reformConfig(
  policy: Policy,
  opts: { seed?: number; populationSize?: number; years?: number; reformYear?: number; phaseInYears?: number } = {},
): SimConfig {
  return {
    seed: opts.seed ?? 42,
    populationSize: opts.populationSize ?? 10_000,
    years: opts.years ?? 20,
    policy,
    priorPolicy: BASELINE_POLICY,
    reformYear: opts.reformYear ?? 5,
    phaseInYears: opts.phaseInYears ?? 0,
  };
}
