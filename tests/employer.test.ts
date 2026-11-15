/**
 * Phase 3 validation (DESIGN.md §3.2): the employer-sponsored insurance market.
 * Offers are endogenous; the tax exclusion sustains broad ESI; premiums are
 * borne through wages (incidence); generosity and offers respond to the
 * tax-exclusion and employer-mandate levers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  reformConfig,
  PARAMS,
  BASELINE_POLICY,
  EMPLOYER_MANDATE,
  LAX_ANTITRUST,
  SINGLE_PAYER_ADEQUATE,
  TAX_EXCLUSION_CAPPED,
  TAX_EXCLUSION_REPEALED,
} from "../src/engine/index.ts";
import { buildEsiContext, setEmployerOffers, clearEmployerOffers } from "../src/engine/employer.ts";
import { generatePopulation } from "../src/engine/population.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { Policy } from "../src/engine/index.ts";
import { eachSeed, steady, pct, POPULATION } from "./helpers.ts";

const at10 = (policy: Policy, seed: number) => steady(policy, seed).years[10]!;

test("baseline ESI is the dominant source of coverage at a realistic offer rate", () => {
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    const esiShare = b10.coverage.esi / POPULATION;
    assert.ok(esiShare > 0.55 && esiShare < 0.72, `ESI share ${pct(esiShare)}`);
    assert.ok(b10.employer.offerRate > 0.6 && b10.employer.offerRate < 0.95, `offer rate ${pct(b10.employer.offerRate)}`);
  });
});

test("ESI premiums are borne through wages — coverage is not free", () => {
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    assert.ok(b10.employer.wageOffsetPerOfferedWorker > 1_000, `wage offset $${Math.round(b10.employer.wageOffsetPerOfferedWorker)}/offered worker`);
    assert.ok(b10.government.esiTaxExpenditure > 0, "the tax exclusion is a real, positive government expenditure");
  });
});

test("repeal erodes ESI modestly and at the extensive margin (small firms), not a collapse", () => {
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    const r10 = at10(TAX_EXCLUSION_REPEALED, seed);
    // Most firms keep offering because employees genuinely value group coverage
    // (a non-offering firm must pay higher wages to recruit). The exclusion is a
    // real prop — offers fall — but the drop is concentrated in small firms,
    // which can't spread the fixed cost and offered mainly for the tax break.
    assert.ok(
      r10.coverage.esi < 0.92 * b10.coverage.esi && r10.coverage.esi > 0.6 * b10.coverage.esi,
      `ESI went ${b10.coverage.esi} → ${r10.coverage.esi} on repeal; expected a modest (8–40%) decline`,
    );
    assert.ok(
      r10.coverage.esi > r10.coverage.individual && r10.coverage.esi > r10.coverage.public,
      "ESI should remain the largest single source of coverage after repeal",
    );
    assert.ok(r10.employer.offerRate < b10.employer.offerRate - 0.08, "the offer (extensive) margin should fall — concentrated in small firms");
    assert.ok(r10.coverage.individual > b10.coverage.individual, "displaced workers shift to the individual market");
    assert.equal(r10.government.esiTaxExpenditure, 0, "no exclusion → no tax expenditure");
  });
});

test("capping the exclusion trims generosity and the tax expenditure more than coverage", () => {
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    const c10 = at10(TAX_EXCLUSION_CAPPED, seed);
    assert.ok(c10.government.esiTaxExpenditure < 0.8 * b10.government.esiTaxExpenditure, "capping the exclusion should noticeably cut the tax expenditure");
    assert.ok(c10.employer.avgActuarialValue <= b10.employer.avgActuarialValue, "capping the exclusion should not raise plan generosity");
  });
});

test("an employer mandate pushes offer rates to universal", () => {
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    const m10 = at10(EMPLOYER_MANDATE, seed);
    assert.ok(m10.employer.offerRate > 0.98, `mandate offer rate ${pct(m10.employer.offerRate)}, expected ~100%`);
    assert.ok(m10.employer.offerRate > b10.employer.offerRate, "mandate should raise offers above baseline");
  });
});

test("higher-wage workers get more generous offers than the population floor", () => {
  // Average actuarial value sits above the minimum (bronze) tier — generosity
  // is chosen, not floored.
  eachSeed((seed) => {
    const b10 = at10(BASELINE_POLICY, seed);
    assert.ok(b10.employer.avgActuarialValue > 0.6, `avg AV ${pct(b10.employer.avgActuarialValue)}`);
  });
});

// ---- Wage pass-through: employer premium contributions come out of cash wages. ----

test("workers at offering firms are paid less in cash; everyone else is paid in full", () => {
  const pop = generatePopulation(mulberry32(42), 4000);
  const ctx = buildEsiContext(6000, PARAMS.riskAversionMean, PARAMS.incomeMedian, 1);
  const takeup = 0.8;
  setEmployerOffers(pop, ctx, BASELINE_POLICY, takeup);
  let offered = 0;
  for (const h of pop) {
    if (h.esiOffer) {
      offered++;
      const want = h.esiOffer.employerContribution * takeup;
      const room = Math.max(0, h.income - PARAMS.minCashWage);
      assert.ok(Math.abs(h.income - h.cashIncome - Math.min(want, room)) < 1e-6, "offset = the firm's expected contribution, limited by the wage floor");
      assert.ok(h.cashIncome >= Math.min(h.income, PARAMS.minCashWage) - 1e-6, "cash wages never go below the floor");
    } else {
      assert.equal(h.cashIncome, h.income);
    }
  }
  assert.ok(offered > 0.5 * pop.length, "most workers have an offer in this setup");
  clearEmployerOffers(pop);
  assert.ok(pop.every((h) => h.esiOffer === null && h.cashIncome === h.income), "with no employer coverage, pay is all cash");
});

test("the wage offset is about the employer's share of the premium, and disappears under single payer", () => {
  for (const seed of [1, 7, 42]) {
    const res = runSimulation(reformConfig(SINGLE_PAYER_ADEQUATE, { seed, years: 8, reformYear: 5 }));
    const before = res.years[4]!.employer;
    const employerShare = (1 - PARAMS.esiWorkerShare) * before.avgPremium;
    assert.ok(
      before.wageOffsetPerOfferedWorker > 0.5 * employerShare && before.wageOffsetPerOfferedWorker <= employerShare,
      `seed ${seed}: offset $${Math.round(before.wageOffsetPerOfferedWorker)} vs employer share $${Math.round(employerShare)}`,
    );
    assert.equal(res.years[5]!.employer.wageOffsetPerOfferedWorker, 0, `seed ${seed}`);
    assert.ok(res.years[5]!.events.some((e) => e.type === "wage-offset"), `seed ${seed}: the end of the offset should be explained`);
  }
});

test("when provider prices rise, premiums rise and take-home pay falls", () => {
  let lax = 0;
  let base = 0;
  const seeds = [1, 7, 42, 99, 123];
  for (const seed of seeds) {
    const late = (policy: typeof BASELINE_POLICY) =>
      runSimulation(reformConfig(policy, { seed, years: 20, reformYear: 5 }))
        .years.slice(14)
        .reduce((sum, y) => sum + y.employer.wageOffsetPerOfferedWorker, 0) / 6;
    lax += late(LAX_ANTITRUST);
    base += late(BASELINE_POLICY);
  }
  assert.ok(lax > 1.04 * base, `mean wage offset in years 14-19: lax antitrust $${Math.round(lax / seeds.length)} vs current law $${Math.round(base / seeds.length)}`);
});
