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
  defaultConfig,
  BASELINE_POLICY,
  EMPLOYER_MANDATE,
  TAX_EXCLUSION_CAPPED,
  TAX_EXCLUSION_REPEALED,
} from "../src/engine/index.ts";

const baseline = runSimulation(defaultConfig(BASELINE_POLICY, 42, 20));
const b10 = baseline.years[10]!;

test("baseline ESI is the dominant source of coverage at a realistic offer rate", () => {
  const esiShare = b10.coverage.esi / 10_000;
  assert.ok(esiShare > 0.45 && esiShare < 0.7, `ESI share ${(esiShare * 100).toFixed(1)}%`);
  assert.ok(b10.employer.offerRate > 0.6 && b10.employer.offerRate < 0.95, `offer rate ${(b10.employer.offerRate * 100).toFixed(0)}%`);
});

test("ESI premiums are borne through wages — coverage is not free", () => {
  assert.ok(b10.employer.wageIncidencePerEnrollee > 1_000, `wage incidence $${Math.round(b10.employer.wageIncidencePerEnrollee)}/enrollee`);
  assert.ok(b10.government.esiTaxExpenditure > 0, "the tax exclusion is a real, positive government expenditure");
});

test("repeal erodes ESI modestly and at the extensive margin (small firms), not a collapse", () => {
  const repealed = runSimulation(defaultConfig(TAX_EXCLUSION_REPEALED, 42, 20));
  const r10 = repealed.years[10]!;
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
  assert.ok(
    r10.employer.offerRate < b10.employer.offerRate - 0.08,
    "the offer (extensive) margin should fall — concentrated in small firms",
  );
  assert.ok(r10.coverage.individual > b10.coverage.individual, "displaced workers shift to the individual market");
  assert.equal(r10.government.esiTaxExpenditure, 0, "no exclusion → no tax expenditure");
});

test("capping the exclusion trims generosity and the tax expenditure more than coverage", () => {
  const capped = runSimulation(defaultConfig(TAX_EXCLUSION_CAPPED, 42, 20));
  const c10 = capped.years[10]!;
  assert.ok(
    c10.government.esiTaxExpenditure < 0.8 * b10.government.esiTaxExpenditure,
    "capping the exclusion should noticeably cut the tax expenditure",
  );
  assert.ok(
    c10.employer.avgActuarialValue <= b10.employer.avgActuarialValue,
    "capping the exclusion should not raise plan generosity",
  );
});

test("an employer mandate pushes offer rates to universal", () => {
  const mandate = runSimulation(defaultConfig(EMPLOYER_MANDATE, 42, 20));
  const m10 = mandate.years[10]!;
  assert.ok(m10.employer.offerRate > 0.98, `mandate offer rate ${(m10.employer.offerRate * 100).toFixed(0)}%, expected ~100%`);
  assert.ok(m10.employer.offerRate > b10.employer.offerRate, "mandate should raise offers above baseline");
});

test("higher-wage workers get more generous offers than the population floor", () => {
  // Average actuarial value sits above the minimum (bronze) tier — generosity
  // is chosen, not floored.
  assert.ok(b10.employer.avgActuarialValue > 0.6, `avg AV ${(b10.employer.avgActuarialValue * 100).toFixed(0)}%`);
});
