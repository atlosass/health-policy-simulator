/**
 * Diagnostic: separate the extensive (offer) and intensive (generosity)
 * margins of the employer response to a tax-exclusion repeal, by firm size.
 */
import { mulberry32 } from "../src/engine/rng.ts";
import { generatePopulation, expectedCost } from "../src/engine/population.ts";
import { buildEsiContext, decideOffer, tierAv } from "../src/engine/employer.ts";
import { BASELINE_POLICY, TAX_EXCLUSION_REPEALED } from "../src/engine/index.ts";
import type { Policy, FirmSize } from "../src/engine/types.ts";

const rng = mulberry32(42);
const pop = generatePopulation(rng, 10_000);
let muTotal = 0, raTotal = 0, incTotal = 0;
for (const h of pop) { muTotal += expectedCost(h); raTotal += h.riskAversion; incTotal += h.income; }
const ctx = buildEsiContext(muTotal / pop.length, raTotal / pop.length, incTotal / pop.length, 1);

function report(name: string, policy: Policy) {
  const bySize: Record<FirmSize, { n: number; offers: number; avSum: number }> = {
    small: { n: 0, offers: 0, avSum: 0 },
    medium: { n: 0, offers: 0, avSum: 0 },
    large: { n: 0, offers: 0, avSum: 0 },
  };
  for (const h of pop) {
    const o = decideOffer(h.income, h.firmAdminLoad, h.firmSize, h.firmOfferShock, ctx, policy);
    const s = bySize[h.firmSize];
    s.n++;
    if (o) { s.offers++; s.avSum += tierAv(o.tier); }
  }
  console.log(`\n=== ${name} ===`);
  console.log("size   | workers | offer% | avg AV of offers");
  let offered = 0, avSum = 0;
  for (const size of ["small", "medium", "large"] as FirmSize[]) {
    const s = bySize[size];
    offered += s.offers; avSum += s.avSum;
    console.log(
      `${size.padEnd(6)} | ${((s.n / pop.length) * 100).toFixed(0).padStart(6)}% | ${((s.offers / s.n) * 100).toFixed(0).padStart(5)}% | ${s.offers ? ((s.avSum / s.offers) * 100).toFixed(0) : "—"}%`,
    );
  }
  console.log(`TOTAL  |         | ${((offered / pop.length) * 100).toFixed(0).padStart(5)}% | ${((avSum / offered) * 100).toFixed(0)}%  ← extensive (offer%) vs intensive (AV)`);
}

report("BASELINE", BASELINE_POLICY);
report("TAX EXCLUSION REPEALED", TAX_EXCLUSION_REPEALED);
