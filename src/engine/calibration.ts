/**
 * Calibration targets: what the current-law run is supposed to look like, and
 * how far off it may be. The tests measure every target on several seeds
 * (tests/calibration.test.ts); DESIGN.md §8 prints the same table.
 *
 * The reference figures are round numbers for the US around 2023, for the
 * population the model simulates (adults aged 26–64) wherever a figure for
 * adults is available. They are there to keep the model recognizable, not to
 * make it a forecast.
 */
import { PARAMS } from "./params.ts";
import { runSimulation } from "./simulate.ts";
import type { Policy, YearResult } from "./types.ts";

export interface CalibrationTarget {
  key: string;
  label: string;
  unit: "%" | "$" | "$B" | "×";
  /** The real-world reference value. */
  reference: number;
  /** The band the model's multi-seed mean must fall in. */
  low: number;
  high: number;
  /**
   * "met": the model is tuned to land in the band, and a test enforces it.
   * "known-miss": the model is knowingly outside the band; recorded so nobody
   * mistakes the number for a calibrated one.
   */
  status: "met" | "known-miss";
  basis: string;
  read: (y: YearResult, populationSize: number) => number;
}

const share = (count: number, n: number): number => (count / n) * 100;

export const CALIBRATION_TARGETS: CalibrationTarget[] = [
  {
    key: "insured",
    label: "Insured",
    unit: "%",
    reference: 90,
    low: 88,
    high: 93,
    status: "met",
    basis: "About 89–90% of adults aged 19–64 had coverage in 2023 (about 92% of the whole population).",
    read: (y) => y.insuredRate * 100,
  },
  {
    key: "esi",
    label: "Employer coverage",
    unit: "%",
    reference: 65,
    low: 60,
    high: 70,
    status: "met",
    basis: "Roughly 63–65% of adults aged 19–64 are covered through an employer (about 60% of everyone under 65, children included). The model runs at the high end.",
    read: (y, n) => share(y.coverage.esi, n),
  },
  {
    key: "public",
    label: "Public coverage (Medicaid-style)",
    unit: "%",
    reference: 15,
    low: 12,
    high: 19,
    status: "met",
    basis: "About 15% of adults aged 19–64 are on Medicaid. The model runs at the low end.",
    read: (y, n) => share(y.coverage.public, n),
  },
  {
    key: "individual",
    label: "Individual market",
    unit: "%",
    reference: 9,
    low: 6,
    high: 12,
    status: "met",
    basis: "About 7–11% of adults aged 19–64 buy coverage on their own, depending on the survey.",
    read: (y, n) => share(y.coverage.individual, n),
  },
  {
    key: "offer",
    label: "Workers offered employer coverage",
    unit: "%",
    reference: 80,
    low: 72,
    high: 88,
    status: "met",
    basis: "About four in five workers are at firms that offer coverage.",
    read: (y) => y.employer.offerRate * 100,
  },
  {
    key: "uninsuredGradient",
    label: "Uninsured rate, low-income third ÷ high-income third",
    unit: "×",
    reference: 4,
    low: 2.5,
    high: 9,
    status: "met",
    basis: "Low-income adults are several times as likely to be uninsured as high-income adults (roughly 15% against 4%).",
    read: (y) => y.uninsuredRateByIncome.low / Math.max(1e-9, y.uninsuredRateByIncome.high),
  },
  {
    key: "nhe",
    label: "Health spending, share of GDP",
    unit: "%",
    reference: 17.6,
    low: 16.7,
    high: 18.3,
    status: "met",
    basis: "National health expenditure was 17.6% of GDP in 2023. Met by construction: `nheDisplayScale` is set so the start of a current-law run lands here.",
    read: (y) => y.spending.nheShareOfGdp * 100,
  },
  {
    key: "silverPremium",
    label: "Individual-market silver premium",
    unit: "$",
    reference: 7_000,
    low: 6_000,
    high: 8_500,
    status: "met",
    basis: "Benchmark silver premiums average roughly $6,000–7,500 a year for an adult, before subsidies.",
    read: (y) => y.premiums.silver,
  },
  {
    key: "esiPremium",
    label: "Employer premium, single coverage",
    unit: "$",
    reference: 8_700,
    low: 7_800,
    high: 9_600,
    status: "known-miss",
    basis:
      "Single employer premiums averaged about $8,400–9,000 in 2023–24. The model runs about a quarter low: its medical costs per adult are roughly 75% of the real figure, and the GDP share above is brought into line by the display scale, not by the costs. Fixing it means raising `baseAnnualCost` and re-tuning coverage.",
    read: (y) => y.employer.avgPremium,
  },
  {
    key: "taxExpenditure",
    label: "ESI tax exclusion, national",
    unit: "$B",
    reference: 320,
    low: 250,
    high: 420,
    status: "met",
    basis: "Income- and payroll-tax revenue forgone on employer premiums is usually put at $300–350 billion a year.",
    read: (y, n) => (y.government.esiTaxExpenditure * PARAMS.displayPopulation) / n / 1e9,
  },
  {
    key: "utilization",
    label: "Hospital utilization (demand ÷ capacity)",
    unit: "%",
    reference: 85,
    low: 80,
    high: 90,
    status: "met",
    basis: "A model construct: capacity is seeded so the system starts at its 85% target.",
    read: (y) => y.providers.hospital.utilization * 100,
  },
];

export interface CalibrationRow {
  target: CalibrationTarget;
  /** Mean over the seeds of each seed's average across the measured years. */
  mean: number;
  /** Lowest and highest single-seed value. */
  min: number;
  max: number;
  inBand: boolean;
}

/**
 * Measure every target under `policy` (normally current law): the average of
 * the first `years` years, on each seed, then across seeds.
 */
export function measureCalibration(
  policy: Policy,
  seeds: readonly number[],
  populationSize = 10_000,
  years = 5,
): CalibrationRow[] {
  const runs = seeds.map((seed) => runSimulation({ seed, populationSize, years, policy }));
  return CALIBRATION_TARGETS.map((target) => {
    const perSeed = runs.map(
      (r) => r.years.reduce((sum, y) => sum + target.read(y, populationSize), 0) / r.years.length,
    );
    const mean = perSeed.reduce((a, b) => a + b, 0) / perSeed.length;
    return {
      target,
      mean,
      min: Math.min(...perSeed),
      max: Math.max(...perSeed),
      inBand: mean >= target.low && mean <= target.high,
    };
  });
}
