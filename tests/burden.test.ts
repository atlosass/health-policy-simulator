/**
 * Who pays (DESIGN.md §3.5): every dollar of health spending is assigned to a
 * household through one of four channels — out of pocket, premiums, wages held
 * back for the employer's share of premiums, and taxes — and reported by
 * income third.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY, SINGLE_PAYER_ADEQUATE, EMPLOYER_MANDATE, TAX_EXCLUSION_REPEALED } from "../src/engine/index.ts";
import type { HealthBurden, YearResult } from "../src/engine/index.ts";
import { taxLiability } from "../src/engine/population.ts";
import { eachSeed, reform, POPULATION } from "./helpers.ts";

const paid = (b: HealthBurden): number => b.outOfPocket + b.premiums + b.wages + b.taxes;
const share = (b: HealthBurden): number => paid(b) / b.income;
const last = (policy: typeof BASELINE_POLICY, seed: number): YearResult => reform(policy, seed).years.at(-1)!;

test("the stylized tax bill rises faster than income", () => {
  assert.equal(taxLiability(0), 0);
  const rate = (income: number) => taxLiability(income) / income;
  assert.ok(rate(20_000) < rate(60_000) && rate(60_000) < rate(200_000));
  for (let income = 5_000; income < 300_000; income += 5_000) {
    assert.ok(taxLiability(income + 5_000) > taxLiability(income), "more income, more tax");
  }
});

test("the taxes assigned to households add up to exactly what the government must raise", () => {
  eachSeed((seed) => {
    for (const policy of [BASELINE_POLICY, SINGLE_PAYER_ADEQUATE]) {
      const y = last(policy, seed);
      assert.ok(Math.abs(y.burden.all.taxes * POPULATION - y.government.revenueRequired) < 1e-6 * y.government.revenueRequired);
      assert.ok(Math.abs(y.burden.all.drag * POPULATION - y.government.deadweightLoss) < 1e-6 * y.government.deadweightLoss);
    }
  });
});

test("what households pay adds up to national health spending", () => {
  eachSeed((seed) => {
    // Under single payer every dollar is a tax or an out-of-pocket payment, so the match is exact.
    const sp = last(SINGLE_PAYER_ADEQUATE, seed);
    assert.ok(Math.abs((paid(sp.burden.all) * POPULATION) / sp.spending.nhe - 1) < 1e-9);
    // With employer coverage the match is close but not exact: firms recover
    // premiums from wages using last year's take-up, and cannot recover them
    // at all from workers already at the wage floor. Care nobody paid for is excluded.
    const base = last(BASELINE_POLICY, seed);
    const ratio = (paid(base.burden.all) * POPULATION) / (base.spending.nhe - base.spending.uncompensatedCare);
    assert.ok(ratio > 0.9 && ratio < 1.03, `households pay ${(ratio * 100).toFixed(1)}% of paid-for spending`);
  });
});

test("the whole-population figures are the average of the three income thirds", () => {
  eachSeed((seed) => {
    const b = last(BASELINE_POLICY, seed).burden;
    for (const key of ["income", "outOfPocket", "premiums", "wages", "taxes", "drag"] as const) {
      const mean = (b.low[key] + b.mid[key] + b.high[key]) / 3;
      assert.ok(Math.abs(mean / b.all[key] - 1) < 0.01, key);
    }
    assert.ok(b.low.income < b.mid.income && b.mid.income < b.high.income);
  });
});

test("under current law health costs take a larger share of a low income than of a high one", () => {
  eachSeed((seed) => {
    const b = last(BASELINE_POLICY, seed).burden;
    assert.ok(share(b.low) > share(b.mid) && share(b.mid) > share(b.high), `${[b.low, b.mid, b.high].map((g) => (share(g) * 100).toFixed(1)).join(" / ")}%`);
    // Premiums and held-back wages are what make it so; taxes run the other way.
    assert.ok(b.low.wages / b.low.income > 2 * (b.high.wages / b.high.income));
    assert.ok(b.low.taxes / b.low.income < b.high.taxes / b.high.income);
  });
});

test("single payer moves the cost from premiums and wages to taxes, and from low incomes to high ones", () => {
  eachSeed((seed) => {
    const before = last(BASELINE_POLICY, seed).burden;
    const after = last(SINGLE_PAYER_ADEQUATE, seed).burden;
    for (const g of [after.low, after.mid, after.high]) {
      assert.equal(g.premiums, 0);
      assert.equal(g.wages, 0);
    }
    assert.ok(share(after.low) < share(before.low) - 0.05, "the low-income third pays much less");
    assert.ok(share(after.high) > share(before.high) + 0.03, "the high-income third pays more");
    assert.ok(share(after.high) > share(after.low), "the burden now rises with income");
    assert.ok(after.all.taxes > 2 * before.all.taxes);
  });
});

test("an employer mandate is paid for out of low-wage workers' pay", () => {
  eachSeed((seed) => {
    const before = last(BASELINE_POLICY, seed).burden;
    const after = last(EMPLOYER_MANDATE, seed).burden;
    assert.ok(after.low.wages > 1.1 * before.low.wages, `low-income wages given up: $${Math.round(before.low.wages)} → $${Math.round(after.low.wages)}`);
  });
});

test("repealing the tax exclusion lowers everyone's taxes and raises what covered workers pay through wages", () => {
  eachSeed((seed) => {
    const before = last(BASELINE_POLICY, seed).burden;
    const after = last(TAX_EXCLUSION_REPEALED, seed).burden;
    assert.ok(after.all.taxes < 0.8 * before.all.taxes);
    assert.ok(after.high.wages > before.high.wages, "the tax break was worth most to high earners");
  });
});
