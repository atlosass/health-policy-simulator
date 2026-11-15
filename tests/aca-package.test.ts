/**
 * Validation scenario 3 (DESIGN.md §8): an ACA-style package (subsidies +
 * community rating + risk adjustment + public program) stabilizes the market
 * and expands coverage, with gains concentrated among low-income households —
 * and a real fiscal cost including deadweight loss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY, UNSUPPORTED_COMMUNITY_RATING } from "../src/engine/index.ts";
import { eachSeed, steady, pct } from "./helpers.ts";

test("the ACA-style package raises coverage at least 15 points over unsupported community rating", () => {
  eachSeed((seed) => {
    const aca = steady(BASELINE_POLICY, seed).years[10]!;
    const un = steady(UNSUPPORTED_COMMUNITY_RATING, seed).years[10]!;
    assert.ok(aca.insuredRate > un.insuredRate + 0.15, `insured rates: ACA ${pct(aca.insuredRate)} vs unsupported ${pct(un.insuredRate)}`);
  });
});

test("coverage gains are concentrated among low-income households", () => {
  eachSeed((seed) => {
    const aca = steady(BASELINE_POLICY, seed).years[10]!;
    const un = steady(UNSUPPORTED_COMMUNITY_RATING, seed).years[10]!;
    const lowGain = un.uninsuredRateByIncome.low - aca.uninsuredRateByIncome.low;
    const highGain = un.uninsuredRateByIncome.high - aca.uninsuredRateByIncome.high;
    assert.ok(lowGain > highGain, `uninsured-rate reduction: low-income ${pct(lowGain)} vs high-income ${pct(highGain)}`);
  });
});

test("the individual market is stable under the package (no spiral)", () => {
  eachSeed((seed) => {
    const aca = steady(BASELINE_POLICY, seed);
    const y2 = aca.years[2]!;
    const y12 = aca.years[12]!;
    assert.ok(
      y12.premiums.silver < 1.5 * y2.premiums.silver,
      `silver premium drifted $${Math.round(y2.premiums.silver)} -> $${Math.round(y12.premiums.silver)}, expected stability`,
    );
    assert.ok(y12.coverage.individual > 0.5 * y2.coverage.individual, "individual enrollment should not collapse");
  });
});

test("there is no free lunch: subsidies cost revenue and revenue has deadweight loss", () => {
  eachSeed((seed) => {
    const aca = steady(BASELINE_POLICY, seed).years[10]!;
    assert.ok(aca.government.subsidyOutlays > 0, "subsidy outlays should be positive");
    assert.ok(aca.government.deadweightLoss > 0, "deadweight loss should be positive");
    const mcpfExcess = aca.government.deadweightLoss / aca.government.revenueRequired;
    assert.ok(Math.abs(mcpfExcess - 0.3) < 1e-9, "deadweight loss should equal the excess marginal cost of public funds times revenue");
  });
});
