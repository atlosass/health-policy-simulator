/**
 * The four stylized plan tiers (resolved design decision, June 2026).
 * Cost-sharing is a deductible, then coinsurance, up to an out-of-pocket
 * maximum. Each tier's deductible is set so that the share of spending the
 * plan pays, across the whole simulated adult population, equals its label
 * (60 / 70 / 80 / 90%); tests/plans.test.ts holds them to it.
 */
export type TierId = "bronze" | "silver" | "gold" | "platinum";

export interface PlanTier {
  id: TierId;
  label: string;
  /** Nominal actuarial value, for display and premium scaling. */
  av: number;
  /** Annual deductible: the enrollee pays all spending up to this amount. */
  deductible: number;
  /**
   * Coinsurance: share of spending above the deductible that the enrollee pays,
   * until the OOP max. It is also the price signal behind the demand response
   * (moral hazard): richer plans, more care used.
   */
  coinsurance: number;
  /** Annual out-of-pocket maximum. */
  oopMax: number;
}

export const TIERS: readonly PlanTier[] = [
  { id: "bronze", label: "Bronze", av: 0.6, deductible: 2850, coinsurance: 0.45, oopMax: 9000 },
  { id: "silver", label: "Silver", av: 0.7, deductible: 1400, coinsurance: 0.32, oopMax: 8000 },
  { id: "gold", label: "Gold", av: 0.8, deductible: 600, coinsurance: 0.22, oopMax: 6500 },
  { id: "platinum", label: "Platinum", av: 0.9, deductible: 150, coinsurance: 0.12, oopMax: 4000 },
];

export const TIER_BY_ID: Record<TierId, PlanTier> = Object.fromEntries(
  TIERS.map((t) => [t.id, t]),
) as Record<TierId, PlanTier>;

/** Public insurance: near-comprehensive coverage with nominal cost-sharing. */
export const PUBLIC_PLAN: PlanTier = {
  id: "platinum",
  label: "Public",
  av: 0.95,
  deductible: 0,
  coinsurance: 0.05,
  oopMax: 1500,
};

/** Out-of-pocket cost for a given level of total spending under a plan. */
export function oopFor(plan: PlanTier, spend: number): number {
  const belowDeductible = Math.min(spend, plan.deductible);
  return Math.min(belowDeductible + plan.coinsurance * (spend - belowDeductible), plan.oopMax);
}
