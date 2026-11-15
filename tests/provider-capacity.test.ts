/**
 * Validation scenarios 5 & 6 (DESIGN.md §8):
 *  - Price caps set below provider cost yield short-run savings, then capacity
 *    exit and rising waits — coverage without access.
 *  - Single payer at adequate rates achieves universal coverage with modest
 *    waits but a large tax (deadweight) cost; at low rates it rations by queue.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  defaultConfig,
  BASELINE_POLICY,
  AGGRESSIVE_PRICE_CAPS,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
} from "../src/engine/index.ts";

const baseline = runSimulation(defaultConfig(BASELINE_POLICY, 42, 20));
const caps = runSimulation(defaultConfig(AGGRESSIVE_PRICE_CAPS, 42, 20));

test("aggressive price caps cut spending in the short run", () => {
  assert.ok(
    caps.years[1]!.spending.nheShareOfGdp < baseline.years[1]!.spending.nheShareOfGdp,
    "price caps should lower health spending initially",
  );
});

test("but below-cost caps drive capacity exit and rising waits over time", () => {
  const earlyWait = caps.years[1]!.providers.hospital.waitWeeks;
  const lateWait = caps.years.at(-1)!.providers.hospital.waitWeeks;
  assert.ok(lateWait > 3 * earlyWait, `hospital waits went ${earlyWait.toFixed(1)}w -> ${lateWait.toFixed(1)}w`);
  const exit = caps.years.flatMap((y) => y.events).find((e) => e.type === "provider-exit");
  assert.ok(exit, "expected a provider-exit event under below-cost price caps");
});

test("coverage without access: insured but unmet need climbs sharply under the caps", () => {
  const last = caps.years.at(-1)!;
  assert.ok(last.insuredRate > 0.82, "coverage stays high under the caps");
  assert.ok(
    last.health.unmetNeedRate > baseline.years.at(-1)!.health.unmetNeedRate + 0.2,
    "unmet need should rise sharply despite high coverage",
  );
});

test("entry lags differ: hospital capacity (3y) recovers faster than physician (7y)", async () => {
  // Sanity on the configured lags driving the pipeline.
  const { PARAMS } = await import("../src/engine/params.ts");
  assert.ok(
    PARAMS.providerSectors.physician.entryLagYears > PARAMS.providerSectors.hospital.entryLagYears,
    "physician training lag should exceed hospital construction lag",
  );
});

test("single payer at adequate rates: universal coverage, modest waits, large tax cost", () => {
  const sp = runSimulation(defaultConfig(SINGLE_PAYER_ADEQUATE, 42, 20));
  const last = sp.years.at(-1)!;
  assert.equal(last.coverage.uninsured, 0, "single payer covers everyone");
  assert.ok(last.providers.hospital.waitWeeks < 8, `hospital waits ${last.providers.hospital.waitWeeks.toFixed(1)}w should stay modest at adequate rates`);
  assert.ok(
    last.government.deadweightLoss > baseline.years.at(-1)!.government.deadweightLoss * 2,
    "financing universal public coverage carries a much larger deadweight cost",
  );
});

test("single payer at low rates rations by queue (waits far exceed the adequate-rate case)", () => {
  const adequate = runSimulation(defaultConfig(SINGLE_PAYER_ADEQUATE, 42, 20));
  const low = runSimulation(defaultConfig(SINGLE_PAYER_LOW_RATES, 42, 20));
  assert.equal(low.years.at(-1)!.coverage.uninsured, 0, "still universal coverage");
  assert.ok(
    low.years.at(-1)!.providers.hospital.waitWeeks > 3 * adequate.years.at(-1)!.providers.hospital.waitWeeks,
    "underpaying providers should produce far longer queues than paying them adequately",
  );
});
