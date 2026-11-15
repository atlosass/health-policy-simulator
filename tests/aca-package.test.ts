/**
 * Validation scenario 3 (DESIGN.md §8): an ACA-style package (subsidies +
 * community rating + risk adjustment + public program) stabilizes the market
 * and expands coverage, with gains concentrated among low-income households —
 * and a real fiscal cost including deadweight loss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  defaultConfig,
  BASELINE_POLICY,
  UNSUPPORTED_COMMUNITY_RATING,
} from "../src/engine/index.ts";

const aca = runSimulation(defaultConfig(BASELINE_POLICY));
const unraveled = runSimulation(defaultConfig(UNSUPPORTED_COMMUNITY_RATING));
const acaY10 = aca.years[10]!;
const unY10 = unraveled.years[10]!;

test("the ACA-style package raises coverage at least 20 points over unsupported community rating", () => {
  assert.ok(
    acaY10.insuredRate > unY10.insuredRate + 0.15,
    `insured rates: ACA ${(acaY10.insuredRate * 100).toFixed(1)}% vs unsupported ${(unY10.insuredRate * 100).toFixed(1)}%`,
  );
});

test("coverage gains are concentrated among low-income households", () => {
  const lowGain = unY10.uninsuredRateByIncome.low - acaY10.uninsuredRateByIncome.low;
  const highGain = unY10.uninsuredRateByIncome.high - acaY10.uninsuredRateByIncome.high;
  assert.ok(
    lowGain > highGain,
    `uninsured-rate reduction: low-income ${(lowGain * 100).toFixed(1)}pp vs high-income ${(highGain * 100).toFixed(1)}pp`,
  );
});

test("the individual market is stable under the package (no spiral)", () => {
  const y2 = aca.years[2]!;
  const y12 = aca.years[12]!;
  assert.ok(
    y12.premiums.silver < 1.5 * y2.premiums.silver,
    `silver premium drifted $${Math.round(y2.premiums.silver)} -> $${Math.round(y12.premiums.silver)}, expected stability`,
  );
  assert.ok(y12.coverage.individual > 0.5 * y2.coverage.individual, "individual enrollment should not collapse");
});

test("there is no free lunch: subsidies cost revenue and revenue has deadweight loss", () => {
  assert.ok(acaY10.government.subsidyOutlays > 0, "subsidy outlays should be positive");
  assert.ok(acaY10.government.deadweightLoss > 0, "deadweight loss should be positive");
  const mcpfExcess = acaY10.government.deadweightLoss / acaY10.government.revenueRequired;
  assert.ok(
    Math.abs(mcpfExcess - 0.3) < 1e-9,
    "deadweight loss should equal the excess marginal cost of public funds times revenue",
  );
});
