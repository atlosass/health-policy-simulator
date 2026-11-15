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
  PARAMS,
  BASELINE_POLICY,
  AGGRESSIVE_PRICE_CAPS,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
} from "../src/engine/index.ts";
import { eachSeed, steady, pct } from "./helpers.ts";

test("aggressive price caps cut spending in the short run", () => {
  eachSeed((seed) => {
    const caps = steady(AGGRESSIVE_PRICE_CAPS, seed);
    const baseline = steady(BASELINE_POLICY, seed);
    assert.ok(caps.years[1]!.spending.nheShareOfGdp < baseline.years[1]!.spending.nheShareOfGdp, "price caps should lower health spending initially");
  });
});

test("but below-cost caps drive capacity exit and rising waits over time", () => {
  eachSeed((seed) => {
    const caps = steady(AGGRESSIVE_PRICE_CAPS, seed);
    const earlyWait = caps.years[1]!.providers.hospital.waitWeeks;
    const lateWait = caps.years.at(-1)!.providers.hospital.waitWeeks;
    assert.ok(lateWait > 3 * earlyWait, `hospital waits went ${earlyWait.toFixed(1)}w -> ${lateWait.toFixed(1)}w`);
    const exit = caps.years.flatMap((y) => y.events).find((e) => e.type === "provider-exit");
    assert.ok(exit, "expected a provider-exit event under below-cost price caps");
  });
});

test("coverage without access: insured, but the care gap climbs sharply under the caps", () => {
  eachSeed((seed) => {
    const last = steady(AGGRESSIVE_PRICE_CAPS, seed).years.at(-1)!;
    const base = steady(BASELINE_POLICY, seed).years.at(-1)!;
    assert.ok(last.insuredRate > 0.82, "coverage stays high under the caps");
    assert.ok(
      last.health.careGap > base.health.careGap + 0.2,
      `care gap should rise sharply despite high coverage (caps ${pct(last.health.careGap)} vs baseline ${pct(base.health.careGap)})`,
    );
  });
});

test("entry lags differ: hospital capacity (3y) arrives sooner than physician (7y)", () => {
  assert.ok(
    PARAMS.providerSectors.physician.entryLagYears > PARAMS.providerSectors.hospital.entryLagYears,
    "physician training lag should exceed hospital construction lag",
  );
});

test("single payer at adequate rates: universal coverage, modest waits, large tax cost", () => {
  eachSeed((seed) => {
    const last = steady(SINGLE_PAYER_ADEQUATE, seed).years.at(-1)!;
    const base = steady(BASELINE_POLICY, seed).years.at(-1)!;
    assert.equal(last.coverage.uninsured, 0, "single payer covers everyone");
    assert.ok(last.providers.hospital.waitWeeks < 8, `hospital waits ${last.providers.hospital.waitWeeks.toFixed(1)}w should stay modest at adequate rates`);
    assert.ok(last.government.deadweightLoss > base.government.deadweightLoss * 2, "financing universal public coverage carries a much larger deadweight cost");
  });
});

test("single payer at low rates rations by queue (waits far exceed the adequate-rate case)", () => {
  eachSeed((seed) => {
    const adequate = steady(SINGLE_PAYER_ADEQUATE, seed).years.at(-1)!;
    const low = steady(SINGLE_PAYER_LOW_RATES, seed).years.at(-1)!;
    assert.equal(low.coverage.uninsured, 0, "still universal coverage");
    assert.ok(
      low.providers.hospital.waitWeeks > 3 * adequate.providers.hospital.waitWeeks,
      "underpaying providers should produce far longer queues than paying them adequately",
    );
  });
});
