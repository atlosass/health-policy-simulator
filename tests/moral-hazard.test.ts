/**
 * Validation scenario 1 (DESIGN.md §8): RAND Health Insurance Experiment.
 * Moving from free care to high cost-sharing cuts utilization ~25-30%.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { demandMultiplier } from "../src/engine/utilization.ts";

test("free care raises utilization ~25-35% relative to high cost-sharing (RAND HIE)", () => {
  const freeCare = demandMultiplier(0.05);
  const highCostSharing = demandMultiplier(0.95);
  const cut = 1 - highCostSharing / freeCare;
  assert.ok(cut > 0.2 && cut < 0.35, `utilization cut from free care to 95% coinsurance was ${(cut * 100).toFixed(1)}%, expected 20-35%`);
});

test("utilization rises monotonically with plan generosity (moral hazard gradient)", () => {
  // platinum (12% coins) > gold (22%) > silver (32%) > bronze (45%) > uninsured (100%)
  const coinsuranceLadder = [0.12, 0.22, 0.32, 0.45, 1.0];
  for (let i = 1; i < coinsuranceLadder.length; i++) {
    assert.ok(
      demandMultiplier(coinsuranceLadder[i - 1]!) > demandMultiplier(coinsuranceLadder[i]!),
      `demand at coinsurance ${coinsuranceLadder[i - 1]} should exceed demand at ${coinsuranceLadder[i]}`,
    );
  }
});
