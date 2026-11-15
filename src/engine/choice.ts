import { PARAMS } from "./params.ts";
import { PUBLIC_PLAN, TIERS, TIER_BY_ID, oopFor, type PlanTier, type TierId } from "./plans.ts";
import { DRAW, gumbelFrom, hashUniform } from "./rng.ts";
import { expectedCost } from "./population.ts";
import { realizedSpend, expectedForgoneCare } from "./utilization.ts";
import type { Household, Policy, TierPremiums } from "./types.ts";

/**
 * Certainty-equivalent annual cost of facing a plan's cost-sharing, for a
 * household of expected cost mu: E[OOP] + 0.5·r·Var[OOP] + the value of
 * needed care the plan's cost-sharing would lead them to forgo, evaluated
 * over the discrete shock distribution. Spending inside each state already
 * reflects the plan's moral-hazard response.
 */
export function ceOopCost(
  mu: number,
  riskAversion: number,
  plan: PlanTier,
  priceIndex = 1,
): number {
  const { shockProbs, shockMults } = PARAMS;
  let e = 0;
  let e2 = 0;
  for (let s = 0; s < shockProbs.length; s++) {
    const spend = realizedSpend(mu, shockMults[s]!, plan.coinsurance) * priceIndex;
    const oop = oopFor(plan, spend);
    e += shockProbs[s]! * oop;
    e2 += shockProbs[s]! * oop * oop;
  }
  return (
    e + 0.5 * riskAversion * (e2 - e * e) + expectedForgoneCare(mu, plan.coinsurance)
  );
}

/** Expected insurer claims for a household of expected cost mu under a plan, at the prevailing commercial price index. */
export function expectedClaims(mu: number, plan: PlanTier, priceIndex = 1): number {
  const { shockProbs, shockMults } = PARAMS;
  let claims = 0;
  for (let s = 0; s < shockProbs.length; s++) {
    const spend = realizedSpend(mu, shockMults[s]!, plan.coinsurance) * priceIndex;
    claims += shockProbs[s]! * (spend - oopFor(plan, spend));
  }
  return claims;
}

/** Certainty-equivalent cost of going uninsured (full price, OOP capped at a share of income, mandate penalty added). */
export function ceUninsured(
  mu: number,
  riskAversion: number,
  income: number,
  penalty: number,
  priceIndex = 1,
): number {
  const { shockProbs, shockMults } = PARAMS;
  const cap = PARAMS.uninsuredOopIncomeCap * income;
  let e = 0;
  let e2 = 0;
  for (let s = 0; s < shockProbs.length; s++) {
    const oop = Math.min(realizedSpend(mu, shockMults[s]!, 1.0) * priceIndex, cap);
    e += shockProbs[s]! * oop;
    e2 += shockProbs[s]! * oop * oop;
  }
  return (
    e +
    0.5 * riskAversion * (e2 - e * e) +
    penalty +
    expectedForgoneCare(mu, 1.0)
  );
}

/** ARPA-style required contribution: 0% of income below 1.5×FPL, ramping to 8.5% at 4×FPL and above. */
export function requiredContribution(income: number): number {
  const fpl = income / PARAMS.povertyLine;
  const t = Math.min(Math.max((fpl - 1.5) / 2.5, 0), 1);
  return 0.085 * t * income;
}

/** Dollar-equivalent burden of enrolling in coverage on one's own this year (see PARAMS.enrollHassle). */
export function enrollmentHassle(h: Household): number {
  const { base, max, incomeScale } = PARAMS.enrollHassle;
  return base + max * h.hassleDraw ** 3 * Math.exp(-h.cashIncome / incomeScale);
}

export interface ChoiceContext {
  premiums: TierPremiums; // community-rated posted premiums
  policy: Policy;
  /** Last year's blended commercial price index — households' adaptive expectation of out-of-pocket costs. */
  expectedPriceIndex: number;
  /** Run seed and year: with the household id, they pick out this household's choice noise for the year. */
  seed: number;
  year: number;
}

export interface ChoiceResult {
  coverage: Household["coverage"];
  tier: TierId | null;
  /** Subsidy dollars actually used (0 unless an individual-market plan was bought). */
  subsidyUsed: number;
  premiumPaid: number;
}

/**
 * Household coverage choice: minimize certainty-equivalent cost across the
 * available options, with Gumbel noise for smooth (logit-style) switching.
 * Each option has its own noise draw for this household and year, the same
 * whichever other options happen to be available.
 */
export function chooseCoverage(h: Household, ctx: ChoiceContext): ChoiceResult {
  const { policy, expectedPriceIndex: pi } = ctx;
  const noise = (purpose: number): number =>
    gumbelFrom(hashUniform(ctx.seed, h.id, ctx.year, purpose), PARAMS.choiceNoise);
  const mu = expectedCost(h);
  // Eligibility and affordability rules see cash wages: employer premium
  // contributions are not counted as income (as with MAGI).
  const fplMultiple = h.cashIncome / PARAMS.povertyLine;

  // Subsidy (benchmark design): only without an ESI offer, below the cutoff,
  // and not public-eligible. Pegged to the silver premium the household faces.
  const publicEligible =
    policy.publicEligibilityMultiple > 0 && fplMultiple <= policy.publicEligibilityMultiple;
  const load = policy.communityRating ? PARAMS.individualLoad : PARAMS.underwrittenLoad;
  // Individual-market plans pay providers less than employer plans (narrower networks).
  const piIndividual = pi * PARAMS.individualPriceRatio;
  const silverPremium = policy.communityRating
    ? ctx.premiums.silver
    : expectedClaims(mu, TIERS[1]!, piIndividual) * (1 + load);
  // The ESI firewall only bites if the offer is "affordable" (ACA rule): an
  // unaffordable offer leaves the worker subsidy-eligible.
  const firewalled =
    h.esiOffer !== null && h.esiOffer.workerCost <= PARAMS.esiAffordabilityPct * h.cashIncome;
  const subsidyEligible =
    policy.subsidiesEnabled &&
    !firewalled &&
    !publicEligible &&
    fplMultiple <= policy.subsidyCutoffMultiple;
  const subsidy = subsidyEligible
    ? Math.max(0, silverPremium - requiredContribution(h.cashIncome))
    : 0;

  const hassle = enrollmentHassle(h);

  type Option = ChoiceResult & { ce: number };
  const options: Option[] = [];

  // Go uninsured.
  options.push({
    coverage: "uninsured",
    tier: null,
    subsidyUsed: 0,
    premiumPaid: 0,
    ce:
      ceUninsured(mu, h.riskAversion, h.cashIncome, policy.mandatePenalty, pi) +
      PARAMS.uninsuredIncomeExposure * Math.max(0, h.cashIncome - PARAMS.uninsuredExposureFloor) +
      noise(DRAW.noiseUninsured),
  });

  // Employer plan: the worker bears the premium net of the tax subsidy (via
  // lower wages + the employee share), plus a stickiness bonus for the default
  // enrollment. The firm's offered tier sets the generosity.
  if (h.esiOffer) {
    const plan = TIER_BY_ID[h.esiOffer.tier];
    options.push({
      coverage: "esi",
      tier: h.esiOffer.tier,
      subsidyUsed: 0,
      premiumPaid: h.esiOffer.workerCost,
      ce:
        h.esiOffer.workerCost +
        ceOopCost(mu, h.riskAversion, plan, pi) -
        PARAMS.esiTakeupBonus +
        noise(DRAW.noiseEsi),
    });
  }

  // Public program.
  if (publicEligible) {
    options.push({
      coverage: "public",
      tier: null,
      subsidyUsed: 0,
      premiumPaid: 0,
      ce: ceOopCost(mu, h.riskAversion, PUBLIC_PLAN, policy.publicPriceRatio) + hassle + noise(DRAW.noisePublic),
    });
  }

  // Individual market, four tiers.
  for (const [t, tier] of TIERS.entries()) {
    const gross = policy.communityRating
      ? ctx.premiums[tier.id]
      : expectedClaims(mu, tier, piIndividual) * (1 + load);
    const net = Math.max(0, gross - subsidy);
    options.push({
      coverage: "individual",
      tier: tier.id,
      subsidyUsed: Math.min(subsidy, gross),
      premiumPaid: net,
      ce:
        net +
        ceOopCost(mu, h.riskAversion, tier, piIndividual) +
        PARAMS.enrollHassle.individualShare * hassle +
        noise(DRAW.noiseTier + t),
    });
  }

  let best = options[0]!;
  for (const o of options) if (o.ce < best.ce) best = o;
  return { coverage: best.coverage, tier: best.tier, subsidyUsed: best.subsidyUsed, premiumPaid: best.premiumPaid };
}
