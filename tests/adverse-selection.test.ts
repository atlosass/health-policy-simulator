/**
 * Validation scenario 2 (DESIGN.md §8): community rating with no mandate, no
 * subsidies, and no risk adjustment unravels the individual market within ~5
 * years — the pre-ACA New York pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation, defaultConfig, UNSUPPORTED_COMMUNITY_RATING } from "../src/engine/index.ts";

const result = runSimulation(defaultConfig(UNSUPPORTED_COMMUNITY_RATING));
const y0 = result.years[0]!;
const y5 = result.years[5]!;

test("individual-market enrollment collapses within 5 years", () => {
  assert.ok(
    y5.coverage.individual < 0.35 * y0.coverage.individual,
    `enrollment went ${y0.coverage.individual} -> ${y5.coverage.individual}, expected at least a 65% decline`,
  );
});

test("premiums spiral upward as the pool sickens", () => {
  assert.ok(
    y5.premiums.silver > 2 * y0.premiums.silver,
    `silver premium went $${Math.round(y0.premiums.silver)} -> $${Math.round(y5.premiums.silver)}, expected more than 2x`,
  );
});

test("the remaining pool is progressively sicker (selection, not random attrition)", () => {
  const y2 = result.years[2]!;
  assert.ok(
    y2.individualPoolAvgRisk > 1.5 * y0.individualPoolAvgRisk,
    `pool average risk went $${Math.round(y0.individualPoolAvgRisk)} -> $${Math.round(y2.individualPoolAvgRisk)}, expected sharp deterioration`,
  );
});

test("a market-collapse explanation event is emitted", () => {
  const collapse = result.years
    .flatMap((y) => y.events)
    .find((e) => e.type === "individual-market-collapse");
  assert.ok(collapse, "expected an individual-market-collapse event in the explanation log");
});

test("ESI is insulated from the individual-market spiral", () => {
  const esiShare0 = y0.coverage.esi / 10_000;
  const esiShareEnd = result.years.at(-1)!.coverage.esi / 10_000;
  assert.ok(Math.abs(esiShareEnd - esiShare0) < 0.08, "ESI coverage should hold roughly steady through the spiral");
});
