import { PARAMS } from "./params.ts";
import { oopFor, type PlanTier } from "./plans.ts";

/**
 * Demand response to the effective coinsurance rate (moral hazard).
 * Spending at coinsurance c = need × (c/cRef)^(-eps), need defined at the
 * reference coinsurance. Calibrated to the RAND HIE: free care raises
 * spending ~40% relative to full-price care (~30% cut going the other way).
 */
export function demandMultiplier(coinsurance: number): number {
  const c = Math.max(coinsurance, PARAMS.minCoinsurance);
  return Math.pow(c / PARAMS.refCoinsurance, -PARAMS.demandElasticityExp);
}

/** Total spending for a household of expected cost mu in shock state mult under coinsurance c. */
export function realizedSpend(mu: number, shockMult: number, coinsurance: number): number {
  return mu * shockMult * demandMultiplier(coinsurance);
}

/**
 * The care level the household "should" consume for health purposes —
 * defined at a generous reference coinsurance. Consumption below this level
 * creates an unmet-need gap that damages the health stock.
 */
export function adequateSpend(mu: number, shockMult: number): number {
  return realizedSpend(mu, shockMult, 0.2);
}

/**
 * Expected dollar value of needed care forgone under a plan with the given
 * coinsurance, relative to the adequate-care reference level. Enters the
 * coverage-choice calculus: skimpy coverage saves money but means skipping
 * care you needed. Zero for plans at or below the reference coinsurance.
 */
export function expectedForgoneCare(mu: number, coinsurance: number): number {
  return (
    PARAMS.forgoneCareValue *
    mu *
    Math.max(0, demandMultiplier(0.2) - demandMultiplier(coinsurance))
  );
}

export interface SpendOutcome {
  spend: number;
  oop: number;
  /** Paid by the insurer/program (0 if uninsured). */
  claims: number;
  /** Care delivered but not paid for (uninsured beyond the income cap). */
  uncompensated: number;
}

/** Realized spending and payment split for an insured household. */
export function insuredOutcome(mu: number, shockMult: number, plan: PlanTier): SpendOutcome {
  const spend = realizedSpend(mu, shockMult, plan.coinsurance);
  const oop = oopFor(plan, spend);
  return { spend, oop, claims: spend - oop, uncompensated: 0 };
}

/** Realized spending for an uninsured household: full price at the point of care, OOP capped at a share of income (the remainder is uncompensated care). */
export function uninsuredOutcome(mu: number, shockMult: number, income: number): SpendOutcome {
  const spend = realizedSpend(mu, shockMult, 1.0);
  const oop = Math.min(spend, PARAMS.uninsuredOopIncomeCap * income);
  return { spend, oop, claims: 0, uncompensated: spend - oop };
}
