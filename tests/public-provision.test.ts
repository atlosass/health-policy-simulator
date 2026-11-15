/**
 * Government direct provision (VA/NHS-style public delivery). Validates the
 * public sector's third instrument: operating its own delivery capacity.
 * Highly stylized / out-of-sample for the US, but the mechanics must hold.
 *
 * These run in reform mode (five years of current law, then the reform), so
 * "capacity as a multiple of baseline demand" means today's demand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  reformConfig,
  BASELINE_POLICY,
  SAFETY_NET_CLINICS,
  SINGLE_PAYER_ADEQUATE,
  NHS_WELL_FUNDED,
  NHS_UNDERFUNDED,
} from "../src/engine/index.ts";
import type { Policy } from "../src/engine/index.ts";

const REFORM_YEAR = 5;
const run = (policy: Policy) => runSimulation(reformConfig(policy, { years: 16, reformYear: REFORM_YEAR }));
const at = (policy: Policy, year = 15) => run(policy).years[year]!;

const b = at(BASELINE_POLICY);

test("baseline has no public delivery system", () => {
  assert.equal(b.publicProvision, null);
  assert.equal(b.government.publicProvisionOutlays, 0);
});

test("safety-net clinics give the uninsured access without changing their insurance status", () => {
  const s = at(SAFETY_NET_CLINICS);
  // Insurance status (and thus the uninsured count) is unchanged...
  assert.ok(Math.abs(s.coverage.uninsured - b.coverage.uninsured) < 0.02 * 10_000);
  // ...but access improves: the care gap falls and health rises.
  assert.ok(
    s.health.careGap < 0.75 * b.health.careGap,
    `care gap should drop with a public safety net (${(s.health.careGap * 100).toFixed(1)}% vs ${(b.health.careGap * 100).toFixed(1)}%)`,
  );
  assert.ok(s.health.meanHealthStock > b.health.meanHealthStock, "population health should improve");
  assert.ok(s.publicProvision!.careShare > 0.05, "the public system should deliver a meaningful share of care");
  assert.ok(s.government.publicProvisionOutlays > 0, "running public clinics costs the budget");
});

test("safety-net provision relieves the private system (less uncompensated care)", () => {
  const s = at(SAFETY_NET_CLINICS);
  assert.ok(
    s.spending.uncompensatedCare < b.spending.uncompensatedCare,
    "the uninsured using public clinics reduces private uncompensated care",
  );
});

test("NHS (public insurance + public delivery) vs. Canada (public insurance, private delivery)", () => {
  const nhs = at(NHS_WELL_FUNDED);
  const canada = at(SINGLE_PAYER_ADEQUATE);
  // Both achieve universal coverage.
  assert.equal(nhs.coverage.uninsured, 0);
  assert.equal(canada.coverage.uninsured, 0);
  // NHS delivers care publicly; Canada buys it from private providers.
  assert.ok(nhs.publicProvision!.careShare > 0.9, "NHS delivers nearly all care publicly");
  assert.equal(canada.publicProvision, null, "Canada keeps private delivery");
  assert.ok(canada.government.publicOutlays > 0 && canada.government.publicProvisionOutlays === 0);
  // A well-funded NHS keeps waits modest.
  assert.ok(nhs.publicProvision!.utilization < 1, "a well-funded NHS runs below capacity");
  assert.ok(nhs.publicProvision!.waitWeeks < 8, `well-funded NHS waits ${nhs.publicProvision!.waitWeeks.toFixed(1)}w should be modest`);
});

test("an underfunded NHS achieves universal coverage but rations by queue", () => {
  const under = at(NHS_UNDERFUNDED);
  const well = at(NHS_WELL_FUNDED);
  assert.equal(under.coverage.uninsured, 0, "still universal on paper");
  assert.ok(under.publicProvision!.utilization > 1, "demand exceeds public capacity");
  assert.ok(under.publicProvision!.deliveredFraction < 0.9, "care is rationed");
  assert.ok(
    under.publicProvision!.waitWeeks > 3 * well.publicProvision!.waitWeeks,
    "underfunding produces far longer queues than a well-funded system",
  );
  assert.ok(under.health.careGap > well.health.careGap + 0.15, "the care gap is far larger when underfunded");
});

test("matching today's capacity is not enough once care is free at the point of use", () => {
  // Capacity equal to today's total demand (level 1.0) is over-subscribed in
  // the reform year, because free care raises demand.
  const y = run({ ...NHS_WELL_FUNDED, publicProvisionLevel: 1.0 }).years[REFORM_YEAR]!;
  assert.ok(y.publicProvision!.utilization > 1.05, `utilization ${y.publicProvision!.utilization.toFixed(2)}`);
});

test("once all care is public, the private sectors are dormant rather than reporting nonsense", () => {
  const res = run(NHS_WELL_FUNDED);
  for (const y of res.years.slice(REFORM_YEAR)) {
    for (const s of [y.providers.hospital, y.providers.physician]) {
      assert.equal(s.active, false);
      assert.equal(s.waitWeeks, 0);
      assert.equal(s.utilization, 0);
    }
    const privateDynamics = y.events.filter((e) => e.module === "provider");
    assert.equal(privateDynamics.length, 0, `no mergers, entry or exit among providers with no patients (year ${y.year})`);
  }
});

test("direct provision is funded from the budget and carries deadweight loss", () => {
  const nhs = at(NHS_WELL_FUNDED);
  assert.ok(nhs.government.publicProvisionOutlays > 0);
  assert.ok(
    nhs.government.deadweightLoss > b.government.deadweightLoss,
    "financing a national delivery system carries a large deadweight cost",
  );
});
