/** Policy-lever UI spec and URL (shareable-link) state encoding. */
import { BASELINE_POLICY } from "../engine/index.ts";
import type { Policy } from "../engine/index.ts";
import { dollars } from "./format.ts";

export type Lever =
  | { kind: "toggle"; key: keyof Policy; group: string; label: string; help: string }
  | {
      kind: "range";
      key: keyof Policy;
      group: string;
      label: string;
      help: string;
      min: number;
      max: number;
      step: number;
      fmt: (v: number) => string;
    }
  | {
      kind: "nullableRange";
      key: keyof Policy;
      group: string;
      label: string;
      help: string;
      min: number;
      max: number;
      step: number;
      offLabel: string;
      fmt: (v: number) => string;
    };

const fpl = (v: number) => (v >= 8 ? "no cliff" : `${v.toFixed(1)}× FPL`);
const ratio = (v: number) => `${Math.round(v * 100)}%`;
const mult = (v: number) => `${v.toFixed(2)}×`;

export const LEVERS: Lever[] = [
  // Coverage rules
  { kind: "toggle", key: "communityRating", group: "Insurance rules", label: "Community rating", help: "Ban medical underwriting on the individual market (everyone pays the same premium)." },
  { kind: "toggle", key: "riskAdjustment", group: "Insurance rules", label: "Risk adjustment", help: "Compensate insurers for sicker enrollees, so plan tiers are priced off the pooled market." },
  { kind: "range", key: "mandatePenalty", group: "Insurance rules", label: "Individual mandate penalty", help: "Annual penalty for going uninsured. Pressures healthy people to buy in.", min: 0, max: 4000, step: 100, fmt: dollars },

  // Subsidies
  { kind: "toggle", key: "subsidiesEnabled", group: "Subsidies", label: "Premium subsidies", help: "ARPA-style sliding-scale subsidies that cap the premium as a share of income." },
  { kind: "range", key: "subsidyCutoffMultiple", group: "Subsidies", label: "Subsidy income cutoff", help: "Income ceiling for subsidy eligibility. At the right edge there is no cliff.", min: 1.5, max: 8, step: 0.5, fmt: fpl },

  // Public programs
  { kind: "range", key: "publicEligibilityMultiple", group: "Public programs", label: "Public-insurance eligibility", help: "Medicaid-style income ceiling for free public coverage. 0 = no public program.", min: 0, max: 4, step: 0.1, fmt: (v) => (v === 0 ? "off" : fpl(v)) },
  { kind: "toggle", key: "singlePayer", group: "Public programs", label: "Single payer", help: "Enroll everyone in public insurance; switch off the ESI and individual markets." },
  { kind: "range", key: "publicPriceRatio", group: "Public programs", label: "Public payment rate", help: "What public insurance pays PRIVATE providers, as a share of commercial prices. Below ~85% squeezes providers.", min: 0.4, max: 1.2, step: 0.05, fmt: ratio },
  { kind: "range", key: "publicProvisionLevel", group: "Public programs", label: "Govt. direct provision (VA/NHS)", help: "Government-run delivery capacity as a multiple of today's total care demand. Serves the uninsured + public enrollees (everyone, under single payer). Care that is free at the point of use raises demand, so serving everyone comfortably takes about 1.35×. 0 = none.", min: 0, max: 1.6, step: 0.05, fmt: (v) => (v === 0 ? "off" : mult(v)) },

  // Employer market
  { kind: "toggle", key: "employerMandate", group: "Employer market", label: "Employer mandate", help: "Require all firms to offer ESI." },
  { kind: "nullableRange", key: "taxExclusionCap", group: "Employer market", label: "Cap ESI tax exclusion", help: "Limit the premium shielded from tax (a 'Cadillac tax'). Slide to $0 to fully repeal the exclusion. Toggle off = current law (uncapped).", min: 0, max: 14000, step: 500, offLabel: "uncapped", fmt: (v) => (v === 0 ? "$0 (repealed)" : dollars(v)) },

  // Provider market
  { kind: "nullableRange", key: "priceCapIndex", group: "Provider market", label: "All-payer price cap", help: "Hard cap on commercial provider prices (1.0 = baseline). Below provider cost (~0.85) drives exit. Off = no cap.", min: 0.5, max: 1.5, step: 0.05, offLabel: "no cap", fmt: ratio },
  { kind: "range", key: "antitrustStringency", group: "Provider market", label: "Antitrust stringency", help: "Probability a proposed provider merger is blocked. Higher = more competition preserved.", min: 0, max: 1, step: 0.1, fmt: ratio },
  { kind: "range", key: "certificateOfNeed", group: "Provider market", label: "Certificate of Need", help: "Friction on new hospital capacity. Higher = slower entry (protects incumbents).", min: 0, max: 1, step: 0.1, fmt: ratio },
  { kind: "range", key: "residencySlots", group: "Provider market", label: "Residency slots / scope", help: "Multiplier on physician supply growth. >1 trains/admits more clinicians.", min: 0.5, max: 2, step: 0.1, fmt: mult },
];

export const LEVER_GROUPS = [...new Set(LEVERS.map((l) => l.group))];

/** The simulated timeline: some years of current law, then the reform. */
export const TIMING = {
  years: 20,
  defaultReformYear: 4,
  minReformYear: 1,
  maxReformYear: 10,
  maxPhaseIn: 6,
} as const;

// ---- URL state: encode only what differs from the defaults, keeps links short. ----
export interface ShareState {
  seed: number;
  policy: Policy;
  reformYear: number;
  phaseInYears: number;
}

export function encodeState(state: ShareState): string {
  const diff: Record<string, unknown> = { seed: state.seed };
  for (const k of Object.keys(state.policy) as (keyof Policy)[]) {
    if (state.policy[k] !== BASELINE_POLICY[k]) diff[k] = state.policy[k];
  }
  if (state.reformYear !== TIMING.defaultReformYear) diff.reformYear = state.reformYear;
  if (state.phaseInYears !== 0) diff.phaseInYears = state.phaseInYears;
  return btoa(JSON.stringify(diff)).replace(/=+$/, "");
}

const NULLABLE: ReadonlySet<keyof Policy> = new Set(["priceCapIndex", "taxExclusionCap"]);

/** Decode a share link. Anything malformed or of the wrong type falls back to the default. */
export function decodeState(hash: string): ShareState | null {
  try {
    const obj = JSON.parse(atob(hash)) as Record<string, unknown>;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const int = (v: unknown, lo: number, hi: number, fallback: number) =>
      finite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;
    const policy = { ...BASELINE_POLICY } as unknown as Record<string, unknown>;
    for (const k of Object.keys(BASELINE_POLICY) as (keyof Policy)[]) {
      const v = obj[k];
      if (NULLABLE.has(k)) {
        if (v === null || finite(v)) policy[k] = v;
      } else if (typeof BASELINE_POLICY[k] === "boolean") {
        if (typeof v === "boolean") policy[k] = v;
      } else if (finite(v)) {
        policy[k] = v;
      }
    }
    return {
      seed: finite(obj.seed) ? obj.seed : 42,
      policy: policy as unknown as Policy,
      reformYear: int(obj.reformYear, TIMING.minReformYear, TIMING.maxReformYear, TIMING.defaultReformYear),
      phaseInYears: int(obj.phaseInYears, 0, TIMING.maxPhaseIn, 0),
    };
  } catch {
    return null;
  }
}
