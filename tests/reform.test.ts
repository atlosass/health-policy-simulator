/**
 * The reform timeline: the system runs under current law first, then the
 * reform arrives (optionally phased in). This is the mode the web app uses.
 * Relational checks run on several seeds so they are not fitted to one draw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/engine/index.ts";
import {
  runSimulation,
  reformConfig,
  defaultConfig,
  PARAMS,
  BASELINE_POLICY,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
} from "../src/engine/index.ts";
import type { Policy, SimResult } from "../src/engine/index.ts";

const SEEDS = [1, 7, 42];
const REFORM_YEAR = 5;

test("the years before a reform are identical to a run with no reform", () => {
  for (const seed of SEEDS) {
    const none = runSimulation(reformConfig(BASELINE_POLICY, { seed, years: 8, reformYear: REFORM_YEAR }));
    const reform = runSimulation(reformConfig(SINGLE_PAYER_ADEQUATE, { seed, years: 8, reformYear: REFORM_YEAR }));
    assert.deepEqual(reform.years.slice(0, REFORM_YEAR), none.years.slice(0, REFORM_YEAR), `seed ${seed}`);
    assert.notDeepEqual(reform.years[REFORM_YEAR]!.coverage, none.years[REFORM_YEAR]!.coverage, `seed ${seed}`);
  }
});

test("a coverage expansion strains the capacity that existed before it", () => {
  for (const seed of SEEDS) {
    const res = runSimulation(reformConfig(SINGLE_PAYER_ADEQUATE, { seed, years: 8, reformYear: REFORM_YEAR }));
    const before = res.years[REFORM_YEAR - 1]!.providers.hospital;
    const after = res.years[REFORM_YEAR]!.providers.hospital;
    assert.ok(
      after.utilization > before.utilization * 1.08,
      `seed ${seed}: hospital utilization ${before.utilization.toFixed(2)} → ${after.utilization.toFixed(2)}`,
    );
    assert.ok(after.waitWeeks > before.waitWeeks * 1.3, `seed ${seed}: waits ${before.waitWeeks.toFixed(1)} → ${after.waitWeeks.toFixed(1)} weeks`);
  }
});

test("steady-state mode cannot show that strain (capacity is sized to the reformed system)", () => {
  const y0 = runSimulation(defaultConfig(SINGLE_PAYER_ADEQUATE, 42, 2)).years[0]!;
  assert.ok(Math.abs(y0.providers.hospital.utilization - PARAMS.targetUtilization) < 1e-9);
});

test("a phase-in moves dials gradually and flips switches when it completes", () => {
  const res = runSimulation(reformConfig(SINGLE_PAYER_ADEQUATE, { years: 10, reformYear: REFORM_YEAR, phaseInYears: 3 }));
  const from = BASELINE_POLICY.publicPriceRatio;
  const to = SINGLE_PAYER_ADEQUATE.publicPriceRatio;
  assert.deepEqual(
    res.years.slice(4, 9).map((y) => y.reformProgress),
    [0, 0.25, 0.5, 0.75, 1],
  );
  for (const [year, f] of [[5, 0.25], [6, 0.5], [7, 0.75]] as const) {
    const p = res.years[year]!.policy;
    assert.equal(p.singlePayer, false, `single payer has not switched on yet in year ${year}`);
    assert.ok(Math.abs(p.publicPriceRatio - (from + (to - from) * f)) < 1e-9, `payment rate in year ${year}`);
  }
  assert.deepEqual(res.years[8]!.policy, SINGLE_PAYER_ADEQUATE);
  assert.equal(res.years[7]!.coverage.esi > 0, true, "employer coverage persists until the switch");
  assert.equal(res.years[8]!.coverage.esi, 0);
});

test("a phased-in mandate raises coverage step by step", () => {
  for (const seed of SEEDS) {
    const res = runSimulation(
      reformConfig({ ...BASELINE_POLICY, mandatePenalty: 1500 }, { seed, years: 9, reformYear: REFORM_YEAR, phaseInYears: 2 }),
    );
    assert.deepEqual(res.years.slice(4, 8).map((y) => Math.round(y.policy.mandatePenalty)), [0, 500, 1000, 1500]);
    const ins = res.years.map((y) => y.insuredRate);
    assert.ok(ins[5]! > ins[4]! && ins[6]! > ins[5]! && ins[7]! > ins[6]!, `seed ${seed}: ${ins.slice(4, 8).map((x) => (x * 100).toFixed(1)).join(" → ")}`);
  }
});

test("the reform is announced in the explanation log", () => {
  const res = runSimulation(reformConfig(SINGLE_PAYER_ADEQUATE, { years: 10, reformYear: REFORM_YEAR, phaseInYears: 3 }));
  const begins = res.years[REFORM_YEAR]!.events.find((e) => e.type === "reform-begins");
  assert.ok(begins, "expected a reform-begins event in the reform year");
  assert.match(begins.narrative, /single payer: off → on/);
  assert.match(begins.narrative, /public payment rate: 0\.6 → 0\.9/);
  assert.ok(res.years[REFORM_YEAR + 3]!.events.some((e) => e.type === "reform-complete"));
  const policyEvents = res.years.flatMap((y) => y.events).filter((e) => e.module === "policy");
  assert.equal(policyEvents.length, 2);
  // A "reform" identical to current law announces nothing.
  const none = runSimulation(reformConfig(BASELINE_POLICY, { years: 7, reformYear: REFORM_YEAR }));
  assert.equal(none.years.flatMap((y) => y.events).filter((e) => e.module === "policy").length, 0);
});

test("single payer leaves no stale private-market readings", () => {
  for (const policy of [SINGLE_PAYER_ADEQUATE, SINGLE_PAYER_LOW_RATES]) {
    const res = runSimulation(reformConfig(policy, { years: 14, reformYear: REFORM_YEAR }));
    assert.ok(res.years[REFORM_YEAR - 1]!.employer.offerRate > 0.5);
    for (const y of res.years.slice(REFORM_YEAR)) {
      assert.equal(y.coverage.esi, 0);
      assert.deepEqual(y.employer, { offerRate: 0, avgPremium: 0, avgActuarialValue: 0, wageIncidencePerEnrollee: 0 });
      assert.equal(y.government.esiTaxExpenditure, 0);
      assert.equal(
        y.events.some((e) => e.type === "price-change"),
        false,
        `no commercial-price news in a year with no commercial payers (year ${y.year})`,
      );
      // Providers are paid the administered rate, whatever the unused commercial index says.
      assert.ok(Math.abs(y.providers.hospital.avgPricePaid - policy.publicPriceRatio) < 1e-9);
    }
  }
});

test("narrative dollars are on the same national scale as the ledger", () => {
  const res = runSimulation(reformConfig(BASELINE_POLICY, { years: 3, reformYear: 1 }));
  const y = res.years[2]!;
  const ledger = y.events.find((e) => e.type === "fiscal-ledger")!;
  const national = PARAMS.displayPopulation / res.config.populationSize;
  assert.equal(ledger.data.subsidies, Math.round(y.government.subsidyOutlays * national));
  assert.equal(ledger.data.esiTaxExpenditure, Math.round(y.government.esiTaxExpenditure * national));
  assert.match(ledger.narrative, /(billion|trillion)/);
});

test("every reported number is finite, for every preset, in both modes", () => {
  const presets = Object.entries(engine).filter(
    ([name, value]) => /^[A-Z_]+$/.test(name) && typeof value === "object" && value !== null && "singlePayer" in value,
  ) as [string, Policy][];
  assert.ok(presets.length >= 12, `found ${presets.length} presets`);
  const findNonFinite = (res: SimResult): string | null => {
    const walk = (v: unknown, path: string): string | null => {
      if (typeof v === "number") return Number.isFinite(v) ? null : path;
      if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          const hit = walk(child, `${path}.${k}`);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(res.years, "years");
  };
  for (const [name, policy] of presets) {
    assert.equal(findNonFinite(runSimulation(reformConfig(policy, { populationSize: 3000, years: 12, reformYear: 3 }))), null, `${name} (reform mode)`);
    assert.equal(findNonFinite(runSimulation({ seed: 42, populationSize: 3000, years: 12, policy })), null, `${name} (steady state)`);
  }
});
