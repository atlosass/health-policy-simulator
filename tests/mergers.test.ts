/**
 * Mergers are proposed for the revenue they would bring (DESIGN.md §3.3): the
 * commercial price rise from one fewer competitor, times the share of revenue
 * commercial payers provide. Where prices are administered there is nothing to
 * gain, so providers do not merge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  reformConfig,
  PARAMS,
  BASELINE_POLICY,
  LAX_ANTITRUST,
  SINGLE_PAYER_ADEQUATE,
  AGGRESSIVE_PRICE_CAPS,
} from "../src/engine/index.ts";
import { mergerGain, type SectorSignals } from "../src/engine/provider.ts";
import type { Policy, SimResult } from "../src/engine/index.ts";

const SEEDS = [1, 7, 42, 99, 123];
const REFORM_YEAR = 5;
const signals = (over: Partial<SectorSignals> = {}): SectorSignals => ({
  margin: 0.1,
  demand: 1,
  commercialShare: 0.85,
  commercialPriceIndex: 1,
  ...over,
});
const mergerEvents = (res: SimResult, fromYear = 0) =>
  res.years
    .slice(fromYear)
    .flatMap((y) => y.events)
    .filter((e) => e.type === "merger-approved" || e.type === "merger-blocked");
const approved = (res: SimResult) => mergerEvents(res).filter((e) => e.type === "merger-approved").length;
const run = (policy: Policy, seed: number): SimResult =>
  runSimulation(reformConfig(policy, { seed, years: 20, reformYear: REFORM_YEAR }));

test("the gain from merging is larger in a more concentrated market", () => {
  const g18 = mergerGain(18, signals(), BASELINE_POLICY);
  const g6 = mergerGain(6, signals(), BASELINE_POLICY);
  const g4 = mergerGain(4, signals(), BASELINE_POLICY);
  assert.ok(g18 > 0 && g6 > g18 && g4 > g6, `gains: 18 firms ${g18.toFixed(3)}, 6 firms ${g6.toFixed(3)}, 4 firms ${g4.toFixed(3)}`);
  assert.equal(mergerGain(PARAMS.minFirms, signals(), BASELINE_POLICY), 0, "a market at the firm floor cannot consolidate further");
});

test("there is nothing to gain from merging when prices are administered or capped", () => {
  assert.equal(mergerGain(6, signals({ commercialShare: 0 }), BASELINE_POLICY), 0, "no commercial payers");
  assert.equal(mergerGain(6, signals({ commercialPriceIndex: 0.9 }), { ...BASELINE_POLICY, priceCapIndex: 0.9 }), 0, "a binding price cap");
  const partlyCapped = mergerGain(6, signals(), { ...BASELINE_POLICY, priceCapIndex: 1.05 });
  assert.ok(partlyCapped > 0 && partlyCapped < mergerGain(6, signals(), BASELINE_POLICY), "a cap with headroom limits the gain");
});

test("providers stop proposing mergers under single payer, whatever the antitrust setting", () => {
  for (const seed of SEEDS) {
    const res = run({ ...SINGLE_PAYER_ADEQUATE, antitrustStringency: 0 }, seed);
    assert.equal(mergerEvents(res, REFORM_YEAR).length, 0, `seed ${seed}`);
  }
});

test("providers stop proposing mergers under a binding all-payer price cap", () => {
  for (const seed of SEEDS) {
    const res = run({ ...AGGRESSIVE_PRICE_CAPS, antitrustStringency: 0 }, seed);
    assert.equal(mergerEvents(res, REFORM_YEAR).length, 0, `seed ${seed}`);
  }
});

test("lax antitrust lets more mergers through, and prices rise with them", () => {
  let laxMergers = 0;
  let baseMergers = 0;
  let laxPrice = 0;
  let basePrice = 0;
  for (const seed of SEEDS) {
    const lax = run(LAX_ANTITRUST, seed);
    const base = run(BASELINE_POLICY, seed);
    laxMergers += approved(lax);
    baseMergers += approved(base);
    laxPrice += lax.years.at(-1)!.providers.hospital.commercialPriceIndex;
    basePrice += base.years.at(-1)!.providers.hospital.commercialPriceIndex;
  }
  assert.ok(laxMergers > baseMergers + SEEDS.length, `approved mergers: lax ${laxMergers} vs current law ${baseMergers}`);
  assert.ok(
    laxPrice > 1.08 * basePrice,
    `mean final hospital price: lax ${(laxPrice / SEEDS.length).toFixed(2)} vs ${(basePrice / SEEDS.length).toFixed(2)}`,
  );
});

test("merger draws come from their own stream: the antitrust lever cannot change a market with no mergers", () => {
  // Under single payer no merger is ever proposed, so two runs that differ only
  // in antitrust stringency must be identical in every outcome. (The policy
  // record and the narrative that lists the reform's changes name the lever.)
  const strip = (res: SimResult) => res.years.map(({ policy: _policy, events: _events, ...rest }) => rest);
  const a = run({ ...SINGLE_PAYER_ADEQUATE, antitrustStringency: 0 }, 42);
  const b = run({ ...SINGLE_PAYER_ADEQUATE, antitrustStringency: 1 }, 42);
  assert.deepEqual(strip(a).slice(REFORM_YEAR), strip(b).slice(REFORM_YEAR));
});
