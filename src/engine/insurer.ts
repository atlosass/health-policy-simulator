import { PARAMS } from "./params.ts";
import { TIERS, type TierId } from "./plans.ts";
import { expectedClaims } from "./choice.ts";
import { expectedCost } from "./population.ts";
import type { ExplanationEvent, Household, TierPremiums } from "./types.ts";

export interface PoolExperience {
  /** Total claims paid last year, by individual-market tier. */
  claimsByTier: Record<TierId, number>;
  enrollmentByTier: Record<TierId, number>;
  /** Average expected cost (risk) of last year's individual pool. */
  poolAvgRisk: number;
}

export const emptyExperience = (): PoolExperience => ({
  claimsByTier: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
  enrollmentByTier: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
  poolAvgRisk: 0,
});

/**
 * Year-0 individual-market premium seed: price each tier as if the whole
 * population enrolled — an optimistic (healthy-inclusive) book of business.
 * Selection dynamics take over from there. (ESI is priced structurally by
 * firms in employer.ts, not here.)
 */
export function seedPremiums(pop: Household[]): TierPremiums {
  const premiums = {} as TierPremiums;
  for (const tier of TIERS) {
    let total = 0;
    for (const h of pop) total += expectedClaims(expectedCost(h), tier);
    premiums[tier.id] =
      (total / pop.length) * (1 + PARAMS.individualLoad) * PARAMS.seedPremiumUplift;
  }
  return premiums;
}

/**
 * Set this year's individual-market premiums from last year's claims experience
 * (the one-year lag that makes selection spirals dynamic). Tier experience is
 * credibility-blended with the market-wide cost per AV-unit so thin tiers don't
 * whipsaw, and year-over-year movement is capped (rate-review smoothing).
 */
export function updatePremiums(
  prev: TierPremiums,
  exp: PoolExperience,
  year: number,
  riskAdjustment: boolean,
): { premiums: TierPremiums; events: ExplanationEvent[] } {
  const events: ExplanationEvent[] = [];

  let totalClaims = 0;
  let totalAvUnits = 0;
  for (const tier of TIERS) {
    totalClaims += exp.claimsByTier[tier.id];
    totalAvUnits += exp.enrollmentByTier[tier.id] * tier.av;
  }
  const marketPerAvUnit = totalAvUnits > 0 ? totalClaims / totalAvUnits : 0;

  const premiums = {} as TierPremiums;
  for (const tier of TIERS) {
    const n = exp.enrollmentByTier[tier.id];
    const old = prev[tier.id];
    if (totalAvUnits === 0) {
      // No individual market last year — hold rates.
      premiums[tier.id] = old;
      continue;
    }
    const tierExperience = n > 0 ? exp.claimsByTier[tier.id] / n : marketPerAvUnit * tier.av;
    // With risk adjustment, cross-tier selection is neutralized by transfers:
    // every tier is priced off the pooled market cost per AV-unit. Without
    // it, each tier carries its own selection-distorted experience
    // (credibility-blended so thin tiers don't whipsaw).
    const credibility = n / (n + PARAMS.tierCredibilityAt);
    const blended = riskAdjustment
      ? marketPerAvUnit * tier.av
      : credibility * tierExperience + (1 - credibility) * marketPerAvUnit * tier.av;
    const target = blended * (1 + PARAMS.individualLoad);
    const capped = Math.min(
      Math.max(target, old * (1 - PARAMS.maxPremiumGrowth)),
      old * (1 + PARAMS.maxPremiumGrowth),
    );
    premiums[tier.id] = capped;

    const change = capped / old - 1;
    if (Math.abs(change) > 0.05 && n > 0) {
      events.push({
        year,
        module: "insurer",
        type: "premium-change",
        data: {
          tier: tier.id,
          oldPremium: Math.round(old),
          newPremium: Math.round(capped),
          changePct: Math.round(change * 100),
          enrollment: n,
          claimsPerEnrollee: Math.round(tierExperience),
          poolAvgRisk: Math.round(exp.poolAvgRisk),
        },
        narrative:
          `${tier.label} premiums ${change > 0 ? "rose" : "fell"} ${Math.abs(Math.round(change * 100))}% ` +
          `(to $${Math.round(capped).toLocaleString()}) because last year's ${tier.label.toLowerCase()} pool ` +
          `(${n.toLocaleString()} enrollees) ran claims of $${Math.round(tierExperience).toLocaleString()} per enrollee.`,
      });
    }
  }

  return { premiums, events };
}
