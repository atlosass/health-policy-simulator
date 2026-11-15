/**
 * Government direct provision (VA/NHS-style public delivery). Validates the
 * public-sector's third instrument: operating its own delivery capacity.
 * Highly stylized / out-of-sample for the US, but the mechanics must hold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSimulation,
  defaultConfig,
  BASELINE_POLICY,
  SAFETY_NET_CLINICS,
  SINGLE_PAYER_ADEQUATE,
  NHS_WELL_FUNDED,
  NHS_UNDERFUNDED,
} from "../src/engine/index.ts";

const baseline = runSimulation(defaultConfig(BASELINE_POLICY, 42, 15));
const b10 = baseline.years[10]!;

test("baseline has no public delivery system", () => {
  assert.equal(b10.publicProvision, null);
  assert.equal(b10.government.publicProvisionOutlays, 0);
});

test("safety-net clinics give the uninsured access without changing their insurance status", () => {
  const sn = runSimulation(defaultConfig(SAFETY_NET_CLINICS, 42, 15));
  const s10 = sn.years[10]!;
  // Insurance status (and thus the uninsured count) is unchanged...
  assert.ok(Math.abs(s10.coverage.uninsured - b10.coverage.uninsured) < 0.02 * 10_000);
  // ...but access improves sharply: unmet need falls and health rises.
  assert.ok(s10.health.unmetNeedRate < b10.health.unmetNeedRate - 0.03, "unmet need should drop with a public safety net");
  assert.ok(s10.health.meanHealthStock > b10.health.meanHealthStock, "population health should improve");
  assert.ok(s10.publicProvision!.careShare > 0.05, "the public system should deliver a meaningful share of care");
  assert.ok(s10.government.publicProvisionOutlays > 0, "running public clinics costs the budget");
});

test("safety-net provision relieves the private system (less uncompensated care / demand)", () => {
  const sn = runSimulation(defaultConfig(SAFETY_NET_CLINICS, 42, 15));
  const s10 = sn.years[10]!;
  assert.ok(
    s10.spending.uncompensatedCare < b10.spending.uncompensatedCare,
    "the uninsured using public clinics reduces private uncompensated care",
  );
});

test("NHS (public insurance + public delivery) vs. Canada (public insurance, private delivery)", () => {
  const nhs = runSimulation(defaultConfig(NHS_WELL_FUNDED, 42, 15)).years[10]!;
  const canada = runSimulation(defaultConfig(SINGLE_PAYER_ADEQUATE, 42, 15)).years[10]!;
  // Both achieve universal coverage.
  assert.equal(nhs.coverage.uninsured, 0);
  assert.equal(canada.coverage.uninsured, 0);
  // NHS delivers care publicly; Canada buys it from private providers.
  assert.ok(nhs.publicProvision!.careShare > 0.9, "NHS delivers nearly all care publicly");
  assert.equal(canada.publicProvision, null, "Canada keeps private delivery");
  assert.ok(canada.government.publicOutlays > 0 && canada.government.publicProvisionOutlays === 0);
  // Well-funded NHS keeps waits modest.
  assert.ok(nhs.publicProvision!.waitWeeks < 8, `well-funded NHS waits ${nhs.publicProvision!.waitWeeks.toFixed(1)}w should be modest`);
});

test("an underfunded NHS achieves universal coverage but rations by queue", () => {
  const under = runSimulation(defaultConfig(NHS_UNDERFUNDED, 42, 15)).years[10]!;
  const well = runSimulation(defaultConfig(NHS_WELL_FUNDED, 42, 15)).years[10]!;
  assert.equal(under.coverage.uninsured, 0, "still universal on paper");
  assert.ok(under.publicProvision!.utilization > 1, "demand exceeds public capacity");
  assert.ok(under.publicProvision!.deliveredFraction < 0.9, "care is rationed");
  assert.ok(
    under.publicProvision!.waitWeeks > 3 * well.publicProvision!.waitWeeks,
    "underfunding produces far longer queues than a well-funded system",
  );
  assert.ok(under.health.unmetNeedRate > well.health.unmetNeedRate + 0.2, "unmet need is far higher when underfunded");
});

test("direct provision is funded from the budget and carries deadweight loss", () => {
  const nhs = runSimulation(defaultConfig(NHS_WELL_FUNDED, 42, 15)).years[10]!;
  assert.ok(nhs.government.publicProvisionOutlays > 0);
  assert.ok(
    nhs.government.deadweightLoss > b10.government.deadweightLoss,
    "financing a national delivery system carries a large deadweight cost",
  );
});
