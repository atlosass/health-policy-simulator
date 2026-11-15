/**
 * The four stylized plan tiers (resolved design decision, June 2026).
 * Cost-sharing is modeled as a coinsurance rate with an out-of-pocket maximum;
 * the actuarial-value labels are descriptive of typical realized AV.
 */
export type TierId = "bronze" | "silver" | "gold" | "platinum";

export interface PlanTier {
  id: TierId;
  label: string;
  /** Nominal actuarial value, for display and premium scaling. */
  av: number;
  /** Coinsurance: share of spending the enrollee pays before the OOP max. */
  coinsurance: number;
  /** Annual out-of-pocket maximum. */
  oopMax: number;
}

export const TIERS: readonly PlanTier[] = [
  { id: "bronze", label: "Bronze", av: 0.6, coinsurance: 0.45, oopMax: 9000 },
  { id: "silver", label: "Silver", av: 0.7, coinsurance: 0.32, oopMax: 8000 },
  { id: "gold", label: "Gold", av: 0.8, coinsurance: 0.22, oopMax: 6500 },
  { id: "platinum", label: "Platinum", av: 0.9, coinsurance: 0.12, oopMax: 4000 },
];

export const TIER_BY_ID: Record<TierId, PlanTier> = Object.fromEntries(
  TIERS.map((t) => [t.id, t]),
) as Record<TierId, PlanTier>;

/** Public insurance: near-comprehensive coverage with nominal cost-sharing. */
export const PUBLIC_PLAN: PlanTier = {
  id: "platinum",
  label: "Public",
  av: 0.95,
  coinsurance: 0.05,
  oopMax: 1500,
};

/** Out-of-pocket cost for a given level of total spending under a plan. */
export function oopFor(plan: PlanTier, spend: number): number {
  return Math.min(plan.coinsurance * spend, plan.oopMax);
}
