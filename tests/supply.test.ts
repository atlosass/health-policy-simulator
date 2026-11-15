/**
 * Supply follows demand, with lags and two policy gates (DESIGN.md §3.3).
 * A coverage expansion opens a queue; hospitals build their way out of it in a
 * few years, physicians take much longer because of the training lag and the
 * residency-slot ceiling. Certificate of Need and residency slots change how
 * (and whether) the queue clears. Checked on several seeds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  reformConfig,
  PARAMS,
  BASELINE_POLICY,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
} from "../src/engine/index.ts";
import type { Policy, SimResult } from "../src/engine/index.ts";

type Year = SimResult["years"][number];

const SEEDS = [1, 7, 42];
const REFORM_YEAR = 5;
const run = (policy: Policy, seed: number): SimResult =>
  runSimulation(reformConfig(policy, { seed, years: 20, reformYear: REFORM_YEAR }));

/** Mean of a per-year reading over an inclusive range of years. */
const avg = (res: SimResult, from: number, to: number, read: (y: Year) => number): number => {
  const ys = res.years.slice(from, to + 1);
  return ys.reduce((sum, y) => sum + read(y), 0) / ys.length;
};
const hospUtil = (y: Year) => y.providers.hospital.utilization;
const physUtil = (y: Year) => y.providers.physician.utilization;

test("under current law, capacity tracks demand and utilization stays near its target", () => {
  for (const seed of SEEDS) {
    const res = run(BASELINE_POLICY, seed);
    for (const read of [hospUtil, physUtil]) {
      const late = avg(res, 12, 19, read);
      assert.ok(Math.abs(late - PARAMS.targetUtilization) < 0.06, `seed ${seed}: late utilization ${late.toFixed(2)}`);
    }
  }
});

test("a coverage expansion opens a queue that hospitals build their way out of", () => {
  for (const seed of SEEDS) {
    const res = run(SINGLE_PAYER_ADEQUATE, seed);
    const atReform = avg(res, REFORM_YEAR, REFORM_YEAR + 1, hospUtil);
    const late = avg(res, 15, 19, hospUtil);
    assert.ok(late < atReform - 0.05, `seed ${seed}: hospital utilization ${atReform.toFixed(2)} → ${late.toFixed(2)}`);
    assert.ok(
      res.years.at(-1)!.providers.hospital.capacity > 1.05 * res.years[REFORM_YEAR]!.providers.hospital.capacity,
      `seed ${seed}: hospital capacity should have grown`,
    );
  }
});

test("physicians take longer than hospitals to catch up (training lag and residency slots)", () => {
  for (const seed of SEEDS) {
    const res = run(SINGLE_PAYER_ADEQUATE, seed);
    // Five to seven years after the reform: hospitals have expanded, the first new physicians have not arrived.
    const hosp = avg(res, REFORM_YEAR + 5, REFORM_YEAR + 7, hospUtil);
    const phys = avg(res, REFORM_YEAR + 5, REFORM_YEAR + 7, physUtil);
    assert.ok(phys > hosp + 0.04, `seed ${seed}: physician ${phys.toFixed(2)} vs hospital ${hosp.toFixed(2)}`);
    const gate = res.years.flatMap((y) => y.events).find((e) => e.type === "supply-gate" && e.data.sector === "physician");
    assert.ok(gate, `seed ${seed}: expected the residency-slot ceiling to bind`);
  }
});

test("Certificate of Need keeps the hospital queue from clearing", () => {
  for (const seed of SEEDS) {
    const open = run(SINGLE_PAYER_ADEQUATE, seed);
    const frozen = run({ ...SINGLE_PAYER_ADEQUATE, certificateOfNeed: 1 }, seed);
    const a = avg(open, 14, 19, hospUtil);
    const b = avg(frozen, 14, 19, hospUtil);
    assert.ok(b > a + 0.06, `seed ${seed}: hospital utilization ${a.toFixed(2)} without CON vs ${b.toFixed(2)} with`);
    // Projects approved before the freeze still open; after that, nothing new can.
    const lastApproved = REFORM_YEAR + PARAMS.providerSectors.hospital.entryLagYears;
    assert.ok(
      frozen.years.at(-1)!.providers.hospital.capacity <= 1.0001 * frozen.years[lastApproved]!.providers.hospital.capacity,
      `seed ${seed}: hospital capacity cannot grow under a full Certificate of Need freeze`,
    );
  }
});

test("more residency slots clear the physician queue sooner, but only after the training lag", () => {
  const lag = PARAMS.providerSectors.physician.entryLagYears;
  for (const seed of SEEDS) {
    const base = run(SINGLE_PAYER_ADEQUATE, seed);
    const more = run({ ...SINGLE_PAYER_ADEQUATE, residencySlots: 2 }, seed);
    // Nothing the lever does can arrive before the first cohort finishes training.
    for (let year = 0; year < REFORM_YEAR + lag; year++) {
      assert.equal(more.years[year]!.providers.physician.capacity, base.years[year]!.providers.physician.capacity, `seed ${seed}, year ${year}`);
    }
    const a = avg(base, REFORM_YEAR + lag + 2, REFORM_YEAR + lag + 5, physUtil);
    const b = avg(more, REFORM_YEAR + lag + 2, REFORM_YEAR + lag + 5, physUtil);
    assert.ok(b < a - 0.03, `seed ${seed}: physician utilization ${a.toFixed(2)} at 1.0× slots vs ${b.toFixed(2)} at 2.0×`);
  }
});

test("cutting residency slots under current law shrinks the physician workforce after the lag", () => {
  const lag = PARAMS.providerSectors.physician.entryLagYears;
  for (const seed of SEEDS) {
    const base = run(BASELINE_POLICY, seed);
    const cut = run({ ...BASELINE_POLICY, residencySlots: 0.5 }, seed);
    assert.equal(
      cut.years[REFORM_YEAR + lag - 1]!.providers.physician.capacity,
      base.years[REFORM_YEAR + lag - 1]!.providers.physician.capacity,
      `seed ${seed}: no effect before the lag`,
    );
    const a = base.years.at(-1)!.providers.physician.capacity;
    const b = cut.years.at(-1)!.providers.physician.capacity;
    assert.ok(b < 0.97 * a, `seed ${seed}: physician capacity ${(b / a).toFixed(3)} of the no-cut level`);
  }
});

test("providers paid below cost stop investing, so the queue never clears", () => {
  for (const seed of SEEDS) {
    const res = run(SINGLE_PAYER_LOW_RATES, seed);
    const last = res.years.at(-1)!;
    assert.ok(
      last.providers.hospital.capacity < 0.75 * res.years[REFORM_YEAR]!.providers.hospital.capacity,
      `seed ${seed}: hospital capacity should have shrunk`,
    );
    assert.ok(last.providers.hospital.utilization > 1.2, `seed ${seed}: hospital utilization ${last.providers.hospital.utilization.toFixed(2)}`);
  }
});
