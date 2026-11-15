/**
 * Validation scenario 4 (DESIGN.md §8): provider consolidation raises
 * commercial prices, and antitrust enforcement is the counter-lever. Mergers
 * are endogenous — they emerge from the antitrust setting, not a hard-coded
 * price bump.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation, defaultConfig, BASELINE_POLICY, LAX_ANTITRUST } from "../src/engine/index.ts";

const STRICT = { ...BASELINE_POLICY, antitrustStringency: 1 };

const lax = runSimulation(defaultConfig(LAX_ANTITRUST, 42, 20));
const strict = runSimulation(defaultConfig(STRICT, 42, 20));

type Res = ReturnType<typeof runSimulation>;
// Peak concentration / price across both sectors (which sector consolidates in
// a given run is stochastic; the lesson is sector-agnostic).
const peakHHIRatio = (res: Res): number =>
  Math.max(
    ...res.years.map((y) => Math.max(y.providers.hospital.hhi / 1667, y.providers.physician.hhi / 556)),
  );
const peakPrice = (res: Res): number =>
  Math.max(
    ...res.years.flatMap((y) => [y.providers.hospital.commercialPriceIndex, y.providers.physician.commercialPriceIndex]),
  );

test("lax antitrust lets providers consolidate well above the competitive baseline", () => {
  assert.ok(peakHHIRatio(lax) > 1.3, `peak HHI ratio under lax antitrust was ${peakHHIRatio(lax).toFixed(2)}x baseline, expected > 1.3x`);
  assert.ok(peakHHIRatio(lax) > peakHHIRatio(strict), "lax antitrust should concentrate more than strict");
});

test("consolidation raises commercial prices materially (merger literature range)", () => {
  const rise = peakPrice(lax) - 1;
  assert.ok(rise > 0.1 && rise < 1.2, `peak commercial price rose ${(rise * 100).toFixed(0)}%, expected a large but bounded increase`);
});

test("strict antitrust preserves competition and keeps prices near baseline", () => {
  assert.ok(peakHHIRatio(strict) < peakHHIRatio(lax), "strict antitrust should keep concentration below the lax case");
  assert.ok(peakPrice(strict) < 1.1, `strict-antitrust peak commercial price was ${peakPrice(strict).toFixed(2)}, expected near baseline`);
});

test("consolidation feeds through to higher national health spending", () => {
  const laxPeakNHE = Math.max(...lax.years.map((y) => y.spending.nheShareOfGdp));
  const strictPeakNHE = Math.max(...strict.years.map((y) => y.spending.nheShareOfGdp));
  assert.ok(laxPeakNHE > strictPeakNHE, "lax antitrust should produce higher peak health spending");
});

test("fat post-merger margins eventually draw entry (the self-correcting counter-force)", () => {
  const entry = lax.years.flatMap((y) => y.events).find((e) => e.type === "provider-entry");
  assert.ok(entry, "expected a provider-entry event once margins became fat under consolidation");
});
