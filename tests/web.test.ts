/**
 * The parts of the dashboard that are plain logic: share links, challenges,
 * the comparison list, and the summaries across runs. (Rendering is checked in
 * a browser.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation, reformConfig, BASELINE_POLICY, SINGLE_PAYER_ADEQUATE, NHS_WELL_FUNDED } from "../src/engine/index.ts";
import type { SimResult } from "../src/engine/index.ts";
import { encodeState, decodeState, TIMING, type ShareState } from "../src/web/levers.ts";
import { sanitizeChallenge, judge, describeCriterion, sameChallenge, MAX_CRITERIA, type Challenge } from "../src/web/challenge.ts";
import { parsePackages, encodeCompare, decodeCompare } from "../src/web/compare.ts";
import { band, statAt, pairedDelta } from "../src/web/runs.ts";
import { METRICS, METRIC_BY_KEY } from "../src/web/metrics.ts";

const challenge: Challenge = {
  title: "Cover everyone — sans dépasser 19 % <b>",
  criteria: [
    { metric: "insured", op: ">=", value: 97 },
    { metric: "nhe", op: "<=", value: 19 },
  ],
};
const share = (over: Partial<ShareState> = {}): ShareState => ({
  seed: 42,
  policy: { ...BASELINE_POLICY },
  reformYear: TIMING.defaultReformYear,
  phaseInYears: 0,
  challenge: null,
  ...over,
});
const small = (policy = BASELINE_POLICY, seed = 1): SimResult =>
  runSimulation(reformConfig(policy, { seed, populationSize: 1500, years: 8, reformYear: 3 }));

test("a share link round-trips the package, its timing, and a challenge with any characters in its title", () => {
  const state = share({ seed: 7, policy: { ...NHS_WELL_FUNDED, taxExclusionCap: 4000 }, reformYear: 6, phaseInYears: 2, challenge });
  assert.deepEqual(decodeState(encodeState(state)), state);
  assert.deepEqual(decodeState(encodeState(share())), share(), "the default state is the shortest link");
});

test("links from before challenges existed still open", () => {
  // {"seed":42,"singlePayer":true,"publicPriceRatio":0.9}, as the previous version encoded it.
  const old = Buffer.from(JSON.stringify({ seed: 42, singlePayer: true, publicPriceRatio: 0.9 })).toString("base64").replace(/=+$/, "");
  assert.deepEqual(decodeState(old), share({ policy: SINGLE_PAYER_ADEQUATE }));
});

test("a damaged or hand-edited link cannot smuggle in a malformed challenge", () => {
  assert.equal(sanitizeChallenge(null), null);
  assert.equal(sanitizeChallenge({ t: "x", c: "nope" }), null);
  assert.equal(sanitizeChallenge({ t: "x", c: [["notAMetric", ">=", 1], ["insured", ">=", "97"], ["insured", ">=", Infinity]] }), null);
  const kept = sanitizeChallenge({ t: 123, c: [["insured", "weird-op", 97], ...Array.from({ length: 20 }, () => ["nhe", "<=", 18])] })!;
  assert.equal(kept.title, "", "a non-text title is dropped");
  assert.equal(kept.criteria[0]!.op, ">=", "an unknown comparison falls back to 'at least'");
  assert.equal(kept.criteria.length, MAX_CRITERIA);
  assert.equal(sanitizeChallenge({ t: "t".repeat(500), c: [["insured", ">=", 90]] })!.title.length, 80);
  assert.equal(decodeState("not base64 at all!"), null);
});

test("a challenge is judged on the final year, averaged over the runs", () => {
  const runs = [small(SINGLE_PAYER_ADEQUATE, 1), small(SINGLE_PAYER_ADEQUATE, 2)];
  const verdicts = judge({ title: "", criteria: [{ metric: "insured", op: ">=", value: 99 }, { metric: "insured", op: "<=", value: 50 }] }, runs);
  assert.equal(verdicts[0]!.value, 100);
  assert.deepEqual(verdicts.map((v) => v.met), [true, false]);
  assert.equal(describeCriterion(challenge.criteria[1]!), "Health spending at most 19.0%");
  assert.ok(sameChallenge(challenge, structuredClone(challenge)));
  assert.equal(sameChallenge(challenge, { ...challenge, title: "other" }), false);
});

test("every headline measure reads a finite number and formats it", () => {
  const y = small().years.at(-1)!;
  for (const m of METRICS) {
    const v = m.read(y);
    assert.ok(Number.isFinite(v), m.key);
    assert.ok(m.fmt(v).length > 0 && m.fmtDelta(Math.abs(v)).length > 0, m.key);
  }
  assert.ok(METRIC_BY_KEY.get("insured")!.read(y) > 50, "percentages are in percent, not fractions");
});

test("the comparison list accepts named links, bare links and bare hashes, and reports the rest", () => {
  const a = encodeState(share({ policy: SINGLE_PAYER_ADEQUATE, challenge }));
  const b = encodeState(share({ policy: NHS_WELL_FUNDED, seed: 9 }));
  const { specs, errors } = parsePackages(`Team A | http://localhost:5173/#${a}\n\n  https://example.org/sim/#${b}\n${b}\nBroken | http://example.org/#zzzz\n`);
  assert.deepEqual(specs.map((s) => s.name), ["Team A", "Package 2", "Package 3"]);
  assert.equal(specs[0]!.state.policy.singlePayer, true);
  assert.deepEqual(specs[0]!.state.challenge, challenge);
  assert.equal(specs[1]!.state.seed, 9);
  assert.deepEqual(errors, ["Line 5 is not a simulator share link."]);

  // A comparison link reproduces the list.
  const again = parsePackages(decodeCompare(encodeCompare(specs))!);
  assert.deepEqual(again.specs, specs);
  assert.equal(decodeCompare(a), null, "a package link is not a comparison link");
  assert.equal(decodeCompare("cmp.garbage!"), null);
});

test("summaries across runs: means, ranges, gaps, and paired differences", () => {
  const base = [small(BASELINE_POLICY, 1), small(BASELINE_POLICY, 2), small(BASELINE_POLICY, 3)];
  const reform = [small(SINGLE_PAYER_ADEQUATE, 1), small(SINGLE_PAYER_ADEQUATE, 2), small(SINGLE_PAYER_ADEQUATE, 3)];
  const insured = (y: SimResult["years"][number]) => y.insuredRate;

  const s = statAt(base, 7, insured);
  assert.equal(s.n, 3);
  assert.ok(s.lo <= s.mean && s.mean <= s.hi && s.lo < s.hi);

  const b = band(reform, (y) => (y.policy.singlePayer ? null : y.premiums.silver));
  assert.ok(b.mean.slice(0, 3).every((v) => v !== null), "premiums exist before the reform");
  assert.ok(b.mean.slice(3).every((v) => v === null), "and not after single payer begins");
  assert.ok(b.lo[0]! <= b.mean[0]! && b.mean[0]! <= b.hi[0]!);

  const d = pairedDelta(reform, base, 7, insured);
  assert.ok(d.sameSign && d.lo > 0, "single payer raises coverage in every run");
  const before = pairedDelta(reform, base, 2, insured);
  assert.deepEqual([before.lo, before.hi], [0, 0], "before the reform each run equals its no-reform twin");
  assert.equal(before.sameSign, false);
});

test("without Web Workers the run pool falls back to the main thread, and cancelling still works", async () => {
  // Node has no browser Worker, which is exactly the situation the fallback is for.
  (globalThis as unknown as { window: unknown }).window = globalThis;
  const { RunPool } = await import("../src/web/runs.ts");
  const pool = new RunPool(2);
  const cfg = reformConfig(BASELINE_POLICY, { seed: 3, populationSize: 800, years: 3, reformYear: 1 });
  const kept = pool.run(cfg, "kept");
  const dropped = pool.run(cfg, "dropped");
  pool.cancel("dropped");
  assert.equal(await dropped, null, "a cancelled run resolves with nothing");
  assert.deepEqual((await kept)!.years, runSimulation(cfg).years, "the fallback produces the same result as a direct run");
});
