/**
 * Plan designs: a deductible, then coinsurance, up to an out-of-pocket maximum.
 * Each tier's label is the share of spending it pays across the whole adult
 * population, so the deductibles have to track the level of medical costs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAMS, TIERS, TIER_BY_ID, PUBLIC_PLAN } from "../src/engine/index.ts";
import { oopFor } from "../src/engine/plans.ts";
import { generatePopulation, expectedCost } from "../src/engine/population.ts";
import { realizedSpend } from "../src/engine/utilization.ts";
import { mulberry32 } from "../src/engine/rng.ts";

test("out-of-pocket cost: all of it below the deductible, a share above, nothing past the maximum", () => {
  const silver = TIER_BY_ID.silver;
  assert.ok(silver.deductible > 0);
  assert.equal(oopFor(silver, 0), 0);
  assert.equal(oopFor(silver, silver.deductible / 2), silver.deductible / 2);
  assert.equal(oopFor(silver, silver.deductible), silver.deductible);
  const above = silver.deductible + 1000;
  assert.ok(Math.abs(oopFor(silver, above) - (silver.deductible + silver.coinsurance * 1000)) < 1e-9);
  assert.equal(oopFor(silver, 1_000_000), silver.oopMax);
  let last = 0;
  for (let spend = 0; spend <= 60_000; spend += 500) {
    const oop = oopFor(silver, spend);
    assert.ok(oop >= last && oop <= spend, `non-decreasing and never more than the bill (at $${spend})`);
    last = oop;
  }
  assert.equal(PUBLIC_PLAN.deductible, 0, "public coverage has no deductible");
});

test("richer tiers have lower deductibles, lower coinsurance and lower maximums", () => {
  for (let i = 1; i < TIERS.length; i++) {
    const poorer = TIERS[i - 1]!;
    const richer = TIERS[i]!;
    assert.ok(richer.av > poorer.av && richer.deductible < poorer.deductible && richer.coinsurance < poorer.coinsurance && richer.oopMax < poorer.oopMax, richer.id);
  }
});

test("each tier pays the share of spending on its label, across the whole adult population", () => {
  for (const seed of [1, 7, 42]) {
    const costs = generatePopulation(mulberry32(seed), 20_000).map(expectedCost);
    for (const tier of TIERS) {
      let spend = 0;
      let oop = 0;
      for (const mu of costs) {
        for (let s = 0; s < PARAMS.shockProbs.length; s++) {
          const bill = realizedSpend(mu, PARAMS.shockMults[s]!, tier.coinsurance);
          spend += PARAMS.shockProbs[s]! * bill;
          oop += PARAMS.shockProbs[s]! * oopFor(tier, bill);
        }
      }
      const paid = 1 - oop / spend;
      assert.ok(Math.abs(paid - tier.av) < 0.015, `seed ${seed}: ${tier.label} pays ${(paid * 100).toFixed(1)}% of spending, labelled ${tier.av * 100}%`);
    }
  }
});

test("mean expected cost per adult is at the level the employer-premium anchor implies", () => {
  const costs = generatePopulation(mulberry32(3), 40_000).map(expectedCost);
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  assert.ok(mean > 8_800 && mean < 10_600, `mean expected cost $${Math.round(mean)}`);
});
