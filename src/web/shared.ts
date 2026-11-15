/** Settings and helpers shared by the simulator view and the comparison view. */
import { BASELINE_POLICY } from "../engine/index.ts";
import type { Policy, SimConfig, SimResult, YearResult } from "../engine/index.ts";
import { TIMING, type ShareState } from "./levers.ts";
import { clamp } from "./format.ts";

/** Households per run. */
export const POP = 8000;
export const YEARS = TIMING.years;
/** Runs per package: the same package on consecutive seeds, so results come with a range. */
export const RUNS = 5;

export const seedsFor = (seed: number): number[] => Array.from({ length: RUNS }, (_, i) => seed + i);

/** Current law until the reform year, then the package (optionally phased in). */
export function configFor(s: Pick<ShareState, "reformYear" | "phaseInYears">, policy: Policy, seed: number): SimConfig {
  return {
    seed,
    populationSize: POP,
    years: YEARS,
    policy,
    priorPolicy: BASELINE_POLICY,
    reformYear: s.reformYear,
    phaseInYears: s.phaseInYears,
  };
}

export interface TriangleScore {
  cost: number;
  quality: number;
  access: number;
}

/** Iron Triangle scoring: 0–1 per axis, 1 = good. */
export function triangleScore(y: YearResult): TriangleScore {
  const burdenShare = y.spending.nheShareOfGdp * (1 + y.government.deadweightLoss / Math.max(1, y.spending.nhe));
  return {
    cost: clamp((0.32 - burdenShare) / (0.32 - 0.09), 0, 1),
    quality: clamp((y.health.meanHealthStock - 0.5) / 0.45, 0, 1),
    // 1 = everyone gets the care they need; 0 = a quarter or more of needed care goes undelivered.
    access: clamp(1 - y.health.careGap / 0.25, 0, 1),
  };
}

/** The triangle score in one year, averaged over runs. */
export function meanTriangle(runs: SimResult[], year: number): TriangleScore {
  const total = { cost: 0, quality: 0, access: 0 };
  for (const r of runs) {
    const s = triangleScore(r.years[year]!);
    total.cost += s.cost;
    total.quality += s.quality;
    total.access += s.access;
  }
  const n = Math.max(1, runs.length);
  return { cost: total.cost / n, quality: total.quality / n, access: total.access / n };
}
