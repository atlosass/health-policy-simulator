/**
 * Validation scenario 2 (DESIGN.md §8): community rating with no mandate, no
 * subsidies, and no risk adjustment unravels the individual market within ~5
 * years — the pre-ACA New York pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UNSUPPORTED_COMMUNITY_RATING } from "../src/engine/index.ts";
import { eachSeed, steady, POPULATION } from "./helpers.ts";

test("individual-market enrollment collapses within 5 years", () => {
  eachSeed((seed) => {
    const res = steady(UNSUPPORTED_COMMUNITY_RATING, seed);
    const y0 = res.years[0]!;
    const y5 = res.years[5]!;
    assert.ok(
      y5.coverage.individual < 0.35 * y0.coverage.individual,
      `enrollment went ${y0.coverage.individual} -> ${y5.coverage.individual}, expected at least a 65% decline`,
    );
  });
});

test("premiums spiral upward as the pool sickens", () => {
  eachSeed((seed) => {
    const res = steady(UNSUPPORTED_COMMUNITY_RATING, seed);
    // Measured at the peak of the first five years: once the market has
    // emptied, a posted premium with almost no one paying it means little.
    const y0 = res.years[0]!;
    const peak = Math.max(...res.years.slice(1, 6).map((y) => y.premiums.silver));
    assert.ok(
      peak > 2 * y0.premiums.silver,
      `silver premium went $${Math.round(y0.premiums.silver)} -> a peak of $${Math.round(peak)}, expected more than 2x`,
    );
  });
});

test("the remaining pool is progressively sicker (selection, not random attrition)", () => {
  eachSeed((seed) => {
    const res = steady(UNSUPPORTED_COMMUNITY_RATING, seed);
    const y0 = res.years[0]!;
    const y2 = res.years[2]!;
    assert.ok(
      y2.individualPoolAvgRisk > 1.5 * y0.individualPoolAvgRisk,
      `pool average risk went $${Math.round(y0.individualPoolAvgRisk)} -> $${Math.round(y2.individualPoolAvgRisk)}, expected sharp deterioration`,
    );
  });
});

test("a market-collapse explanation event is emitted", () => {
  eachSeed((seed) => {
    const collapse = steady(UNSUPPORTED_COMMUNITY_RATING, seed)
      .years.flatMap((y) => y.events)
      .find((e) => e.type === "individual-market-collapse");
    assert.ok(collapse, "expected an individual-market-collapse event in the explanation log");
  });
});

test("ESI is insulated from the individual-market spiral", () => {
  eachSeed((seed) => {
    const res = steady(UNSUPPORTED_COMMUNITY_RATING, seed);
    const esiShare0 = res.years[0]!.coverage.esi / POPULATION;
    const esiShareEnd = res.years.at(-1)!.coverage.esi / POPULATION;
    assert.ok(Math.abs(esiShareEnd - esiShare0) < 0.08, "ESI coverage should hold roughly steady through the spiral");
  });
});
