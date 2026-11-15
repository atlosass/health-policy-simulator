/**
 * Baseline sanity (DESIGN.md §8): the current-law-ish configuration should
 * resemble the stylized 2024 US, and runs must be deterministic by seed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation, defaultConfig, BASELINE_POLICY } from "../src/engine/index.ts";

const result = runSimulation(defaultConfig(BASELINE_POLICY));
const y10 = result.years[10]!;
const n = result.config.populationSize;

test("baseline coverage mix resembles the stylized US", () => {
  assert.ok(y10.insuredRate > 0.85 && y10.insuredRate < 0.98, `insured rate ${(y10.insuredRate * 100).toFixed(1)}%`);
  const esiShare = y10.coverage.esi / n;
  assert.ok(esiShare > 0.45 && esiShare < 0.7, `ESI share ${(esiShare * 100).toFixed(1)}%`);
  const publicShare = y10.coverage.public / n;
  assert.ok(publicShare > 0.07 && publicShare < 0.2, `public share ${(publicShare * 100).toFixed(1)}%`);
});

test("baseline health spending share of GDP is in the familiar range", () => {
  assert.ok(
    y10.spending.nheShareOfGdp > 0.13 && y10.spending.nheShareOfGdp < 0.21,
    `NHE share ${(y10.spending.nheShareOfGdp * 100).toFixed(1)}%`,
  );
});

test("baseline market is stable and the care gap is small", () => {
  assert.ok(y10.health.careGap < 0.08, `care gap ${(y10.health.careGap * 100).toFixed(1)}%`);
  assert.ok(y10.premiums.silver > 4_000 && y10.premiums.silver < 14_000, `silver premium $${Math.round(y10.premiums.silver)}`);
});

test("simulations are deterministic given a seed, and differ across seeds", () => {
  const a = runSimulation(defaultConfig(BASELINE_POLICY, 7));
  const b = runSimulation(defaultConfig(BASELINE_POLICY, 7));
  const c = runSimulation(defaultConfig(BASELINE_POLICY, 8));
  assert.deepEqual(a.years, b.years, "same seed must reproduce identical results");
  assert.notDeepEqual(
    a.years[0]!.coverage,
    c.years[0]!.coverage,
    "different seeds should differ",
  );
});

test("simulation is fast enough for interactive classroom use (10k agents, 15 years)", () => {
  const start = performance.now();
  runSimulation(defaultConfig(BASELINE_POLICY, 99));
  const ms = performance.now() - start;
  assert.ok(ms < 3_000, `simulation took ${Math.round(ms)}ms, expected < 3s`);
});
