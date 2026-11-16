import { FINANCING } from "./financing.ts";
import type { Policy, SimConfig } from "./types.ts";

/** A subsidy cutoff at or above this multiple of the poverty line behaves as "no cliff". */
const NO_CLIFF = 8;

/**
 * The policy in force in a given year.
 *
 * Without a `priorPolicy` the reform package applies from year 0 (the
 * steady-state mode the market-equilibrium tests use). With one, the run
 * starts under `priorPolicy` and the reform begins in `reformYear`:
 *
 *  - no phase-in: the whole package takes effect in the reform year;
 *  - phase-in of N years: numeric dials (penalties, rates, eligibility lines)
 *    move linearly from their prior to their reform values over those N years,
 *    and on/off switches flip when the phase-in completes, N years after the
 *    reform year. Switching structure last avoids nonsense intermediate states
 *    such as a single payer still paying the old Medicaid rate.
 *
 * `progress` is 0 before the reform, strictly between 0 and 1 during a
 * phase-in, and 1 once the package is fully in force.
 */
export function policyForYear(config: SimConfig, year: number): { policy: Policy; progress: number } {
  const prior = config.priorPolicy;
  if (!prior) return { policy: config.policy, progress: 1 };
  const start = config.reformYear ?? 0;
  if (year < start) return { policy: prior, progress: 0 };
  const phaseIn = Math.max(0, Math.round(config.phaseInYears ?? 0));
  const progress = Math.min(1, (year - start + 1) / (phaseIn + 1));
  if (progress >= 1) return { policy: config.policy, progress: 1 };
  return { policy: blend(prior, config.policy, progress), progress };
}

function blend(prior: Policy, next: Policy, progress: number): Policy {
  const out: Record<string, unknown> = { ...prior };
  for (const key of Object.keys(next) as (keyof Policy)[]) {
    const a = prior[key];
    const b = next[key];
    if (typeof a !== "number" || typeof b !== "number") continue; // switches and on/off caps flip at completion
    if (key === "publicProvisionLevel" && (a === 0 || b === 0)) continue; // creating/abolishing a delivery system is a switch
    const from = key === "subsidyCutoffMultiple" ? Math.min(a, NO_CLIFF) : a;
    const to = key === "subsidyCutoffMultiple" ? Math.min(b, NO_CLIFF) : b;
    out[key] = from + (to - from) * progress;
  }
  return out as unknown as Policy;
}

const LABELS: Record<keyof Policy, string> = {
  communityRating: "community rating",
  riskAdjustment: "risk adjustment",
  mandatePenalty: "individual mandate penalty",
  subsidiesEnabled: "premium subsidies",
  subsidyCutoffMultiple: "subsidy income cutoff (× poverty line)",
  publicEligibilityMultiple: "public-insurance eligibility (× poverty line)",
  singlePayer: "single payer",
  priceCapIndex: "all-payer price cap",
  publicPriceRatio: "public payment rate",
  publicProvisionLevel: "government direct provision",
  antitrustStringency: "antitrust stringency",
  certificateOfNeed: "Certificate of Need",
  residencySlots: "residency slots",
  employerMandate: "employer mandate",
  taxExclusionCap: "ESI tax-exclusion cap",
  financing: "new health revenue raised by",
};

function show(key: keyof Policy, v: Policy[keyof Policy]): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return FINANCING[v].label.toLowerCase();
  if (v === null) return key === "taxExclusionCap" ? "uncapped" : "none";
  if (key === "subsidyCutoffMultiple" && v >= NO_CLIFF) return "no cliff";
  if (key === "mandatePenalty" || key === "taxExclusionCap") return `$${Math.round(v).toLocaleString("en-US")}`;
  return String(Math.round(v * 100) / 100);
}

/** Plain-language list of the levers a reform changes, e.g. "single payer: off → on". */
export function describeChanges(prior: Policy, next: Policy): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(LABELS) as (keyof Policy)[]) {
    if (prior[key] !== next[key]) changes.push(`${LABELS[key]}: ${show(key, prior[key])} → ${show(key, next[key])}`);
  }
  return changes;
}
