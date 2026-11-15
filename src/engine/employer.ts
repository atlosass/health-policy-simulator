import { PARAMS } from "./params.ts";
import { TIERS, type PlanTier, type TierId } from "./plans.ts";
import { expectedClaims, ceOopCost, ceUninsured } from "./choice.ts";
import { marginalTaxRate } from "./population.ts";
import type { Rng } from "./rng.ts";
import type { EsiOffer, FirmSize, Household, Policy } from "./types.ts";

/**
 * Assign a worker to a firm size. Higher earners sort into larger firms (which
 * face lower administrative loads), reproducing the empirical size/wage/offer
 * gradient on top of the income gradient.
 */
export function drawFirm(rng: Rng, income: number): { size: FirmSize; adminLoad: number } {
  const tilt = PARAMS.firmSizeIncomeTilt * Math.tanh(Math.log(income / PARAMS.incomeMedian));
  const score = rng() + tilt; // higher → larger firm
  let size: FirmSize;
  if (score < PARAMS.firmSizes.small.baseProb) size = "small";
  else if (score < PARAMS.firmSizes.small.baseProb + PARAMS.firmSizes.medium.baseProb) size = "medium";
  else size = "large";
  return { size, adminLoad: PARAMS.firmSizes[size].adminLoad };
}

/** Combined marginal tax rate shielded by the ESI exclusion (income + payroll). */
export function esiTaxRate(income: number): number {
  return marginalTaxRate(income) + PARAMS.payrollTaxRate;
}

/**
 * Representative-worker valuations computed once per year at the prevailing
 * provider prices: per-tier willingness to pay vs. being uninsured, per-tier
 * expected claims (the actuarially-fair part of the group premium), and the
 * per-worker recruitment value of employer coverage (the dollar advantage of
 * group coverage over buying equivalent coverage alone).
 */
export interface EsiContext {
  value: Record<TierId, number>;
  claims: Record<TierId, number>;
  /** Recruitment value of the (gold-benchmark) plan: $ workers gain from ESI vs. self-purchase. */
  recruitmentValue: number;
}

export function buildEsiContext(
  avgMu: number,
  avgRiskAversion: number,
  avgIncome: number,
  priceIndex: number,
): EsiContext {
  const value = {} as Record<TierId, number>;
  const claims = {} as Record<TierId, number>;
  const uninsuredCe = ceUninsured(avgMu, avgRiskAversion, avgIncome, 0, priceIndex);
  for (const tier of TIERS) {
    value[tier.id] = uninsuredCe - ceOopCost(avgMu, avgRiskAversion, tier, priceIndex);
    claims[tier.id] = expectedClaims(avgMu, tier, priceIndex);
  }
  const recruitmentValue = PARAMS.esiRecruitmentValue * claims.gold;
  return { value, claims, recruitmentValue };
}

/**
 * A firm offers ESI when the worker value it delivers — net of cost — beats
 * the per-worker fixed cost of running a plan. Two margins, deliberately
 * separated:
 *
 *  • EXTENSIVE (whether to offer): driven by the **recruitment value** workers
 *    genuinely gain from employer coverage over self-purchase (pooling, the
 *    employer curating/stabilizing the plan) net of the firm's admin load,
 *    plus the tax subsidy, plus an idiosyncratic firm shock, against a
 *    per-worker fixed administrative cost (high for tiny firms). Because the
 *    recruitment value is positive for all firm sizes, the offer margin is
 *    sticky — most firms keep offering even without the tax break (a non-
 *    offering firm must raise wages to compete), so repeal mostly shifts the
 *    *intensive* margin, not the *extensive* one. The smallest firms, which
 *    can't spread the fixed cost, are the tax-sensitive margin that drops.
 *
 *  • INTENSIVE (which tier): the firm picks the tier maximizing the worker's
 *    net surplus (value − premium + tax shield). The tax exclusion makes
 *    generosity cheap, so it is the main lever on plan richness — capping or
 *    repealing it makes plans skinnier.
 *
 * An employer mandate forces an offer regardless.
 */
export function decideOffer(
  income: number,
  adminLoad: number,
  firmSize: FirmSize,
  firmOfferShock: number,
  ctx: EsiContext,
  policy: Policy,
): EsiOffer | null {
  const tau = esiTaxRate(income);
  const cap = policy.taxExclusionCap;
  const excludableOf = (premium: number) => (cap === null ? premium : Math.min(premium, cap));

  // Intensive margin: pick the tier maximizing the worker's net surplus (value
  // − premium + tax shield). Diminishing returns to actuarial value temper
  // generosity; the tax shield tilts toward richer plans.
  let best: EsiOffer | null = null;
  let bestNet = -Infinity;
  for (const tier of TIERS) {
    const premium = ctx.claims[tier.id] * (1 + adminLoad);
    const excludable = excludableOf(premium);
    const net = ctx.value[tier.id] - premium + tau * excludable;
    if (net > bestNet) {
      bestNet = net;
      best = {
        tier: tier.id,
        premium,
        taxSubsidy: tau * excludable,
        workerCost: PARAMS.esiWorkerShare * premium * (1 - tau),
      };
    }
  }

  // Extensive margin: recruitment value (net of this firm's admin load) + tax
  // subsidy + idiosyncratic shock vs. the per-worker fixed cost of offering.
  const offerSurplus =
    ctx.recruitmentValue -
    adminLoad * ctx.claims[best!.tier] +
    best!.taxSubsidy +
    firmOfferShock * PARAMS.esiOfferDispersion -
    PARAMS.esiFixedCostPerWorker[firmSize];

  if (offerSurplus > 0 || policy.employerMandate) return best;
  return null;
}

/** Set each household's ESI offer for the year. */
export function setEmployerOffers(pop: Household[], ctx: EsiContext, policy: Policy): void {
  for (const h of pop) {
    h.esiOffer = decideOffer(h.income, h.firmAdminLoad, h.firmSize, h.firmOfferShock, ctx, policy);
  }
}

export const tierAv = (id: TierId): number => TIERS.find((t) => t.id === id)!.av;
export type { PlanTier };
