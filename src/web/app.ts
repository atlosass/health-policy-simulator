import {
  runSimulation,
  describeChanges,
  PARAMS,
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
import { LEVERS, LEVER_GROUPS, TIMING, encodeState, decodeState, type Lever } from "./levers.ts";
import {
  lineChart,
  stackedArea,
  stackedAreaDollars,
  barChart,
  ironTriangle,
  type Series,
  type ReformMarker,
} from "./charts.ts";
import { pct1, dollars, clamp, COVERAGE_COLORS, COVERAGE_LABELS } from "./format.ts";

const POP = 8000;
const YEARS = TIMING.years;
/** Sample dollars → national dollars (same scaling the engine uses in its narrative text). */
const NATIONAL = PARAMS.displayPopulation / POP;

const PRESETS: { label: string; policy: Policy }[] = [
  { label: "Current law (no reform)", policy: BASELINE_POLICY },
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
  /** The reform package. The run starts under current law and switches to this. */
  policy: Policy;
  reformYear: number;
  phaseInYears: number;
  selectedYear: number;
}

const state: State = {
  seed: 42,
  policy: { ...BASELINE_POLICY },
  reformYear: TIMING.defaultReformYear,
  phaseInYears: 0,
  selectedYear: TIMING.defaultReformYear,
};

/** Current law for `reformYear` years, then the reform (optionally phased in). */
const cfg = (policy: Policy): SimConfig => ({
  seed: state.seed,
  populationSize: POP,
  years: YEARS,
  policy,
  priorPolicy: BASELINE_POLICY,
  reformYear: state.reformYear,
  phaseInYears: state.phaseInYears,
});

/** The same seed with no reform: the counterfactual every comparison is made against. */
let baseline: SimResult;
let result: SimResult;

// ---- Iron Triangle scoring: 0–1 per axis, 1 = good. ----
function triangleScore(y: YearResult): { cost: number; quality: number; access: number } {
  const burdenShare = y.spending.nheShareOfGdp * (1 + y.government.deadweightLoss / Math.max(1, y.spending.nhe));
  return {
    cost: clamp((0.32 - burdenShare) / (0.32 - 0.09), 0, 1),
    quality: clamp((y.health.meanHealthStock - 0.5) / 0.45, 0, 1),
    // 1 = everyone gets the care they need; 0 = a quarter or more of needed care goes undelivered.
    access: clamp(1 - y.health.careGap / 0.25, 0, 1),
  };
}

// ---------------- Policy panel (built once, holds live inputs) ----------------
const syncFns: (() => void)[] = []; // each copies state into its input

function buildPanel(): HTMLElement {
  const panel = document.createElement("aside");
  panel.id = "panel";

  const presetWrap = document.createElement("div");
  presetWrap.className = "presets";
  presetWrap.innerHTML = `<div class="grouphead">Scenarios</div>`;
  const sel = document.createElement("select");
  sel.innerHTML =
    PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join("") +
    `<option value="custom" disabled hidden>Custom package</option>`;
  sel.addEventListener("change", () => {
    state.policy = { ...PRESETS[Number(sel.value)]!.policy };
    syncInputs();
    rerun();
  });
  presetWrap.appendChild(sel);
  panel.appendChild(presetWrap);

  const timing = document.createElement("div");
  timing.className = "group";
  timing.innerHTML = `<div class="grouphead">Timing</div>`;
  timing.appendChild(
    buildTimingRow({
      id: "reformYear",
      label: "Reform begins in year",
      help: `The simulation runs ${YEARS} years. Until this year the system operates under current law, so the reform lands on an existing system — its premiums, provider capacity and coverage.`,
      min: TIMING.minReformYear,
      max: TIMING.maxReformYear,
      get: () => state.reformYear,
      set: (v) => {
        state.reformYear = v;
        state.selectedYear = v;
      },
      fmt: (v) => `year ${v}`,
    }),
  );
  timing.appendChild(
    buildTimingRow({
      id: "phaseIn",
      label: "Phase-in",
      help: "Years over which the reform phases in. Dials (penalties, payment rates, eligibility lines) move gradually; on/off changes such as single payer take effect when the phase-in completes.",
      min: 0,
      max: TIMING.maxPhaseIn,
      get: () => state.phaseInYears,
      set: (v) => (state.phaseInYears = v),
      fmt: (v) => (v === 0 ? "all at once" : `${v} yr${v === 1 ? "" : "s"}`),
    }),
  );
  panel.appendChild(timing);

  for (const group of LEVER_GROUPS) {
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<div class="grouphead">${group}</div>`;
    for (const lever of LEVERS.filter((l) => l.group === group)) g.appendChild(buildLever(lever));
    panel.appendChild(g);
  }
  return panel;
}

function buildTimingRow(o: {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
  fmt: (v: number) => string;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "lever";
  row.innerHTML =
    `<label for="tm_${o.id}" title="${o.help}">${o.label}</label>` +
    `<div class="rangewrap"><input type="range" id="tm_${o.id}" min="${o.min}" max="${o.max}" step="1"><span class="val"></span></div>`;
  const rng = row.querySelector("input")!;
  const val = row.querySelector(".val")!;
  rng.addEventListener("input", () => {
    o.set(Number(rng.value));
    val.textContent = o.fmt(Number(rng.value));
    rerunDebounced();
  });
  syncFns.push(() => {
    rng.value = String(o.get());
    val.textContent = o.fmt(o.get());
  });
  return row;
}

function buildLever(lever: Lever): HTMLElement {
  const row = document.createElement("div");
  row.className = "lever";
  const id = `lv_${lever.key}`;
  const title = `<label for="${id}" title="${lever.help}">${lever.label}</label>`;
  const policy = () => state.policy as unknown as Record<string, unknown>;

  if (lever.kind === "toggle") {
    row.innerHTML = `${title}<input type="checkbox" id="${id}">`;
    const cb = row.querySelector("input")!;
    cb.addEventListener("change", () => {
      policy()[lever.key] = cb.checked;
      rerun();
    });
    syncFns.push(() => (cb.checked = Boolean(state.policy[lever.key])));
  } else if (lever.kind === "range") {
    row.innerHTML = `${title}<div class="rangewrap"><input type="range" id="${id}" min="${lever.min}" max="${lever.max}" step="${lever.step}"><span class="val"></span></div>`;
    const rng = row.querySelector("input")!;
    const val = row.querySelector(".val")!;
    rng.addEventListener("input", () => {
      policy()[lever.key] = Number(rng.value);
      val.textContent = lever.fmt(Number(rng.value));
      rerunDebounced();
    });
    syncFns.push(() => {
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
      rng.disabled = !cb.checked;
      policy()[lever.key] = cb.checked ? Number(rng.value) : null;
      val.textContent = cb.checked ? lever.fmt(Number(rng.value)) : lever.offLabel;
    };
    cb.addEventListener("change", () => {
      apply();
      rerun();
    });
    rng.addEventListener("input", () => {
      apply();
      rerunDebounced();
    });
    syncFns.push(() => {
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
  for (const fn of syncFns) fn();
  syncPreset();
}

/** Show the scenario that matches the current levers, or "Custom package". */
function syncPreset(): void {
  const presetSel = document.querySelector(".presets select") as HTMLSelectElement | null;
  if (!presetSel) return;
  const match = PRESETS.findIndex((p) => describeChanges(p.policy, state.policy).length === 0);
  presetSel.value = match >= 0 ? String(match) : "custom";
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
  const finalYear = ys.length - 1;

  const noReform = describeChanges(BASELINE_POLICY, state.policy).length === 0;
  const marker: ReformMarker | undefined = noReform
    ? undefined
    : { start: state.reformYear, phaseIn: state.phaseInYears };

  const deltaInsured = last.insuredRate - b.insuredRate;
  const deltaNhe = last.spending.nheShareOfGdp - b.spending.nheShareOfGdp;
  const deltaHealth = last.health.meanHealthStock - b.health.meanHealthStock;
  const deltaGap = last.health.careGap - b.health.careGap;
  const deltaInno = last.innovation.index - b.innovation.index;
  const deltaCost = (last.government.totalSocialCost - b.government.totalSocialCost) * NATIONAL;

  const vsBase = (delta: number, unit: string, decimals: number): string =>
    noReform ? "— no reform" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(decimals)}${unit ? ` ${unit}` : ""} vs no reform`;
  const costVsBase = noReform ? "— no reform" : `${deltaCost >= 0 ? "+" : "−"}${dollars(Math.abs(deltaCost))} vs no reform`;

  const tiles = [
    tile("Insured", pct1(last.insuredRate), vsBase(deltaInsured * 100, "pp", 1), toneFor(deltaInsured), "Share of households with any insurance (ESI, individual, or public). Note: with public direct provision, uninsured households can still get care."),
    tile("Health spending", pct1(last.spending.nheShareOfGdp), vsBase(deltaNhe * 100, "pp of GDP", 1), toneFor(-deltaNhe), "National health expenditure as a share of GDP — total medical spending + insurer/admin load. Extrapolated from the nonelderly-adult sample to the whole population."),
    tile("Population health", last.health.meanHealthStock.toFixed(3), vsBase(deltaHealth, "", 3), toneFor(deltaHealth), "Average 'health stock' across households (0.2–1.0). Each person's stock rises with adequate care and falls with age and with care they needed but did not get; innovation raises the health return on care. It's a stylized health-capital index, not life expectancy."),
    tile("Care gap", pct1(last.health.careGap), vsBase(deltaGap * 100, "pp", 1), toneFor(-deltaGap), "Average share of needed care that households did not receive: care skipped because of cost-sharing or being uninsured, care rationed when demand exceeds provider capacity, and access lost to long waits."),
    tile("Innovation index", last.innovation.index.toFixed(2), vsBase(deltaInno, "", 2), toneFor(deltaInno), `Emergent medical-technology index (starts at 1.0; R&D intensity now ${last.innovation.rdIntensity.toFixed(2)}×). Funded by the commercial system's revenue and provider margins, with a public/spillover floor. Higher innovation raises the health return on care over time — the dynamic payoff of a well-funded, profitable system.`),
    tile("Govt. social cost", dollars(last.government.totalSocialCost * NATIONAL), costVsBase, toneFor(-deltaCost), "Annual government health outlays (subsidies + public insurance + direct provision + the ESI tax break) plus the deadweight loss of raising that revenue (1.3× marginal cost of public funds). Scaled from the sample to a US-sized population."),
  ].join("");

  const timeline = noReform
    ? `No reform selected: this is current law for all ${YEARS} years.`
    : `Years 0–${state.reformYear - 1} run under current law. The reform begins in year ${state.reformYear}` +
      (state.phaseInYears > 0
        ? ` and phases in: dials move gradually, on/off changes take effect in year ${state.reformYear + state.phaseInYears}, when it is fully in force`
        : "") +
      `. The tiles compare year ${finalYear} with the same year had there been no reform.`;

  // Coverage mix (stacked area).
  const covSeries: Series[] = (["esi", "individual", "public", "uninsured"] as const).map((k) => ({
    label: COVERAGE_LABELS[k],
    color: COVERAGE_COLORS[k],
    values: ys.map((y) => y.coverage[k]),
  }));
  const coverageChart = stackedArea("Coverage mix", covSeries, POP, marker);

  // Cost over time.
  const costChart = lineChart({
    title: "Health spending (% of GDP)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    marker,
    series: [
      { label: "This package", color: "#2563eb", values: ys.map((y) => y.spending.nheShareOfGdp) },
      { label: "No reform", color: "#94a3b8", values: baseline.years.map((y) => y.spending.nheShareOfGdp) },
    ],
  });

  // Premiums exist only in years with private insurance markets; the lines
  // stop where those markets end (single payer).
  const silver = ys.map((y) => (y.policy.singlePayer ? null : y.premiums.silver));
  const esiPremium = ys.map((y) => (y.employer.offerRate > 0 ? y.employer.avgPremium : null));
  const premChart =
    silver.every((v) => v === null) && esiPremium.every((v) => v === null)
      ? noteCard("Private premiums", "Not applicable — there are no private insurance markets under single payer.")
      : lineChart({
          title: last.policy.singlePayer ? "Private premiums (end with single payer)" : "Private premiums",
          yFmt: dollars,
          marker,
          series: [
            { label: "Indiv. silver", color: "#16a34a", values: silver },
            { label: "Avg ESI", color: "#2563eb", values: esiPremium },
          ],
        });

  // Access: wait times, in whichever delivery systems have patients.
  const waitChart = lineChart({
    title: "Wait times (weeks)",
    yFmt: (v) => v.toFixed(0),
    marker,
    series: [
      { label: "Hospital", color: "#ea580c", values: ys.map((y) => (y.providers.hospital.active ? y.providers.hospital.waitWeeks : null)) },
      { label: "Physician", color: "#7c3aed", values: ys.map((y) => (y.providers.physician.active ? y.providers.physician.waitWeeks : null)) },
      ...(ys.some((y) => y.publicProvision)
        ? [{ label: "Public system", color: "#0891b2", values: ys.map((y) => y.publicProvision?.waitWeeks ?? null) }]
        : []),
    ],
  });

  // What private providers are actually paid per unit of care, across all
  // payers. Rises with consolidation; falls to the administered rate under
  // single payer; absent when all care is publicly delivered.
  const priceChart = lineChart({
    title: "Prices paid to private providers (all payers, index)",
    yFmt: (v) => v.toFixed(2),
    yMin: 0.6,
    marker,
    series: [
      { label: "Hospital", color: "#ea580c", values: ys.map((y) => (y.providers.hospital.active ? y.providers.hospital.avgPricePaid : null)) },
      { label: "Physician", color: "#7c3aed", values: ys.map((y) => (y.providers.physician.active ? y.providers.physician.avgPricePaid : null)) },
    ],
    reference: { value: PARAMS.providerMarginalCost, label: "provider cost" },
  });

  // Iron triangle.
  const triChart = ironTriangle(triangleScore(last), triangleScore(b));

  // Uninsured rate by income tercile (final year) — a snapshot bar chart.
  const ui = last.uninsuredRateByIncome;
  const distChart = barChart(
    `Uninsured rate by income (year ${finalYear})`,
    [
      { label: "Low", value: ui.low, color: "#dc2626" },
      { label: "Middle", value: ui.mid, color: "#dc2626" },
      { label: "High", value: ui.high, color: "#dc2626" },
    ],
    (v) => `${Math.round(v * 100)}%`,
  );

  // Innovation index over time vs. no reform.
  const innoChart = lineChart({
    title: "Innovation index",
    yFmt: (v) => v.toFixed(2),
    yMin: 1,
    marker,
    series: [
      { label: "This package", color: "#0891b2", values: ys.map((y) => y.innovation.index) },
      { label: "No reform", color: "#94a3b8", values: baseline.years.map((y) => y.innovation.index) },
    ],
  });

  dash.innerHTML =
    `<p class="timeline">${timeline}</p>` +
    `<div class="tiles">${tiles}</div>` +
    `<div class="grid">${coverageChart}${triChart}${costChart}${waitChart}${premChart}${priceChart}${distChart}${innoChart}${employerChart(ys, marker)}${govChart(ys, marker)}</div>` +
    drillDown();

  // Wire the drill-down year slider.
  const yearSlider = document.getElementById("yearSlider") as HTMLInputElement | null;
  if (yearSlider) {
    yearSlider.addEventListener("input", () => {
      state.selectedYear = Number(yearSlider.value);
      const list = document.getElementById("eventlist");
      if (list) list.innerHTML = eventItems();
      const lbl = document.getElementById("yearLabel");
      if (lbl) lbl.textContent = yearLabel();
    });
  }
}

/** Employer market over the full horizon: offer rate and plan generosity (both %). */
function employerChart(ys: YearResult[], marker?: ReformMarker): string {
  return lineChart({
    title: "Employer market (offer rate & generosity)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    yMin: 0,
    yMax: 1,
    marker,
    series: [
      { label: "ESI offer rate", color: "#2563eb", values: ys.map((y) => y.employer.offerRate) },
      // Generosity is undefined in years with no employer plans.
      { label: "Avg plan AV", color: "#16a34a", values: ys.map((y) => (y.employer.offerRate > 0 ? y.employer.avgActuarialValue : null)) },
    ],
  });
}

/** Government ledger over the full horizon: cost components stacked (national $). */
function govChart(ys: YearResult[], marker?: ReformMarker): string {
  const scale = (vals: number[]) => vals.map((v) => v * NATIONAL);
  const series: Series[] = [
    { label: "Subsidies", color: "#2563eb", values: scale(ys.map((y) => y.government.subsidyOutlays)) },
    { label: "Public ins.", color: "#9333ea", values: scale(ys.map((y) => y.government.publicOutlays)) },
    { label: "Direct provision", color: "#0891b2", values: scale(ys.map((y) => y.government.publicProvisionOutlays)) },
    { label: "ESI tax break", color: "#16a34a", values: scale(ys.map((y) => y.government.esiTaxExpenditure)) },
    { label: "Deadweight loss", color: "#dc2626", values: scale(ys.map((y) => y.government.deadweightLoss)) },
  ];
  return stackedAreaDollars("Government cost (annual)", series, dollars, marker);
}

/** A dashboard-grid card showing an explanatory note in place of a chart. */
function noteCard(title: string, text: string): string {
  return `<div class="card notecard"><div class="charttitle">${title}</div><p class="note">${text}</p></div>`;
}

/** "Year 6 — reform phasing in" etc. */
function yearLabel(): string {
  const y = result.years[state.selectedYear];
  if (!y) return `Year ${state.selectedYear}`;
  const noReform = describeChanges(BASELINE_POLICY, state.policy).length === 0;
  const phase = noReform
    ? "current law"
    : y.reformProgress === 0
      ? "before the reform"
      : y.year === state.reformYear
        ? y.reformProgress < 1
          ? "reform begins (phasing in)"
          : "reform takes effect"
        : y.reformProgress < 1
          ? "reform phasing in"
          : "reform in force";
  return `Year ${y.year} — ${phase}`;
}

function drillDown(): string {
  return (
    `<div class="drill"><div class="drillhead"><span class="charttitle">Why? — what happened in <span id="yearLabel">${yearLabel()}</span></span>` +
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
function toneFor(goodDelta: number): string {
  if (goodDelta > 0.002) return "good";
  if (goodDelta < -0.002) return "bad";
  return "";
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
    state.selectedYear = clamp(state.selectedYear, 0, result.years.length - 1);
    syncPreset();
    renderDashboard();
    location.replace(
      `#${encodeState({ seed: state.seed, policy: state.policy, reformYear: state.reformYear, phaseInYears: state.phaseInYears })}`,
    );
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
      state.reformYear = decoded.reformYear;
      state.phaseInYears = decoded.phaseInYears;
      state.selectedYear = decoded.reformYear;
    }
  }
  // The no-reform counterfactual uses the same seed, so the years before the
  // reform are identical in both runs.
  baseline = runSimulation(cfg(BASELINE_POLICY));
  result = baseline;

  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div><h1>Health Policy Simulator</h1><p class="sub">Design a reform, choose when it starts, and watch the Iron Triangle — cost, quality, access — play out against the system that already exists.</p></div>
      <div class="actions"><button id="share">Copy share link</button><button id="reset">Reset</button></div>
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
    state.reformYear = TIMING.defaultReformYear;
    state.phaseInYears = 0;
    state.selectedYear = TIMING.defaultReformYear;
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
