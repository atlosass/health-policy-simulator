/** Phase 3 scratch harness: employer-market trajectories. */
import {
  runSimulation,
  defaultConfig,
  BASELINE_POLICY,
  EMPLOYER_MANDATE,
  TAX_EXCLUSION_CAPPED,
  TAX_EXCLUSION_REPEALED,
} from "../src/engine/index.ts";
import type { Policy } from "../src/engine/index.ts";

function show(name: string, policy: Policy) {
  const res = runSimulation(defaultConfig(policy, 42, 15));
  console.log(`\n=== ${name} ===`);
  console.log("yr | esi  indiv pub  unins | offer% avgAV avgPrem wageInc | taxExp$M NHE/GDP DWL$M");
  for (const y of res.years) {
    const c = y.coverage;
    const e = y.employer;
    console.log(
      [
        String(y.year).padStart(2),
        String(c.esi).padStart(5),
        String(c.individual).padStart(5),
        String(c.public).padStart(4),
        String(c.uninsured).padStart(5),
        "|",
        (e.offerRate * 100).toFixed(0).padStart(5),
        (e.avgActuarialValue * 100).toFixed(0).padStart(5),
        String(Math.round(e.avgPremium)).padStart(7),
        String(Math.round(e.wageIncidencePerEnrollee)).padStart(7),
        "|",
        (y.government.esiTaxExpenditure / 1e6).toFixed(0).padStart(7),
        (y.spending.nheShareOfGdp * 100).toFixed(1).padStart(6),
        (y.government.deadweightLoss / 1e6).toFixed(0).padStart(5),
      ].join(" "),
    );
  }
  const last = res.years.at(-1)!;
  console.log(
    `final: ESI ${(last.coverage.esi / 100).toFixed(0)}%  offer ${(last.employer.offerRate * 100).toFixed(0)}%  ` +
      `avgAV ${(last.employer.avgActuarialValue * 100).toFixed(0)}%  insured ${(last.insuredRate * 100).toFixed(1)}%  ` +
      `ESI tax exp $${(last.government.esiTaxExpenditure / 1e6).toFixed(0)}M`,
  );
}

show("BASELINE", BASELINE_POLICY);
show("EMPLOYER MANDATE", EMPLOYER_MANDATE);
show("TAX EXCLUSION CAPPED ($4k)", TAX_EXCLUSION_CAPPED);
show("TAX EXCLUSION REPEALED", TAX_EXCLUSION_REPEALED);
