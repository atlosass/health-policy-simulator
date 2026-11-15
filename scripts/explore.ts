/** Scratch harness: print key trajectories for the policy configurations. */
import {
  runSimulation,
  defaultConfig,
  BASELINE_POLICY,
  UNSUPPORTED_COMMUNITY_RATING,
  UNDERWRITTEN_NO_SUPPORTS,
  LAX_ANTITRUST,
  AGGRESSIVE_PRICE_CAPS,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
} from "../src/engine/index.ts";
import type { Policy } from "../src/engine/index.ts";

function show(name: string, policy: Policy) {
  const res = runSimulation(defaultConfig(policy, 42, 20));
  console.log(`\n=== ${name} ===`);
  console.log("yr | insured  unins | NHE/GDP | hospHHI hPrice hWait | physHHI pPrice pWait | margin h/p | unmet health | DWL$M");
  for (const y of res.years) {
    const h = y.providers.hospital;
    const p = y.providers.physician;
    console.log(
      [
        String(y.year).padStart(2),
        (y.insuredRate * 100).toFixed(1).padStart(7),
        String(y.coverage.uninsured).padStart(6),
        "|",
        (y.spending.nheShareOfGdp * 100).toFixed(1).padStart(6),
        "|",
        String(Math.round(h.hhi)).padStart(6),
        h.commercialPriceIndex.toFixed(2).padStart(5),
        h.waitWeeks.toFixed(1).padStart(5),
        "|",
        String(Math.round(p.hhi)).padStart(6),
        p.commercialPriceIndex.toFixed(2).padStart(5),
        p.waitWeeks.toFixed(1).padStart(5),
        "|",
        (h.margin * 100).toFixed(0).padStart(3) + "/" + (p.margin * 100).toFixed(0).padStart(3),
        "|",
        (y.health.unmetNeedRate * 100).toFixed(1).padStart(4),
        y.health.meanHealthStock.toFixed(3).padStart(6),
        "|",
        (y.government.deadweightLoss / 1e6).toFixed(0).padStart(5),
      ].join(" "),
    );
  }
  const last = res.years.at(-1)!;
  console.log(
    `final: insured ${(last.insuredRate * 100).toFixed(1)}%  NHE/GDP ${(last.spending.nheShareOfGdp * 100).toFixed(1)}%  ` +
      `hospHHI ${Math.round(last.providers.hospital.hhi)}  hWait ${last.providers.hospital.waitWeeks.toFixed(1)}w  ` +
      `pWait ${last.providers.physician.waitWeeks.toFixed(1)}w`,
  );
  const tags = ["merger-approved", "merger-blocked", "provider-exit", "provider-entry", "wait-times", "price-change"];
  for (const e of res.years.flatMap((y) => y.events).filter((e) => tags.includes(e.type)).slice(0, 8)) {
    console.log(`  [y${e.year}] ${e.narrative}`);
  }
}

show("BASELINE", BASELINE_POLICY);
show("LAX ANTITRUST (consolidation)", LAX_ANTITRUST);
show("AGGRESSIVE PRICE CAPS", AGGRESSIVE_PRICE_CAPS);
show("SINGLE PAYER, ADEQUATE RATES", SINGLE_PAYER_ADEQUATE);
show("SINGLE PAYER, LOW RATES", SINGLE_PAYER_LOW_RATES);
show("DEATH SPIRAL", UNSUPPORTED_COMMUNITY_RATING);
show("UNDERWRITTEN", UNDERWRITTEN_NO_SUPPORTS);
