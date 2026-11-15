/** Small formatting helpers for the dashboard. */

export const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Compact dollar formatting: $1,234 / $12k / $3.4M / $1.2B / $1.25T. */
export function dollars(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(x / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  if (a >= 1e4) return `$${Math.round(x / 1e3)}k`;
  return `$${Math.round(x).toLocaleString()}`;
}

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

/** Escape text for use inside HTML (element content or a quoted attribute). */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Colors for packages shown side by side. */
export const PACKAGE_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#b45309", "#1e40af", "#0f766e", "#6d28d9"] as const;
