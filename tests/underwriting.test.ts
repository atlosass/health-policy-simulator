/**
 * Medical underwriting vs community rating: opposite uninsured compositions.
 * Under underwriting the sick/poor are priced out; under community rating
 * (unsupported) the healthy walk away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  defaultConfig,
  UNDERWRITTEN_NO_SUPPORTS,
  UNSUPPORTED_COMMUNITY_RATING,
} from "../src/engine/index.ts";

const underwritten = runSimulation(defaultConfig(UNDERWRITTEN_NO_SUPPORTS));
const y10 = underwritten.years[10]!;

test("under underwriting, uninsurance concentrates among low-income (sicker) households", () => {
  assert.ok(
    y10.uninsuredRateByIncome.low > 0.3,
    `low-income uninsured rate ${(y10.uninsuredRateByIncome.low * 100).toFixed(1)}%, expected > 30%`,
  );
  assert.ok(
    y10.uninsuredRateByIncome.high < 0.1,
    `high-income uninsured rate ${(y10.uninsuredRateByIncome.high * 100).toFixed(1)}%, expected < 10%`,
  );
});

test("underwritten individual market is stable (no death spiral) but excludes the sick", () => {
  const y2 = underwritten.years[2]!;
  assert.ok(
    y10.coverage.individual > 0.7 * y2.coverage.individual,
    "underwritten market should not unravel",
  );
  // The underwritten pool is far healthier than the community-rated pool —
  // cream-skimming in action.
  const communityRated = runSimulation(defaultConfig(UNSUPPORTED_COMMUNITY_RATING));
  assert.ok(
    underwritten.years[1]!.individualPoolAvgRisk < 0.5 * communityRated.years[1]!.individualPoolAvgRisk,
    "underwritten pool should be much healthier than a community-rated pool",
  );
});
