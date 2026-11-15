/** Explore government direct-provision scenarios (VA/NHS-style). Reform in year 5; reads year 10. */
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

function show(name: string, policy: Policy) {
  const r = runSimulation(reformConfig(policy, { years: 15 }));
  const y = r.years[10]!;
  const pp = y.publicProvision;
  console.log(`\n=== ${name} ===`);
  console.log(
    `insured ${(y.insuredRate * 100).toFixed(1)}%  uninsured ${y.coverage.uninsured}  ` +
      `NHE/GDP ${(y.spending.nheShareOfGdp * 100).toFixed(1)}%  care gap ${(y.health.careGap * 100).toFixed(1)}%  ` +
      `health ${y.health.meanHealthStock.toFixed(3)}`,
  );
  console.log(
    `  govt: subsidies $${(y.government.subsidyOutlays / 1e6).toFixed(0)}M  publicIns $${(y.government.publicOutlays / 1e6).toFixed(0)}M  ` +
      `publicProvision $${(y.government.publicProvisionOutlays / 1e6).toFixed(0)}M  DWL $${(y.government.deadweightLoss / 1e6).toFixed(0)}M`,
  );
  if (pp) {
    console.log(
      `  public delivery: ${(pp.careShare * 100).toFixed(0)}% of care, util ${(pp.utilization * 100).toFixed(0)}%, ` +
        `wait ${pp.waitWeeks.toFixed(1)}w, delivered ${(pp.deliveredFraction * 100).toFixed(0)}%`,
    );
  } else {
    console.log("  public delivery: none");
  }
  console.log(
    `  private waits: hosp ${y.providers.hospital.waitWeeks.toFixed(1)}w, phys ${y.providers.physician.waitWeeks.toFixed(1)}w`,
  );
}

show("BASELINE (no public provision)", BASELINE_POLICY);
show("SAFETY-NET CLINICS (uninsured + Medicaid)", SAFETY_NET_CLINICS);
show("SINGLE PAYER, private delivery (Canada)", SINGLE_PAYER_ADEQUATE);
show("NHS, well funded", NHS_WELL_FUNDED);
show("NHS, underfunded", NHS_UNDERFUNDED);
