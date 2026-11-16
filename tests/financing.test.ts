/**
 * The financing lever (src/engine/financing.ts): a reform chooses how to raise
 * the health revenue it needs beyond the pre-reform level. The choice changes
 * who pays and how much economic damage raising the money does — and nothing
 * else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  reformConfig,
  defaultConfig,
  describeChanges,
  PARAMS,
  FINANCING,
  FINANCING_OPTIONS,
  BASELINE_POLICY,
  SINGLE_PAYER_ADEQUATE,
} from "../src/engine/index.ts";
import type { Financing, HealthBurden, Policy, SimResult } from "../src/engine/index.ts";
import { encodeState, decodeState, toBase64, TIMING } from "../src/web/levers.ts";
import { eachSeed, reform, POPULATION } from "./helpers.ts";

const REFORM_YEAR = 5;
const singlePayer: Record<Financing, Policy> = {
  general: SINGLE_PAYER_ADEQUATE,
  payroll: { ...SINGLE_PAYER_ADEQUATE, financing: "payroll" },
  topIncome: { ...SINGLE_PAYER_ADEQUATE, financing: "topIncome" },
  flat: { ...SINGLE_PAYER_ADEQUATE, financing: "flat" },
};
const share = (b: HealthBurden): number => (b.outOfPocket + b.premiums + b.wages + b.taxes) / b.income;
const last = (res: SimResult) => res.years.at(-1)!;

test("current law raises health revenue from general revenue", () => {
  assert.equal(BASELINE_POLICY.financing, "general");
  assert.deepEqual(FINANCING_OPTIONS, ["general", "payroll", "topIncome", "flat"]);
  assert.equal(FINANCING.general.costOfFunds, PARAMS.marginalCostOfFunds);
});

test("the financing choice changes who pays and the deadweight loss, and nothing else", () => {
  eachSeed((seed) => {
    const strip = (res: SimResult) => res.years.map(({ policy: _p, events: _e, government: _g, burden: _b, ...rest }) => rest);
    const general = reform(singlePayer.general, seed);
    for (const f of ["payroll", "topIncome", "flat"] as const) {
      const other = reform(singlePayer[f], seed);
      assert.deepEqual(strip(other), strip(general), f);
      assert.equal(last(other).government.revenueRequired, last(general).government.revenueRequired, "the amount to raise is the same");
      // Before the reform nothing differs at all.
      assert.deepEqual(other.years.slice(0, REFORM_YEAR), general.years.slice(0, REFORM_YEAR), f);
    }
  });
});

test("only revenue beyond the pre-reform level is raised the new way", () => {
  eachSeed((seed) => {
    const res = reform(singlePayer.payroll, seed);
    const before = res.years[REFORM_YEAR - 1]!.government.revenueRequired;
    for (const y of res.years.slice(REFORM_YEAR)) {
      assert.ok(Math.abs(y.government.newRevenue - (y.government.revenueRequired - before)) < 1e-6);
    }
    for (const y of res.years.slice(0, REFORM_YEAR)) assert.equal(y.government.newRevenue, 0);
    for (const y of reform(singlePayer.general, seed).years) assert.equal(y.government.newRevenue, 0, "general revenue has no separate new instrument");
  });
});

test("every dollar of tax is still assigned to someone, whatever the instrument", () => {
  eachSeed((seed) => {
    for (const f of FINANCING_OPTIONS) {
      const y = last(reform(singlePayer[f], seed));
      assert.ok(Math.abs(y.burden.all.taxes * POPULATION - y.government.revenueRequired) < 1e-6 * y.government.revenueRequired, f);
      assert.ok(Math.abs(y.burden.all.drag * POPULATION - y.government.deadweightLoss) < 1e-6 * y.government.deadweightLoss, f);
    }
  });
});

test("who pays: a flat premium falls hardest on low incomes, a tax on high earners on high incomes", () => {
  eachSeed((seed) => {
    const b = (f: Financing) => last(reform(singlePayer[f], seed)).burden;
    const low = (f: Financing) => share(b(f).low);
    const high = (f: Financing) => share(b(f).high);
    assert.ok(low("flat") > low("payroll") && low("payroll") > low("general") && low("general") > low("topIncome"), `low third: ${FINANCING_OPTIONS.map((f) => (low(f) * 100).toFixed(1)).join(" / ")}%`);
    assert.ok(high("flat") < high("payroll") && high("payroll") < high("general") && high("general") < high("topIncome"), `high third: ${FINANCING_OPTIONS.map((f) => (high(f) * 100).toFixed(1)).join(" / ")}%`);
    // A flat premium is regressive, a payroll tax roughly proportional, a tax on high earners steeply progressive.
    assert.ok(low("flat") > 1.5 * high("flat"));
    assert.ok(high("topIncome") > 2 * low("topIncome"));
    // The total share of income paid is the same: only its distribution moves.
    assert.ok(Math.abs(share(b("flat").all) - share(b("topIncome").all)) < 1e-9);
  });
});

test("efficiency: the instruments that spare low incomes do the most economic damage per dollar", () => {
  eachSeed((seed) => {
    const dwl = (f: Financing) => last(reform(singlePayer[f], seed)).government.deadweightLoss;
    assert.ok(dwl("flat") < dwl("payroll") && dwl("payroll") < dwl("general") && dwl("general") < dwl("topIncome"));
    const y = last(reform(singlePayer.flat, seed)).government;
    const expected = (PARAMS.marginalCostOfFunds - 1) * (y.revenueRequired - y.newRevenue) + (FINANCING.flat.costOfFunds - 1) * y.newRevenue;
    assert.ok(Math.abs(y.deadweightLoss - expected) < 1e-6 * expected);
  });
});

test("a flat premium charges every income group the same number of dollars of new revenue", () => {
  // Steady-state mode has no pre-reform level, so all revenue is raised the chosen way.
  const y = runSimulation(defaultConfig({ ...SINGLE_PAYER_ADEQUATE, financing: "flat" }, 7, 3)).years[2]!;
  assert.equal(y.government.newRevenue, y.government.revenueRequired);
  assert.ok(Math.abs(y.burden.low.taxes / y.burden.high.taxes - 1) < 1e-9);
  const top = runSimulation(defaultConfig({ ...SINGLE_PAYER_ADEQUATE, financing: "topIncome" }, 7, 3)).years[2]!;
  assert.ok(top.burden.low.taxes < 0.01 * top.burden.high.taxes, "a tax on earnings above $90,000 barely touches the low-income third");
});

test("the financing choice is a switch: with a phase-in it takes effect when the phase-in completes", () => {
  const res = runSimulation(reformConfig(singlePayer.payroll, { years: 10, reformYear: REFORM_YEAR, phaseInYears: 2 }));
  assert.deepEqual(res.years.slice(4, 8).map((y) => y.policy.financing), ["general", "general", "general", "payroll"]);
  assert.equal(res.years[6]!.government.newRevenue, 0);
  assert.ok(res.years[7]!.government.newRevenue > 0);
});

test("the choice is announced, explained in the ledger, and survives a share link", () => {
  assert.deepEqual(describeChanges(BASELINE_POLICY, { ...BASELINE_POLICY, financing: "flat" }), ["new health revenue raised by: general revenue → flat premium"]);
  const res = runSimulation(reformConfig(singlePayer.flat, { years: 7, reformYear: REFORM_YEAR, populationSize: 3000 }));
  const ledger = res.years[REFORM_YEAR]!.events.find((e) => e.type === "fiscal-ledger")!;
  assert.match(ledger.narrative, /new revenue, raised by a flat premium/);
  assert.doesNotMatch(res.years[REFORM_YEAR - 1]!.events.find((e) => e.type === "fiscal-ledger")!.narrative, /new revenue/);

  const state = { seed: 42, policy: singlePayer.topIncome, reformYear: TIMING.defaultReformYear, phaseInYears: 0, challenge: null };
  assert.deepEqual(decodeState(encodeState(state)), state);
  // An unknown value in a hand-edited link falls back to general revenue.
  const tampered = toBase64(JSON.stringify({ seed: 42, financing: "printMoney" }));
  assert.equal(decodeState(tampered)!.policy.financing, "general");
});
