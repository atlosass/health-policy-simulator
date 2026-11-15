/** Small formatting helpers for the dashboard. */

export const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;
export const pct0 = (x: number): string => `${Math.round(x * 100)}%`;

/** Compact dollar formatting: $1,234 / $12k / $3.4M / $1.2B. */
export function dollars(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  if (a >= 1e4) return `$${Math.round(x / 1e3)}k`;
  return `$${Math.round(x).toLocaleString()}`;
}

export const weeks = (w: number): string => `${w.toFixed(1)} wk`;

export const COVERAGE_COLORS = {
  esi: "#2563eb", // blue
  individual: "#16a34a", // green
  public: "#9333ea", // purple
  uninsured: "#dc2626", // red
} as const;

export const COVERAGE_LABELS = {
  esi: "Employer",
  individual: "Individual",
  public: "Public ins.",
  uninsured: "Uninsured",
} as const;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
