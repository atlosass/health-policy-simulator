/**
 * Calibration targets (src/engine/calibration.ts, DESIGN.md §8): the current-law
 * run must stay recognizable as the US. Each target is the mean over several
 * seeds of the first five years, checked against a band set from real-world
 * reference figures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { measureCalibration, CALIBRATION_TARGETS, BASELINE_POLICY } from "../src/engine/index.ts";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const rows = measureCalibration(BASELINE_POLICY, SEEDS);
const show = (x: number, unit: string): string =>
  unit === "$" ? `$${Math.round(x).toLocaleString()}` : unit === "$B" ? `$${Math.round(x)}B` : `${x.toFixed(1)}${unit}`;

for (const row of rows) {
  const t = row.target;
  if (t.status === "met") {
    test(`calibration: ${t.label} is within ${show(t.low, t.unit)}–${show(t.high, t.unit)}`, () => {
      assert.ok(
        row.inBand,
        `${t.label}: mean ${show(row.mean, t.unit)} over ${SEEDS.length} seeds (single seeds ${show(row.min, t.unit)}–${show(row.max, t.unit)}); reference ${show(t.reference, t.unit)}`,
      );
    });
  } else {
    test(`calibration: ${t.label} is a recorded miss, and still is`, () => {
      // If this starts passing, the model has changed: promote the target to "met".
      assert.equal(row.inBand, false, `${t.label} is now inside its band at ${show(row.mean, t.unit)}; update its status`);
    });
  }
}

test("every target states where its reference figure comes from", () => {
  for (const t of CALIBRATION_TARGETS) {
    assert.ok(t.basis.length > 20, t.key);
    assert.ok(t.low <= t.reference && t.reference <= t.high, `${t.key}: the reference value should sit inside its own band`);
  }
});

test("health spending starts a current-law run close to 17.5% of GDP", () => {
  const nhe = rows.find((r) => r.target.key === "nhe")!;
  assert.ok(Math.abs(nhe.mean - 17.5) < 0.4, `mean ${nhe.mean.toFixed(2)}%`);
});
