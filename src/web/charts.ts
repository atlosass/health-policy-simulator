/** Hand-rolled SVG charts — zero dependencies. Each returns an SVG markup string. */
import { clamp } from "./format.ts";

const W = 480;
const H = 272;
const M = { top: 44, right: 16, bottom: 28, left: 48 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface Series {
  label: string;
  color: string;
  values: number[]; // indexed by year
}

/** A line series that may have gaps: null marks a year in which the quantity does not exist. */
export interface GapSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

/** Where the reform begins on the year axis, and how many years it takes to phase in. */
export interface ReformMarker {
  start: number;
  phaseIn: number;
}

interface AxisChartOpts {
  title: string;
  series: GapSeries[];
  yMax?: number;
  yMin?: number;
  /** Format a y value for the axis labels. */
  yFmt: (v: number) => string;
  /** Optional horizontal reference line (e.g., a target). */
  reference?: { value: number; label: string };
  marker?: ReformMarker;
}

function yTicks(min: number, max: number, n = 4): number[] {
  const ticks: number[] = [];
  for (let i = 0; i <= n; i++) ticks.push(min + ((max - min) * i) / n);
  return ticks;
}

/**
 * Vertical "reform" line, drawn between the last pre-reform year and the first
 * reform year (where the lines actually jump), with a shaded band covering any
 * phase-in.
 */
function markerSvg(xOf: (i: number) => number, years: number, marker?: ReformMarker): string {
  if (!marker || marker.start <= 0 || marker.start >= years) return "";
  const x0 = xOf(marker.start - 0.5);
  const x1 = xOf(Math.min(years - 1, marker.start + marker.phaseIn - 0.5));
  const band =
    marker.phaseIn > 0
      ? `<rect x="${x0.toFixed(1)}" y="${M.top}" width="${(x1 - x0).toFixed(1)}" height="${plotH}" class="reformband"/>`
      : "";
  return (
    band +
    `<line x1="${x0.toFixed(1)}" y1="${M.top}" x2="${x0.toFixed(1)}" y2="${M.top + plotH}" class="reformline"/>` +
    `<text x="${(x0 + 3).toFixed(1)}" y="${M.top + 9}" class="reformlabel">${marker.phaseIn > 0 ? "phase-in" : "reform"}</text>`
  );
}

/** Multi-line time series over years (x = year index). Null values break the line. */
export function lineChart(opts: AxisChartOpts): string {
  const years = opts.series[0]?.values.length ?? 0;
  const allVals = opts.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const yMax = opts.yMax ?? Math.max(0.0001, ...allVals) * 1.1;
  const yMin = opts.yMin ?? Math.min(0, ...allVals);
  const xOf = (i: number) => M.left + (years <= 1 ? 0 : (plotW * i) / (years - 1));
  const yOf = (v: number) => M.top + plotH - (plotH * (v - yMin)) / (yMax - yMin || 1);

  const grid = yTicks(yMin, yMax)
    .map((t) => {
      const y = yOf(t);
      return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${M.left + plotW}" y2="${y.toFixed(1)}" class="grid"/>` +
        `<text x="${M.left - 6}" y="${(y + 3).toFixed(1)}" class="ytick">${esc(opts.yFmt(t))}</text>`;
    })
    .join("");

  const xlabels = [0, Math.floor((years - 1) / 2), years - 1]
    .filter((v, i, a) => a.indexOf(v) === i && v >= 0)
    .map((i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" class="xtick">Yr ${i}</text>`)
    .join("");

  const lines = opts.series
    .map((s) => {
      let d = "";
      let penDown = false;
      s.values.forEach((v, i) => {
        if (v === null) {
          penDown = false;
          return;
        }
        d += `${penDown ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
        penDown = true;
      });
      return d ? `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2"/>` : "";
    })
    .join("");

  const ref = opts.reference
    ? `<line x1="${M.left}" y1="${yOf(opts.reference.value).toFixed(1)}" x2="${M.left + plotW}" y2="${yOf(opts.reference.value).toFixed(1)}" class="refline"/>` +
      `<text x="${M.left + plotW}" y="${(yOf(opts.reference.value) - 3).toFixed(1)}" class="reflabel">${esc(opts.reference.label)}</text>`
    : "";

  const legend = opts.series
    .map(
      (s, i) =>
        `<g transform="translate(${M.left + i * 110}, 30)"><rect width="9" height="9" y="-8" fill="${s.color}"/><text x="13" class="legend">${esc(s.label)}</text></g>`,
    )
    .join("");

  return svg(opts.title, grid + ref + markerSvg(xOf, years, opts.marker) + lines + xlabels + legend);
}

/** Stacked area (e.g., coverage mix over time). Series stack bottom-to-top. */
export function stackedArea(title: string, series: Series[], total: number, marker?: ReformMarker): string {
  const years = series[0]?.values.length ?? 0;
  const xOf = (i: number) => M.left + (years <= 1 ? 0 : (plotW * i) / (years - 1));
  const yOf = (v: number) => M.top + plotH - (plotH * v) / (total || 1);
  const cum = new Array(years).fill(0);
  const areas = series
    .map((s) => {
      const top = s.values.map((v, i) => cum[i] + v);
      const path =
        s.values.map((_, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(top[i]).toFixed(1)}`).join(" ") +
        " " +
        s.values
          .map((_, i) => years - 1 - i)
          .map((i) => `L${xOf(i).toFixed(1)},${yOf(cum[i]).toFixed(1)}`)
          .join(" ") +
        " Z";
      for (let i = 0; i < years; i++) cum[i] = top[i];
      return `<path d="${path}" fill="${s.color}" fill-opacity="0.85" stroke="none"/>`;
    })
    .join("");

  const xlabels = [0, years - 1]
    .map((i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" class="xtick">Yr ${i}</text>`)
    .join("");
  const ax = yTicks(0, total)
    .map((t) => `<text x="${M.left - 6}" y="${(yOf(t) + 3).toFixed(1)}" class="ytick">${Math.round((t / total) * 100)}%</text>`)
    .join("");
  const legend = series
    .map(
      (s, i) =>
        `<g transform="translate(${M.left + i * 92}, 30)"><rect width="9" height="9" y="-8" fill="${s.color}"/><text x="13" class="legend">${esc(s.label)}</text></g>`,
    )
    .join("");
  return svg(title, areas + markerSvg(xOf, years, marker) + ax + xlabels + legend);
}

/** Categorical bar chart (e.g., a metric across income terciles). */
export function barChart(
  title: string,
  bars: { label: string; value: number; color: string }[],
  yFmt: (v: number) => string,
  yMax?: number,
): string {
  const top = yMax ?? Math.max(0.0001, ...bars.map((b) => b.value)) * 1.15;
  const yOf = (v: number) => M.top + plotH - (plotH * v) / top;
  const bw = (plotW / bars.length) * 0.6;
  const gap = (plotW / bars.length) * 0.4;
  const grid = yTicks(0, top)
    .map((t) => {
      const y = yOf(t);
      return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${M.left + plotW}" y2="${y.toFixed(1)}" class="grid"/>` +
        `<text x="${M.left - 6}" y="${(y + 3).toFixed(1)}" class="ytick">${esc(yFmt(t))}</text>`;
    })
    .join("");
  const rects = bars
    .map((b, i) => {
      const x = M.left + gap / 2 + i * (bw + gap);
      const y = yOf(b.value);
      const h = M.top + plotH - y;
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${b.color}"/>` +
        `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" class="barval">${esc(yFmt(b.value))}</text>` +
        `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" class="xtick">${esc(b.label)}</text>`
      );
    })
    .join("");
  return svg(title, grid + rects);
}

/** Stacked area with an absolute (dollar) y-axis and its own auto-scaled max. */
export function stackedAreaDollars(
  title: string,
  series: Series[],
  yFmt: (v: number) => string,
  marker?: ReformMarker,
): string {
  const years = series[0]?.values.length ?? 0;
  const totals = new Array(years).fill(0);
  for (const s of series) for (let i = 0; i < years; i++) totals[i] += s.values[i]!;
  const top = Math.max(0.0001, ...totals) * 1.1;
  const xOf = (i: number) => M.left + (years <= 1 ? 0 : (plotW * i) / (years - 1));
  const yOf = (v: number) => M.top + plotH - (plotH * v) / top;
  const cum = new Array(years).fill(0);
  const areas = series
    .map((s) => {
      const topLine = s.values.map((v, i) => cum[i] + v);
      const path =
        s.values.map((_, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(topLine[i]).toFixed(1)}`).join(" ") +
        " " +
        s.values.map((_, i) => years - 1 - i).map((i) => `L${xOf(i).toFixed(1)},${yOf(cum[i]).toFixed(1)}`).join(" ") +
        " Z";
      for (let i = 0; i < years; i++) cum[i] = topLine[i];
      return `<path d="${path}" fill="${s.color}" fill-opacity="0.85"/>`;
    })
    .join("");
  const ax = yTicks(0, top)
    .map((t) => `<text x="${M.left - 6}" y="${(yOf(t) + 3).toFixed(1)}" class="ytick">${esc(yFmt(t))}</text>`)
    .join("");
  const xlabels = [0, years - 1].map((i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" class="xtick">Yr ${i}</text>`).join("");
  const legend = series
    .map((s, i) => `<g transform="translate(${M.left + (i % 3) * 130}, ${30 + Math.floor(i / 3) * 13})"><rect width="9" height="9" y="-8" fill="${s.color}"/><text x="13" class="legend">${esc(s.label)}</text></g>`)
    .join("");
  return svg(title, areas + markerSvg(xOf, years, marker) + ax + xlabels + legend);
}

/**
 * Iron Triangle radar: three axes (Cost / Quality / Access), each 0–1 where 1
 * is good. Plots the current package and a baseline overlay.
 */
export function ironTriangle(
  current: { cost: number; quality: number; access: number },
  baseline: { cost: number; quality: number; access: number },
): string {
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 88;
  const axes = [
    { key: "quality", label: "Quality", angle: -Math.PI / 2 },
    { key: "access", label: "Access", angle: -Math.PI / 2 + (2 * Math.PI) / 3 },
    { key: "cost", label: "Affordability", angle: -Math.PI / 2 + (4 * Math.PI) / 3 },
  ] as const;
  const pt = (angle: number, r: number): [number, number] => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const p = axes.map((a) => pt(a.angle, R * f).map((n) => n.toFixed(1)).join(",")).join(" ");
      return `<polygon points="${p}" class="grid" fill="none"/>`;
    })
    .join("");
  const spokes = axes.map((a) => {
    const [x, y] = pt(a.angle, R);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="grid"/>`;
  }).join("");
  const labels = axes
    .map((a) => {
      const [x, y] = pt(a.angle, R + 18);
      return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" class="axislabel" text-anchor="middle">${a.label}</text>`;
    })
    .join("");

  const poly = (
    d: { cost: number; quality: number; access: number },
    stroke: string,
    fill: string,
    fillOpacity: number,
    strokeWidth: number,
    dash: string,
  ) => {
    const p = axes
      .map((a) => pt(a.angle, R * clamp(d[a.key], 0, 1)).map((n) => n.toFixed(1)).join(","))
      .join(" ");
    return `<polygon points="${p}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  };

  // High contrast: baseline is a bold dashed reference outline; the current
  // package is a solid, saturated filled shape.
  const legend =
    `<g transform="translate(8,${H - 14})"><line x1="0" y1="-4" x2="14" y2="-4" stroke="#334155" stroke-width="2.5" stroke-dasharray="4 3"/><text x="19" class="legend">Baseline</text>` +
    `<rect width="12" height="10" y="-9" x="96" fill="#e11d48" fill-opacity="0.9"/><text x="112" class="legend">This package</text></g>`;

  return svg(
    "Iron Triangle",
    rings +
      spokes +
      labels +
      poly(baseline, "#334155", "none", 0, 2.5, "4 3") +
      poly(current, "#e11d48", "#e11d48", 0.32, 2.5, "") +
      legend,
  );
}

function svg(title: string, inner: string): string {
  return (
    `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(title)}">` +
    `<text x="${M.left}" y="${14}" class="charttitle">${esc(title)}</text>${inner}</svg>`
  );
}
