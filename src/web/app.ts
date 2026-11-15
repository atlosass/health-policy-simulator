import {
  runSimulation,
  BASELINE_POLICY,
  UNSUPPORTED_COMMUNITY_RATING,
  UNDERWRITTEN_NO_SUPPORTS,
  LAX_ANTITRUST,
  AGGRESSIVE_PRICE_CAPS,
  SINGLE_PAYER_ADEQUATE,
  SINGLE_PAYER_LOW_RATES,
  NHS_WELL_FUNDED,
  NHS_UNDERFUNDED,
  EMPLOYER_MANDATE,
  TAX_EXCLUSION_REPEALED,
  SAFETY_NET_CLINICS,
} from "../engine/index.ts";
import type { Policy, SimConfig, SimResult, YearResult } from "../engine/index.ts";
import { LEVERS, LEVER_GROUPS, encodeState, decodeState, type Lever } from "./levers.ts";
import { lineChart, stackedArea, stackedAreaDollars, barChart, ironTriangle, type Series } from "./charts.ts";
import { pct1, pct0, dollars, clamp, COVERAGE_COLORS, COVERAGE_LABELS } from "./format.ts";

const POP = 8000;
const YEARS = 16;

const PRESETS: { label: string; policy: Policy }[] = [
  { label: "Baseline (current-law-ish)", policy: BASELINE_POLICY },
  { label: "Death spiral", policy: UNSUPPORTED_COMMUNITY_RATING },
  { label: "Underwritten / laissez-faire", policy: UNDERWRITTEN_NO_SUPPORTS },
  { label: "Lax antitrust (consolidation)", policy: LAX_ANTITRUST },
  { label: "Aggressive price caps", policy: AGGRESSIVE_PRICE_CAPS },
  { label: "Safety-net clinics", policy: SAFETY_NET_CLINICS },
  { label: "Employer mandate", policy: EMPLOYER_MANDATE },
  { label: "Repeal ESI tax break", policy: TAX_EXCLUSION_REPEALED },
  { label: "Single payer, private delivery (Canada)", policy: SINGLE_PAYER_ADEQUATE },
  { label: "Single payer, low rates", policy: SINGLE_PAYER_LOW_RATES },
  { label: "Public delivery, well funded (NHS)", policy: NHS_WELL_FUNDED },
  { label: "Public delivery, underfunded (NHS)", policy: NHS_UNDERFUNDED },
];

interface State {
  seed: number;
  policy: Policy;
  selectedYear: number;
}

const state: State = { seed: 42, policy: { ...BASELINE_POLICY }, selectedYear: YEARS - 1 };

const cfg = (policy: Policy): SimConfig => ({ seed: state.seed, populationSize: POP, years: YEARS, policy });

const baseline: SimResult = runSimulation(cfg(BASELINE_POLICY));
let result: SimResult = baseline;

// ---- Iron Triangle scoring: 0–1 per axis, 1 = good. ----
function triangleScore(y: YearResult): { cost: number; quality: number; access: number } {
  const burdenShare = y.spending.nheShareOfGdp * (1 + y.government.deadweightLoss / Math.max(1, y.spending.nhe));
  return {
    cost: clamp((0.32 - burdenShare) / (0.32 - 0.09), 0, 1),
    quality: clamp((y.health.meanHealthStock - 0.5) / 0.45, 0, 1),
    access: clamp(1 - y.health.unmetNeedRate, 0, 1),
  };
}

// ---------------- Policy panel (built once, holds live inputs) ----------------
function buildPanel(): HTMLElement {
  const panel = document.createElement("aside");
  panel.id = "panel";

  const presetWrap = document.createElement("div");
  presetWrap.className = "presets";
  presetWrap.innerHTML = `<div class="grouphead">Scenarios</div>`;
  const sel = document.createElement("select");
  sel.innerHTML = PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join("");
  sel.addEventListener("change", () => {
    state.policy = { ...PRESETS[Number(sel.value)]!.policy };
    syncInputs();
    rerun();
  });
  presetWrap.appendChild(sel);
  panel.appendChild(presetWrap);

  for (const group of LEVER_GROUPS) {
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<div class="grouphead">${group}</div>`;
    for (const lever of LEVERS.filter((l) => l.group === group)) g.appendChild(buildLever(lever));
    panel.appendChild(g);
  }
  return panel;
}

const inputs = new Map<keyof Policy, () => void>(); // key -> sync-from-state fn

function buildLever(lever: Lever): HTMLElement {
  const row = document.createElement("div");
  row.className = "lever";
  const id = `lv_${lever.key}`;
  const title = `<label for="${id}" title="${lever.help}">${lever.label}</label>`;

  if (lever.kind === "toggle") {
    row.innerHTML = `${title}<input type="checkbox" id="${id}">`;
    const cb = row.querySelector("input")!;
    cb.addEventListener("change", () => {
      (state.policy as unknown as Record<string, unknown>)[lever.key] = cb.checked;
      rerun();
    });
    inputs.set(lever.key, () => (cb.checked = Boolean(state.policy[lever.key])));
  } else if (lever.kind === "range") {
    row.innerHTML = `${title}<div class="rangewrap"><input type="range" id="${id}" min="${lever.min}" max="${lever.max}" step="${lever.step}"><span class="val"></span></div>`;
    const rng = row.querySelector("input")!;
    const val = row.querySelector(".val")!;
    const apply = () => {
      (state.policy as unknown as Record<string, number>)[lever.key] = Number(rng.value);
      val.textContent = lever.fmt(Number(rng.value));
    };
    rng.addEventListener("input", () => {
      apply();
      rerunDebounced();
    });
    inputs.set(lever.key, () => {
      rng.value = String(clamp(Number(state.policy[lever.key]), lever.min, lever.max));
      val.textContent = lever.fmt(Number(state.policy[lever.key]));
    });
  } else {
    // nullableRange: an on/off checkbox plus a slider (null when off).
    row.innerHTML = `${title}<div class="rangewrap"><input type="checkbox" class="nulltoggle"><input type="range" id="${id}" min="${lever.min}" max="${lever.max}" step="${lever.step}"><span class="val"></span></div>`;
    const cb = row.querySelector(".nulltoggle") as HTMLInputElement;
    const rng = row.querySelector('input[type="range"]') as HTMLInputElement;
    const val = row.querySelector(".val")!;
    const apply = () => {
      if (cb.checked) {
        rng.disabled = false;
        (state.policy as unknown as Record<string, unknown>)[lever.key] = Number(rng.value);
        val.textContent = lever.fmt(Number(rng.value));
      } else {
        rng.disabled = true;
        (state.policy as unknown as Record<string, unknown>)[lever.key] = null;
        val.textContent = lever.offLabel;
      }
    };
    cb.addEventListener("change", () => { apply(); rerun(); });
    rng.addEventListener("input", () => { apply(); rerunDebounced(); });
    inputs.set(lever.key, () => {
      const v = state.policy[lever.key] as number | null;
      cb.checked = v !== null;
      rng.disabled = v === null;
      rng.value = String(clamp(v ?? (lever.min + lever.max) / 2, lever.min, lever.max));
      val.textContent = v === null ? lever.offLabel : lever.fmt(v);
    });
  }
  return row;
}

function syncInputs(): void {
  for (const fn of inputs.values()) fn();
  const presetSel = document.querySelector(".presets select") as HTMLSelectElement | null;
  if (presetSel) presetSel.selectedIndex = -1;
}

// ---------------- Dashboard ----------------
function tile(label: string, value: string, sub: string, tone = "", help = ""): string {
  const h = help ? ` title="${help}"` : "";
  return `<div class="tile ${tone}"${h}><div class="tval">${value}</div><div class="tlabel">${label}</div><div class="tsub">${sub}</div></div>`;
}

function renderDashboard(): void {
  const dash = document.getElementById("dash")!;
  const ys = result.years;
  const last = ys.at(-1)!;
  const b = baseline.years.at(-1)!;
  const yrs = ys.length;

  const deltaInsured = last.insuredRate - b.insuredRate;
  const deltaNhe = last.spending.nheShareOfGdp - b.spending.nheShareOfGdp;
  const deltaHealth = last.health.meanHealthStock - b.health.meanHealthStock;
  const deltaUnmet = last.health.unmetNeedRate - b.health.unmetNeedRate;
  const deltaInno = last.innovation.index - b.innovation.index;
  const deltaCost = (last.government.totalSocialCost - b.government.totalSocialCost) * (330_000_000 / POP);
  const onBaseline = Math.abs(deltaInsured) < 1e-9 && Math.abs(deltaNhe) < 1e-9 && Math.abs(deltaCost) < 1;

  const vsBase = (delta: number, unit: string, decimals: number): string =>
    onBaseline ? "— baseline" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(decimals)} ${unit} vs base`;
  const costVsBase = onBaseline ? "— baseline" : `${deltaCost >= 0 ? "+" : "−"}${dollars(Math.abs(deltaCost))} vs base`;

  const tiles = [
    tile("Insured", pct1(last.insuredRate), vsBase(deltaInsured * 100, "pp", 1), toneFor(deltaInsured), "Share of households with any insurance (ESI, individual, or public). Note: with public direct provision, uninsured households can still get care."),
    tile("Health spending", pct1(last.spending.nheShareOfGdp), vsBase(deltaNhe * 100, "pp of GDP", 1), toneFor(-deltaNhe), "National health expenditure as a share of GDP — total medical spending + insurer/admin load. Extrapolated from the nonelderly-adult sample to the whole population."),
    tile("Population health", last.health.meanHealthStock.toFixed(3), vsBase(deltaHealth, "", 3), toneFor(deltaHealth), "Average 'health stock' across households (0.2–1.0). Each person's stock rises with adequate care and falls with age and unmet need; innovation raises the health return on care. It's a stylized health-capital index, not life expectancy."),
    tile("Unmet need", pct1(last.health.unmetNeedRate), vsBase(deltaUnmet * 100, "pp", 1), toneFor(-deltaUnmet), "Share of households whose delivered care fell meaningfully short of what they needed — due to cost-sharing, being uninsured, or provider queues."),
    tile("Innovation index", last.innovation.index.toFixed(2), vsBase(deltaInno, "", 2), toneFor(deltaInno), `Emergent medical-technology index (starts at 1.0; R&D intensity now ${last.innovation.rdIntensity.toFixed(2)}×). Funded by the commercial system's revenue and provider margins, with a public/spillover floor. Higher innovation raises the health return on care over time — the dynamic payoff of a well-funded, profitable system.`),
    tile("Govt. social cost", dollarsScaled(last.government.totalSocialCost), costVsBase, toneFor(-deltaCost), "Annual government health outlays (subsidies + public insurance + direct provision + the ESI tax break) plus the deadweight loss of raising that revenue (1.3× marginal cost of public funds)."),
  ].join("");

  // Coverage mix (stacked area).
  const covSeries: Series[] = (["esi", "individual", "public", "uninsured"] as const).map((k) => ({
    label: COVERAGE_LABELS[k],
    color: COVERAGE_COLORS[k],
    values: ys.map((y) => y.coverage[k]),
  }));
  const coverageChart = stackedArea("Coverage mix", covSeries, POP);

  // Cost over time.
  const costChart = lineChart({
    title: "Health spending (% of GDP)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    series: [
      { label: "This package", color: "#2563eb", values: ys.map((y) => y.spending.nheShareOfGdp) },
      { label: "Baseline", color: "#94a3b8", values: baseline.years.map((y) => y.spending.nheShareOfGdp) },
    ],
  });

  // Premiums — only meaningful when private insurance markets exist.
  const privateShare = (last.coverage.esi + last.coverage.individual) / POP;
  const premChart =
    state.policy.singlePayer || privateShare < 0.02
      ? noteCard(
          "Private premiums",
          "Not applicable — the ESI and individual insurance markets are switched off under single payer. Everyone is in the public plan; there are no private premiums to price.",
        )
      : lineChart({
          title: "Private premiums",
          yFmt: dollars,
          series: [
            { label: "Indiv. silver", color: "#16a34a", values: ys.map((y) => y.premiums.silver) },
            { label: "Avg ESI", color: "#2563eb", values: ys.map((y) => y.employer.avgPremium) },
          ],
        });

  // Access: wait times.
  const waitChart = lineChart({
    title: "Wait times (weeks)",
    yFmt: (v) => v.toFixed(0),
    series: [
      { label: "Hospital", color: "#ea580c", values: ys.map((y) => y.providers.hospital.waitWeeks) },
      { label: "Physician", color: "#7c3aed", values: ys.map((y) => y.providers.physician.waitWeeks) },
      ...(ys.some((y) => y.publicProvision)
        ? [{ label: "Public system", color: "#0891b2", values: ys.map((y) => y.publicProvision?.waitWeeks ?? 0) }]
        : []),
    ],
  });

  // Market structure: provider prices.
  const priceChart = lineChart({
    title: "Commercial provider price index",
    yFmt: (v) => v.toFixed(2),
    yMin: 0.6,
    series: [
      { label: "Hospital", color: "#ea580c", values: ys.map((y) => y.providers.hospital.commercialPriceIndex) },
      { label: "Physician", color: "#7c3aed", values: ys.map((y) => y.providers.physician.commercialPriceIndex) },
    ],
    reference: { value: 1, label: "baseline" },
  });

  // Iron triangle.
  const triChart = ironTriangle(triangleScore(last), triangleScore(b));

  // Uninsured by income (final year).
  // Uninsured rate by income tercile (final year) — a snapshot bar chart.
  const ui = last.uninsuredRateByIncome;
  const distChart = barChart(
    "Uninsured rate by income (final yr)",
    [
      { label: "Low", value: ui.low, color: "#dc2626" },
      { label: "Middle", value: ui.mid, color: "#dc2626" },
      { label: "High", value: ui.high, color: "#dc2626" },
    ],
    (v) => `${Math.round(v * 100)}%`,
  );

  // Innovation index over time vs. baseline.
  const innoChart = lineChart({
    title: "Innovation index",
    yFmt: (v) => v.toFixed(2),
    yMin: 1,
    series: [
      { label: "This package", color: "#0891b2", values: ys.map((y) => y.innovation.index) },
      { label: "Baseline", color: "#94a3b8", values: baseline.years.map((y) => y.innovation.index) },
    ],
  });

  dash.innerHTML =
    `<div class="tiles">${tiles}</div>` +
    `<div class="grid">${coverageChart}${triChart}${costChart}${waitChart}${premChart}${priceChart}${distChart}${innoChart}${employerChart(ys)}${govChart(ys)}</div>` +
    drillDown();

  // Wire the drill-down year slider.
  const yearSlider = document.getElementById("yearSlider") as HTMLInputElement | null;
  if (yearSlider) {
    yearSlider.addEventListener("input", () => {
      state.selectedYear = Number(yearSlider.value);
      const list = document.getElementById("eventlist");
      if (list) list.innerHTML = eventItems();
      const lbl = document.getElementById("yearLabel");
      if (lbl) lbl.textContent = `Year ${state.selectedYear}`;
    });
  }
  void yrs;
}

/** Employer market over the full horizon: offer rate and plan generosity (both %). */
function employerChart(ys: YearResult[]): string {
  return lineChart({
    title: "Employer market (offer rate & generosity)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    yMin: 0,
    yMax: 1,
    series: [
      { label: "ESI offer rate", color: "#2563eb", values: ys.map((y) => y.employer.offerRate) },
      { label: "Avg plan AV", color: "#16a34a", values: ys.map((y) => y.employer.avgActuarialValue) },
    ],
  });
}

/** Government ledger over the full horizon: cost components stacked (scaled $). */
function govChart(ys: YearResult[]): string {
  const scale = (vals: number[]) => vals.map((v) => (v * 330_000_000) / POP);
  const series: Series[] = [
    { label: "Subsidies", color: "#2563eb", values: scale(ys.map((y) => y.government.subsidyOutlays)) },
    { label: "Public ins.", color: "#9333ea", values: scale(ys.map((y) => y.government.publicOutlays)) },
    { label: "Direct provision", color: "#0891b2", values: scale(ys.map((y) => y.government.publicProvisionOutlays)) },
    { label: "ESI tax break", color: "#16a34a", values: scale(ys.map((y) => y.government.esiTaxExpenditure)) },
    { label: "Deadweight loss", color: "#dc2626", values: scale(ys.map((y) => y.government.deadweightLoss)) },
  ];
  return stackedAreaDollars("Government cost (annual)", series, dollars);
}

/** A dashboard-grid card showing an explanatory note in place of a chart. */
function noteCard(title: string, text: string): string {
  return `<div class="card notecard"><div class="charttitle">${title}</div><p class="note">${text}</p></div>`;
}

function drillDown(): string {
  return (
    `<div class="drill"><div class="drillhead"><span class="charttitle">Why? — what happened in <span id="yearLabel">Year ${state.selectedYear}</span></span>` +
    `<input type="range" id="yearSlider" min="0" max="${result.years.length - 1}" value="${state.selectedYear}"></div>` +
    `<ul id="eventlist">${eventItems()}</ul></div>`
  );
}

function eventItems(): string {
  const y = result.years[state.selectedYear];
  if (!y || y.events.length === 0) return `<li class="muted">A quiet year — no notable events.</li>`;
  return y.events.map((e) => `<li><span class="tag tag-${e.module}">${e.module}</span>${escapeHtml(e.narrative)}</li>`).join("");
}

// ---- helpers ----
function kv(k: string, v: string): string {
  return `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
}
function signed(x: number, suffix: string, invertColors = false): string {
  void invertColors;
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(1)} ${suffix}`;
}
function toneFor(goodDelta: number): string {
  if (goodDelta > 0.002) return "good";
  if (goodDelta < -0.002) return "bad";
  return "";
}
/** Outlays are for an 8k-agent sample; scale to a ~330M population for legibility. */
function dollarsScaled(x: number): string {
  return dollars((x * 330_000_000) / POP);
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------- Run loop ----------------
let debounceTimer: number | undefined;
function rerunDebounced(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(rerun, 140);
}
function rerun(): void {
  document.body.classList.add("computing");
  // Defer so the "computing" cursor paints before the (synchronous) run.
  requestAnimationFrame(() => {
    result = runSimulation(cfg(state.policy));
    state.selectedYear = Math.min(state.selectedYear, result.years.length - 1);
    renderDashboard();
    location.replace(`#${encodeState({ seed: state.seed, policy: state.policy })}`);
    document.body.classList.remove("computing");
  });
}

// ---------------- Boot ----------------
function boot(): void {
  if (location.hash.length > 1) {
    const decoded = decodeState(location.hash.slice(1));
    if (decoded) {
      state.seed = decoded.seed;
      state.policy = decoded.policy;
    }
  }
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div><h1>Health Policy Simulator</h1><p class="sub">Design a policy package and watch the Iron Triangle — cost, quality, access — play out over ${YEARS} years.</p></div>
      <div class="actions"><button id="share">Copy share link</button><button id="reset">Reset to baseline</button></div>
    </header>
    <div class="layout"><div id="panelmount"></div><main id="dash"></main></div>`;
  document.getElementById("panelmount")!.replaceWith(buildPanel());
  syncInputs();
  document.getElementById("share")!.addEventListener("click", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied!");
    } catch {
      flash("Copy this URL from the address bar.");
    }
  });
  document.getElementById("reset")!.addEventListener("click", () => {
    state.policy = { ...BASELINE_POLICY };
    syncInputs();
    rerun();
  });
  rerun();
}

function flash(msg: string): void {
  const el = document.createElement("div");
  el.className = "flash";
  el.textContent = msg;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1800);
}

boot();
