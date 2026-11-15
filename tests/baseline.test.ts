/**
 * Properties of the run itself: reproducible from its seed, fast enough for a
 * classroom, and built so that a policy cannot reshuffle anyone's luck.
 * (What current law should look like is in calibration.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  defaultConfig,
  reformConfig,
  PARAMS,
  BASELINE_POLICY,
  UNSUPPORTED_COMMUNITY_RATING,
  SINGLE_PAYER_ADEQUATE,
} from "../src/engine/index.ts";
import { hashUniform } from "../src/engine/rng.ts";
import type { SimResult } from "../src/engine/index.ts";
import { eachSeed, steady } from "./helpers.ts";

test("current law is stable: a small care gap and a steady individual market", () => {
  eachSeed((seed) => {
    const res = steady(BASELINE_POLICY, seed);
    const y10 = res.years[10]!;
    assert.ok(y10.health.careGap < 0.08, `care gap ${(y10.health.careGap * 100).toFixed(1)}%`);
    assert.ok(y10.premiums.silver > 4_000 && y10.premiums.silver < 14_000, `silver premium $${Math.round(y10.premiums.silver)}`);
  });
});

test("simulations are deterministic given a seed, and differ across seeds", () => {
  const a = runSimulation(defaultConfig(BASELINE_POLICY, 7));
  const b = runSimulation(defaultConfig(BASELINE_POLICY, 7));
  const c = runSimulation(defaultConfig(BASELINE_POLICY, 8));
  assert.deepEqual(a.years, b.years, "same seed must reproduce identical results");
  assert.notDeepEqual(a.years[0]!.coverage, c.years[0]!.coverage, "different seeds should differ");
});

test("simulation is fast enough for interactive classroom use (10k agents, 15 years)", () => {
  const start = performance.now();
  runSimulation(defaultConfig(BASELINE_POLICY, 99));
  const ms = performance.now() - start;
  assert.ok(ms < 3_000, `simulation took ${Math.round(ms)}ms, expected < 3s`);
});

// ---- Common random numbers: the same people with the same luck under every policy. ----

/** Total income of the simulated population each year, recovered from the spending ledger. */
const totalIncome = (res: SimResult): number[] =>
  res.years.map((y) => ((y.spending.nhe * PARAMS.nheDisplayScale) / y.spending.nheShareOfGdp) * PARAMS.laborShareOfGdp);

test("the population is the same under every policy", () => {
  eachSeed((seed) => {
    const base = totalIncome(steady(BASELINE_POLICY, seed));
    for (const policy of [UNSUPPORTED_COMMUNITY_RATING, SINGLE_PAYER_ADEQUATE]) {
      const other = totalIncome(steady(policy, seed));
      for (let year = 0; year < base.length; year++) {
        assert.ok(Math.abs(other[year]! / base[year]! - 1) < 1e-9, `year ${year}: who is in the population must not depend on policy`);
      }
    }
  });
});

test("a lever that changes nobody's situation changes nothing at all", () => {
  // A mandate penalty of one cent moves no one's choice, and it must not move
  // anyone's random draws either: every number in the run stays the same.
  eachSeed((seed) => {
    const strip = (res: SimResult) => res.years.map(({ policy: _p, events: _e, government: _g, ...rest }) => rest);
    const base = runSimulation(reformConfig(BASELINE_POLICY, { seed, years: 8, populationSize: 4000 }));
    const cent = runSimulation(reformConfig({ ...BASELINE_POLICY, mandatePenalty: 0.01 }, { seed, years: 8, populationSize: 4000 }));
    assert.deepEqual(strip(cent), strip(base));
  });
});

test("per-household draws are uniform and independent of one another", () => {
  const n = 20_000;
  let sum = 0;
  let sumSq = 0;
  let cross = 0;
  for (let id = 0; id < n; id++) {
    const a = hashUniform(42, id, 3, 0);
    const b = hashUniform(42, id, 3, 1);
    assert.ok(a > 0 && a < 1);
    sum += a;
    sumSq += a * a;
    cross += (a - 0.5) * (b - 0.5);
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean.toFixed(4)}`);
  assert.ok(Math.abs(variance - 1 / 12) < 0.004, `variance ${variance.toFixed(4)}`);
  assert.ok(Math.abs(cross / n / (1 / 12)) < 0.03, `correlation between two purposes ${(cross / n / (1 / 12)).toFixed(4)}`);
  assert.notEqual(hashUniform(42, 5, 3, 0), hashUniform(43, 5, 3, 0), "the seed matters");
  assert.notEqual(hashUniform(42, 5, 3, 0), hashUniform(42, 5, 4, 0), "the year matters");
});
