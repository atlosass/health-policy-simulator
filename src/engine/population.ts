import { PARAMS } from "./params.ts";
import { lognormal, mulberry32, normal, type Rng } from "./rng.ts";
import { drawFirm } from "./employer.ts";
import type { Household } from "./types.ts";

/**
 * Deterministic standard-normal shock keyed off the household id, drawn from a
 * SEPARATE PRNG stream so it never perturbs the main simulation draw order
 * (keeps all other seeded results reproducible).
 */
function idShock(id: number): number {
  return normal(mulberry32((id * 2654435761) >>> 0));
}

const ANCHOR_AGE = 45;

/**
 * Expected annual health cost for a household given its persistent traits —
 * the household's "type" for insurance-choice purposes. Rises with age,
 * frailty, and a depleted health stock (yesterday's forgone care is
 * tomorrow's higher risk).
 */
export function expectedCost(h: Household): number {
  return (
    PARAMS.baseAnnualCost *
      Math.pow(PARAMS.ageCostGrowth, h.age - ANCHOR_AGE) *
      h.frailty *
      (1 + PARAMS.riskFromPoorHealth * (1 - h.healthStock)) +
    PARAMS.accidentRiskCost
  );
}

export function marginalTaxRate(income: number): number {
  if (income < PARAMS.taxRateVeryLowBracket) return PARAMS.taxRateVeryLow;
  if (income > PARAMS.taxRateBracket) return PARAMS.taxRateHigh;
  return PARAMS.taxRateLow;
}

function drawHousehold(rng: Rng, id: number, age: number): Household {
  const income = Math.max(
    8_000,
    lognormal(rng, Math.log(PARAMS.incomeMedian), PARAMS.incomeSigma),
  );
  const firm = drawFirm(rng, income);
  // Income-health gradient: lower-income households draw higher frailty on
  // average (stylized SES gradient), normalized to keep the population mean
  // frailty near 1.
  const gradient = Math.pow(income / PARAMS.incomeMedian, -0.2);
  const frailty =
    lognormal(rng, -0.5 * PARAMS.frailtySigma ** 2, PARAMS.frailtySigma) *
    gradient;
  return {
    id,
    age,
    income,
    frailty,
    riskAversion: lognormal(
      rng,
      Math.log(PARAMS.riskAversionMean) - 0.5 * PARAMS.riskAversionSigma ** 2,
      PARAMS.riskAversionSigma,
    ),
    healthStock: Math.min(1, 0.98 - 0.004 * (age - PARAMS.ageMin) + 0.05 * rng()),
    firmSize: firm.size,
    firmAdminLoad: firm.adminLoad,
    firmOfferShock: idShock(id),
    esiOffer: null,
    publicHassleCost: 150 + 1_200 * Math.pow(rng(), 2),
    coverage: "uninsured",
    tier: null,
  };
}

export function generatePopulation(rng: Rng, size: number): Household[] {
  const pop: Household[] = [];
  for (let i = 0; i < size; i++) {
    const age =
      PARAMS.ageMin + Math.floor(rng() * (PARAMS.ageMax - PARAMS.ageMin + 1));
    pop.push(drawHousehold(rng, i, age));
  }
  return pop;
}

/** Age the population one year; 65-year-olds exit (to Medicare, abstracted) and are replaced by new 26-year-old entrants. */
export function agePopulation(rng: Rng, pop: Household[], nextId: number): number {
  for (let i = 0; i < pop.length; i++) {
    const h = pop[i]!;
    h.age += 1;
    if (h.age > PARAMS.ageMax) {
      pop[i] = drawHousehold(rng, nextId++, PARAMS.ageMin);
    }
  }
  return nextId;
}
