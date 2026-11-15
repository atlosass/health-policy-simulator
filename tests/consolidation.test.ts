/**
 * Validation scenario 4 (DESIGN.md §8): provider consolidation raises
 * commercial prices, and antitrust enforcement is the counter-lever. Mergers
 * are endogenous — they emerge from the antitrust setting, not a hard-coded
 * price bump.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY, LAX_ANTITRUST } from "../src/engine/index.ts";
import type { Policy, SimResult } from "../src/engine/index.ts";
import { eachSeed, steady, SEEDS } from "./helpers.ts";

const STRICT: Policy = { ...BASELINE_POLICY, antitrustStringency: 1 };

// Peak concentration / price across both sectors (which sector consolidates in
// a given run is stochastic; the lesson is sector-agnostic).
const peakHHIRatio = (res: SimResult): number =>
  Math.max(...res.years.map((y) => Math.max(y.providers.hospital.hhi / 1667, y.providers.physician.hhi / 556)));
const peakPrice = (res: SimResult): number =>
  Math.max(...res.years.flatMap((y) => [y.providers.hospital.commercialPriceIndex, y.providers.physician.commercialPriceIndex]));
const meanOver = (read: (seed: number) => number): number => SEEDS.reduce((sum, seed) => sum + read(seed), 0) / SEEDS.length;

test("lax antitrust lets providers consolidate well above the competitive baseline", () => {
  eachSeed((seed) => {
    const lax = peakHHIRatio(steady(LAX_ANTITRUST, seed));
    assert.ok(lax > 1.3, `peak HHI ratio under lax antitrust was ${lax.toFixed(2)}x baseline, expected > 1.3x`);
    assert.ok(lax > peakHHIRatio(steady(STRICT, seed)), "lax antitrust should concentrate more than strict");
  });
});

test("consolidation raises commercial prices materially (merger literature range)", () => {
  eachSeed((seed) => {
    const rise = peakPrice(steady(LAX_ANTITRUST, seed)) - 1;
    assert.ok(rise > 0.1 && rise < 1.2, `peak commercial price rose ${(rise * 100).toFixed(0)}%, expected a large but bounded increase`);
  });
});

test("strict antitrust preserves competition and keeps prices near baseline", () => {
  eachSeed((seed) => {
    const strict = steady(STRICT, seed);
    assert.ok(peakHHIRatio(strict) < 1.001, "with every merger blocked, concentration never rises");
    assert.ok(peakPrice(strict) < 1.1, `strict-antitrust peak commercial price was ${peakPrice(strict).toFixed(2)}, expected near baseline`);
  });
});

test("consolidation feeds through to higher national health spending", () => {
  // A single year's spending is noisy, so compare the average of the last ten years across seeds.
  const late = (policy: Policy) =>
    meanOver((seed) => steady(policy, seed).years.slice(10).reduce((sum, y) => sum + y.spending.nheShareOfGdp, 0) / 10);
  assert.ok(late(LAX_ANTITRUST) > late(STRICT) + 0.005, `late spending: lax ${(late(LAX_ANTITRUST) * 100).toFixed(1)}% vs strict ${(late(STRICT) * 100).toFixed(1)}% of GDP`);
});

test("fat post-merger margins eventually draw entry (the counter-force)", () => {
  eachSeed((seed) => {
    const entry = steady(LAX_ANTITRUST, seed)
      .years.flatMap((y) => y.events)
      .find((e) => e.type === "provider-entry");
    assert.ok(entry, "expected a provider-entry event once margins became fat under consolidation");
  });
});
