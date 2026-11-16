/**
 * How a reform raises the new revenue it needs for health.
 *
 * Revenue up to what the government was already raising before the reform
 * keeps coming from general revenue. Anything above that is raised with the
 * instrument the reform chooses. Instruments differ in two ways: who pays
 * (the base each household is charged on) and how much economic damage raising
 * a dollar does (the marginal cost of public funds). Broad, flat charges are
 * cheap to raise and fall hardest on low incomes; taxes concentrated on high
 * earners are the reverse. That is the trade-off the lever exists to show.
 */
import { PARAMS } from "./params.ts";
import { taxLiability } from "./population.ts";
import type { Financing } from "./types.ts";

export interface FinancingInstrument {
  /** Short name for menus. */
  label: string;
  /** As it reads in a sentence: "raised by …". */
  phrase: string;
  /** What society loses, in total, for each dollar raised this way (1.30 = 30 cents of deadweight loss). */
  costOfFunds: number;
  /** What a household is charged in proportion to, given its cash income. */
  base: (cashIncome: number) => number;
}

export const FINANCING: Record<Financing, FinancingInstrument> = {
  general: {
    label: "General revenue",
    phrase: "general revenue (the existing mix of income and payroll taxes)",
    costOfFunds: PARAMS.marginalCostOfFunds,
    base: taxLiability,
  },
  payroll: {
    label: "Payroll tax",
    phrase: "a payroll tax, the same percentage of everyone's pay",
    costOfFunds: PARAMS.financingCostOfFunds.payroll,
    base: (cashIncome) => cashIncome,
  },
  topIncome: {
    label: "Income tax on high earners",
    phrase: `an income tax on earnings above $${PARAMS.taxRateBracket.toLocaleString("en-US")}`,
    costOfFunds: PARAMS.financingCostOfFunds.topIncome,
    base: (cashIncome) => Math.max(0, cashIncome - PARAMS.taxRateBracket),
  },
  flat: {
    label: "Flat premium",
    phrase: "a flat premium, the same number of dollars for every household",
    costOfFunds: PARAMS.financingCostOfFunds.flat,
    base: () => 1,
  },
};

export const FINANCING_OPTIONS = Object.keys(FINANCING) as Financing[];

export function isFinancing(value: unknown): value is Financing {
  return typeof value === "string" && value in FINANCING;
}
