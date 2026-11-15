/**
 * Medical underwriting vs community rating: opposite uninsured compositions.
 * Under underwriting the sick/poor are priced out; under community rating
 * (unsupported) the healthy walk away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UNDERWRITTEN_NO_SUPPORTS, UNSUPPORTED_COMMUNITY_RATING } from "../src/engine/index.ts";
import { eachSeed, steady, pct } from "./helpers.ts";

test("under underwriting, uninsurance concentrates among low-income (sicker) households", () => {
  eachSeed((seed) => {
    const y10 = steady(UNDERWRITTEN_NO_SUPPORTS, seed).years[10]!;
    assert.ok(y10.uninsuredRateByIncome.low > 0.3, `low-income uninsured rate ${pct(y10.uninsuredRateByIncome.low)}, expected > 30%`);
    assert.ok(y10.uninsuredRateByIncome.high < 0.1, `high-income uninsured rate ${pct(y10.uninsuredRateByIncome.high)}, expected < 10%`);
  });
});

test("underwritten individual market is stable (no death spiral) but excludes the sick", () => {
  eachSeed((seed) => {
    const underwritten = steady(UNDERWRITTEN_NO_SUPPORTS, seed);
    assert.ok(
      underwritten.years[10]!.coverage.individual > 0.7 * underwritten.years[2]!.coverage.individual,
      "underwritten market should not unravel",
    );
    // The underwritten pool is far healthier than the community-rated pool —
    // cream-skimming in action.
    const communityRated = steady(UNSUPPORTED_COMMUNITY_RATING, seed);
    assert.ok(
      underwritten.years[1]!.individualPoolAvgRisk < 0.5 * communityRated.years[1]!.individualPoolAvgRisk,
      "underwritten pool should be much healthier than a community-rated pool",
    );
  });
});
