import {
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
import type { ExplanationEvent, Policy, SimResult, YearResult } from "../engine/index.ts";
import { LEVERS, LEVER_GROUPS, TIMING, encodeState, decodeState, type Lever, type ShareState } from "./levers.ts";
import {
  lineChart,
  stackedArea,
  stackedAreaDollars,
  ironTriangle,
  groupedStackedBars,
  type GapSeries,
  type Series,
  type ReformMarker,
} from "./charts.ts";
import { dollars, clamp, esc, COVERAGE_COLORS, COVERAGE_LABELS } from "./format.ts";
import { RunPool, band, meanSeries, statAt, pairedDelta } from "./runs.ts";
import { TILE_METRICS, METRIC_BY_KEY, burdenShare, type Metric } from "./metrics.ts";
import { challengeBanner, challengeEditor, criterionRow, readEditor, MAX_CRITERIA, type Challenge } from "./challenge.ts";
import { mountCompare, decodeCompare } from "./compare.ts";
import { POP, YEARS, RUNS, configFor, seedsFor, triangleScore, meanTriangle } from "./shared.ts";

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

interface State extends ShareState {
  selectedYear: number;
  /** The chart whose "Why?" is open, or null for the year-by-year view. */
  explain: string | null;
  editingChallenge: boolean;
}

const state: State = {
  seed: 42,
  policy: { ...BASELINE_POLICY },
  reformYear: TIMING.defaultReformYear,
  phaseInYears: 0,
  challenge: null,
  selectedYear: TIMING.defaultReformYear,
  explain: null,
  editingChallenge: false,
};

const shareState = (): ShareState => ({
  seed: state.seed,
  policy: { ...state.policy },
  reformYear: state.reformYear,
  phaseInYears: state.phaseInYears,
  challenge: state.challenge,
});

// ---------------- Runs ----------------
// Every package is run RUNS times on consecutive seeds, in the background. The
// no-reform runs use the same seeds, so each reform run has an exact twin.
const pool = new RunPool(clamp((navigator.hardwareConcurrency || 4) - 1, 1, 4));
let baseSeed: number | null = null;
let baseRuns: (SimResult | undefined)[] = [];
let reformRuns: (SimResult | undefined)[] = [];
let generation = 0;

function hasReform(): boolean {
  return describeChanges(BASELINE_POLICY, state.policy).length > 0;
}

/** The runs ready to show: reform runs paired with their no-reform twins. Run 1 always leads. */
function ready(): { runs: SimResult[]; base: SimResult[] } {
  const runs: SimResult[] = [];
  const base: SimResult[] = [];
  const source = hasReform() ? reformRuns : baseRuns;
  for (let i = 0; i < RUNS; i++) {
    const r = source[i];
    const b = baseRuns[i];
    if (!r || !b) {
      if (i === 0) break;
      continue;
    }
    runs.push(r);
    base.push(b);
  }
  return { runs, base };
}

function ensureBaseline(): void {
  if (baseSeed === state.seed) return;
  pool.cancel("base");
  baseSeed = state.seed;
  baseRuns = [];
  const forSeed = state.seed;
  seedsFor(state.seed).forEach((seed, i) => {
    void pool.run(configFor(state, BASELINE_POLICY, seed), "base").then((res) => {
      if (!res || forSeed !== baseSeed) return;
      baseRuns[i] = res;
      onRunArrived();
    });
  });
}

function rerun(): void {
  const mine = ++generation;
  pool.cancel("reform");
  reformRuns = [];
  history.replaceState(null, "", `#${encodeState(shareState())}`);
  syncPreset();
  document.body.classList.add("computing");
  ensureBaseline();
  if (!hasReform()) {
    onRunArrived();
    return;
  }
  seedsFor(state.seed).forEach((seed, i) => {
    void pool.run(configFor(state, state.policy, seed), "reform").then((res) => {
      if (!res || mine !== generation) return;
      reformRuns[i] = res;
      onRunArrived();
    });
  });
}

let debounceTimer: number | undefined;
function rerunDebounced(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(rerun, 140);
}

let shownRuns = -1;
/** Redraw when the first run lands (so there is something to look at) and again when all have. */
function onRunArrived(): void {
  if (view !== "simulator") return;
  const n = ready().runs.length;
  if (n === 0) return;
  if (n === 1 || n === RUNS || shownRuns === -1) {
    renderDashboard();
  } else {
    const status = document.getElementById("runstatus");
    if (status) status.textContent = runStatus(n);
  }
  if (n === RUNS) document.body.classList.remove("computing");
}

function runStatus(n: number): string {
  return n < RUNS
    ? `Showing run 1 of ${RUNS}; the other runs are finishing in the background (${n} done).`
    : `Every number is the average of ${RUNS} runs that differ only in luck (who falls ill, when providers merge). Shaded bands and “runs:” show the lowest and highest run.`;
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
    `<label for="tm_${o.id}" title="${esc(o.help)}">${o.label}</label>` +
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
  const title = `<label for="${id}" title="${esc(lever.help)}">${lever.label}</label>`;
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

// ---------------- Per-chart explanations ----------------
/**
 * What moves each chart: the mechanism in a sentence or two, the kinds of
 * events that drive it, and a lead series to summarize.
 */
interface Explain {
  title: string;
  mechanism: string;
  types: string[];
  lead?: { label: string; read: (y: YearResult, first: YearResult) => number | null; fmt: (v: number) => string };
}

const metricLead = (key: string): Explain["lead"] => {
  const m = METRIC_BY_KEY.get(key)!;
  return { label: m.label, read: (y) => m.read(y), fmt: m.fmt };
};

const EXPLAIN: Record<string, Explain> = {
  coverage: {
    title: "Coverage mix",
    mechanism:
      "Each year a household takes the option that costs it least for the risk it faces. Coverage moves when a rule changes what people are offered or what it costs them (eligibility, subsidies, a mandate), when premiums move, or when employers start or stop offering.",
    types: ["reform-begins", "reform-complete", "uninsured-shift", "individual-market-collapse", "offer-shift"],
    lead: metricLead("insured"),
  },
  spending: {
    title: "Health spending",
    mechanism:
      "Spending is price times quantity, plus administration. It rises when more people are covered and use more care, or when provider consolidation lifts prices. It falls when prices are capped or set by the government, and also when shortages keep care from being delivered.",
    types: ["reform-begins", "price-change", "merger-approved", "uninsured-shift", "provider-exit", "wait-times"],
    lead: metricLead("nhe"),
  },
  waits: {
    title: "Wait times",
    mechanism:
      "Waits depend on demand relative to capacity. Covering more people raises demand at once; capacity follows only after construction (3 years) or training (7 years), and only as far as Certificate of Need, residency slots and payment rates allow.",
    types: ["reform-begins", "wait-times", "capacity-expansion", "supply-gate", "underinvestment", "provider-exit", "public-provision"],
    lead: metricLead("longestWait"),
  },
  capacity: {
    title: "Private provider capacity",
    mechanism:
      "Providers plan capacity for the demand they expect and replace what retires. New capacity takes 3 years to build (hospitals) or 7 to train (physicians). Certificate of Need and residency slots can block it, and providers will not invest at margins that do not justify it.",
    types: ["reform-begins", "capacity-expansion", "supply-gate", "underinvestment", "provider-exit", "provider-entry"],
    lead: {
      label: "Hospital capacity (year 0 = 1.00)",
      read: (y, first) => (y.providers.hospital.active ? y.providers.hospital.capacity / first.providers.hospital.capacity : null),
      fmt: (v) => v.toFixed(2),
    },
  },
  premiums: {
    title: "Private premiums",
    mechanism:
      "Insurers set each year's premium from last year's claims. Premiums rise when the people buying are sicker (healthy people leaving the pool) or when provider prices rise. Employer premiums are paid partly by the worker and partly by the firm, which takes its share out of wages.",
    types: ["reform-begins", "premium-change", "individual-market-collapse", "price-change", "wage-offset"],
    lead: { label: "Individual silver premium", read: (y) => (y.policy.singlePayer ? null : y.premiums.silver), fmt: dollars },
  },
  prices: {
    title: "Prices paid to private providers",
    mechanism:
      "Commercial prices rise with market concentration: providers merge when a merger would raise their revenue, and antitrust review decides whether it goes through. Public programs pay an administered rate, so the average price paid falls as more patients are publicly covered.",
    types: ["reform-begins", "merger-approved", "merger-blocked", "price-change", "provider-entry"],
    lead: {
      label: "Hospital price paid (index)",
      read: (y) => (y.providers.hospital.active ? y.providers.hospital.avgPricePaid : null),
      fmt: (v) => v.toFixed(2),
    },
  },
  uninsured: {
    title: "Uninsured rate by income third",
    mechanism:
      "Low-income households qualify for public coverage and subsidies but face the most trouble enrolling; high-income households have more to lose by going without. The gaps between the lines move with eligibility rules, subsidies, mandates, and whether employers offer.",
    types: ["reform-begins", "reform-complete", "uninsured-shift", "individual-market-collapse", "offer-shift"],
    lead: metricLead("uninsuredLow"),
  },
  innovation: {
    title: "Innovation index",
    mechanism:
      "New treatments are funded out of commercial revenue and provider margins, with a floor from public and spillover research. Squeezing prices or replacing commercial payers lowers R&D intensity, and the index then grows more slowly; the effect on health builds up over years.",
    types: ["reform-begins", "innovation-shift"],
    lead: metricLead("innovation"),
  },
  employer: {
    title: "Employer market",
    mechanism:
      "A firm offers coverage when what workers gain from it, plus the tax break, exceeds the cost of running a plan; small firms are the ones on the margin. Generosity follows the tax break. What the firm pays toward premiums comes out of wages.",
    types: ["reform-begins", "offer-shift", "wage-offset"],
    lead: { label: "Share of workers offered coverage", read: (y) => y.employer.offerRate * 100, fmt: (v) => `${v.toFixed(0)}%` },
  },
  gov: {
    title: "Government cost",
    mechanism:
      "The government pays for subsidies, public insurance, anything it delivers directly, and the tax revenue it gives up on employer premiums. Every dollar raised costs society about $1.30 once the drag of taxation is counted; that extra 30 cents is the deadweight loss.",
    types: ["reform-begins", "fiscal-ledger"],
    lead: metricLead("govCost"),
  },
};

EXPLAIN.burden = {
  title: "Who pays",
  mechanism:
    "Health care is paid for through four channels: at the point of care, in premiums, in the wages employers hold back to pay their share of premiums, and in taxes. Premiums and held-back wages are about the same number of dollars whatever a worker earns, so they take a larger share of a small income; taxes rise with income. Moving costs from premiums to taxes therefore shifts the burden toward higher incomes. The pale segment is the income lost to the drag of raising those taxes, which nobody receives.",
  types: ["reform-begins", "wage-offset", "offer-shift", "fiscal-ledger"],
  lead: { label: "Health costs paid by the low-income third (share of income)", read: (y) => burdenShare(y, "low"), fmt: (v) => `${v.toFixed(1)}%` },
};

/** A chart with its "Why?" button. */
function cell(key: string, chart: string): string {
  return `<div class="cell">${chart}<button class="whybtn" data-why="${key}" title="What moved this chart, and why">Why?</button></div>`;
}

// ---------------- Dashboard ----------------
function tileHtml(m: Metric, runs: SimResult[], base: SimResult[], finalYear: number, reform: boolean): string {
  const value = statAt(runs, finalYear, m.read);
  let tone = "";
  let sub = "— no reform";
  let range = runs.length > 1 ? `runs: ${m.fmt(value.lo)} to ${m.fmt(value.hi)}` : "";
  if (reform) {
    const d = pairedDelta(runs, base, finalYear, m.read);
    // A change that rounds to nothing is shown without a sign.
    const signed = (x: number) => {
      const size = m.fmtDelta(Math.abs(x));
      return /[1-9]/.test(size) ? `${x >= 0 ? "+" : "−"}${size}` : size;
    };
    sub = `${signed(d.mean)} vs no reform`;
    const clear = runs.length === 1 || d.sameSign;
    if (Math.abs(d.mean) >= m.epsilon && clear) tone = d.mean > 0 === (m.better === "higher") ? "good" : "bad";
    if (runs.length > 1) range = `runs: ${signed(d.lo)} to ${signed(d.hi)}${d.sameSign ? "" : " · could be luck"}`;
  }
  return (
    `<div class="tile ${tone}" title="${esc(m.help)}"><div class="tval">${esc(m.fmt(value.mean))}</div>` +
    `<div class="tlabel">${esc(m.label)}</div><div class="tsub">${esc(sub)}</div><div class="trange">${esc(range)}</div></div>`
  );
}

function renderDashboard(): void {
  const dash = document.getElementById("dash");
  if (!dash) return;
  const { runs, base } = ready();
  if (runs.length === 0) {
    dash.innerHTML = `<p class="timeline">Running the simulation…</p>`;
    return;
  }
  shownRuns = runs.length;
  const primary = runs[0]!;
  const finalYear = primary.years.length - 1;
  state.selectedYear = clamp(state.selectedYear, 0, finalYear);
  const reform = hasReform();
  const marker: ReformMarker | undefined = reform ? { start: state.reformYear, phaseIn: state.phaseInYears } : undefined;
  const many = runs.length > 1;

  /** A line for the package: the mean across runs, with the range shaded once several runs are in. */
  const line = (label: string, color: string, read: (y: YearResult) => number | null): GapSeries => {
    const b = band(runs, read);
    return many ? { label, color, values: b.mean, lo: b.lo, hi: b.hi } : { label, color, values: b.mean };
  };
  const baseLine = (read: (y: YearResult) => number | null): GapSeries => ({
    label: "No reform",
    color: "#94a3b8",
    values: band(base, read).mean,
  });

  const tiles = TILE_METRICS.map((m) => tileHtml(m, runs, base, finalYear, reform)).join("");

  const timeline = !reform
    ? `No reform selected: this is current law for all ${YEARS} years.`
    : `Years 0–${state.reformYear - 1} run under current law. The reform begins in year ${state.reformYear}` +
      (state.phaseInYears > 0
        ? ` and phases in: dials move gradually, on/off changes take effect in year ${state.reformYear + state.phaseInYears}, when it is fully in force`
        : "") +
      `. The tiles compare year ${finalYear} with the same year had there been no reform.`;

  // Coverage mix (stacked area of mean counts).
  const covSeries: Series[] = (["esi", "individual", "public", "uninsured"] as const).map((k) => ({
    label: COVERAGE_LABELS[k],
    color: COVERAGE_COLORS[k],
    values: meanSeries(runs, (y) => y.coverage[k]),
  }));
  const coverageChart = stackedArea("Coverage mix", covSeries, POP, marker);

  const costChart = lineChart({
    title: "Health spending (% of GDP)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    marker,
    series: [line("This package", "#2563eb", (y) => y.spending.nheShareOfGdp), ...(reform ? [baseLine((y) => y.spending.nheShareOfGdp)] : [])],
  });

  // Premiums exist only in years with private insurance markets; the lines
  // stop where those markets end (single payer).
  const lastPolicy = primary.years[finalYear]!.policy;
  const silver = line("Indiv. silver", "#16a34a", (y) => (y.policy.singlePayer ? null : y.premiums.silver));
  const esiPremium = line("Avg ESI", "#2563eb", (y) => (y.employer.offerRate > 0 ? y.employer.avgPremium : null));
  // What a worker at an offering firm gives up in cash wages to fund the employer's share.
  const wageOffset = line("ESI cost taken from wages", "#d97706", (y) => (y.employer.offerRate > 0 ? y.employer.wageOffsetPerOfferedWorker : null));
  const premChart =
    silver.values.every((v) => v === null) && esiPremium.values.every((v) => v === null)
      ? noteCard("Private premiums", "Not applicable — there are no private insurance markets under single payer.")
      : lineChart({
          title: lastPolicy.singlePayer ? "Private premiums (end with single payer)" : "Private premiums and the wages that pay for them",
          yFmt: dollars,
          marker,
          series: [silver, esiPremium, wageOffset],
        });

  // Access: wait times, in whichever delivery systems have patients.
  const waitChart = lineChart({
    title: "Wait times (weeks)",
    yFmt: (v) => v.toFixed(v < 10 ? 1 : 0),
    marker,
    series: [
      line("Hospital", "#ea580c", (y) => (y.providers.hospital.active ? y.providers.hospital.waitWeeks : null)),
      line("Physician", "#7c3aed", (y) => (y.providers.physician.active ? y.providers.physician.waitWeeks : null)),
      ...(primary.years.some((y) => y.publicProvision) ? [line("Public system", "#0891b2", (y) => y.publicProvision?.waitWeeks ?? null)] : []),
    ],
  });

  // Supply: capacity relative to year 0, run by run, then averaged.
  const capacityIndex = (sector: "hospital" | "physician", label: string, color: string): GapSeries => {
    const perRun = runs.map((r) => {
      const first = r.years[0]!.providers[sector].capacity;
      return r.years.map((y) => (y.providers[sector].active ? y.providers[sector].capacity / first : null));
    });
    const values: (number | null)[] = [];
    const lo: (number | null)[] = [];
    const hi: (number | null)[] = [];
    for (let year = 0; year <= finalYear; year++) {
      const vs = perRun.map((p) => p[year]!).filter((v): v is number => v !== null);
      const all = vs.length === perRun.length && vs.length > 0;
      values.push(all ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
      lo.push(all ? Math.min(...vs) : null);
      hi.push(all ? Math.max(...vs) : null);
    }
    return many ? { label, color, values, lo, hi } : { label, color, values };
  };
  const capacityChart = lineChart({
    title: "Private provider capacity (year 0 = 1.00)",
    yFmt: (v) => v.toFixed(2),
    yMin: 0.5,
    marker,
    series: [capacityIndex("hospital", "Hospital", "#ea580c"), capacityIndex("physician", "Physician", "#7c3aed")],
    reference: { value: 1, label: "year 0" },
  });

  // What private providers are actually paid per unit of care, across all payers.
  const priceChart = lineChart({
    title: "Prices paid to private providers (all payers, index)",
    yFmt: (v) => v.toFixed(2),
    yMin: 0.6,
    marker,
    series: [
      line("Hospital", "#ea580c", (y) => (y.providers.hospital.active ? y.providers.hospital.avgPricePaid : null)),
      line("Physician", "#7c3aed", (y) => (y.providers.physician.active ? y.providers.physician.avgPricePaid : null)),
    ],
    reference: { value: PARAMS.providerMarginalCost, label: "provider cost" },
  });

  // Uninsured rate within each third of the income distribution, over time.
  const distChart = lineChart({
    title: "Uninsured rate by income third",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    yMin: 0,
    marker,
    series: [
      line("Low income", "#dc2626", (y) => y.uninsuredRateByIncome.low),
      line("Middle", "#d97706", (y) => y.uninsuredRateByIncome.mid),
      line("High income", "#2563eb", (y) => y.uninsuredRateByIncome.high),
    ],
  });

  const innoChart = lineChart({
    title: "Innovation index",
    yFmt: (v) => v.toFixed(2),
    yMin: 1,
    marker,
    series: [line("This package", "#0891b2", (y) => y.innovation.index), ...(reform ? [baseLine((y) => y.innovation.index)] : [])],
  });

  const employerChart = lineChart({
    title: "Employer market (offer rate & generosity)",
    yFmt: (v) => `${Math.round(v * 100)}%`,
    yMin: 0,
    yMax: 1,
    marker,
    series: [
      line("ESI offer rate", "#2563eb", (y) => y.employer.offerRate),
      // Generosity is undefined in years with no employer plans.
      line("Avg plan AV", "#16a34a", (y) => (y.employer.offerRate > 0 ? y.employer.avgActuarialValue : null)),
    ],
  });

  // Government ledger over the full horizon: cost components stacked (national $, mean of runs).
  const ledger = (read: (y: YearResult) => number) => meanSeries(runs, (y) => read(y) * NATIONAL);
  const govChart = stackedAreaDollars(
    "Government cost (annual)",
    [
      { label: "Subsidies", color: "#2563eb", values: ledger((y) => y.government.subsidyOutlays) },
      { label: "Public ins.", color: "#9333ea", values: ledger((y) => y.government.publicOutlays) },
      { label: "Direct provision", color: "#0891b2", values: ledger((y) => y.government.publicProvisionOutlays) },
      { label: "ESI tax break", color: "#16a34a", values: ledger((y) => y.government.esiTaxExpenditure) },
      { label: "Deadweight loss", color: "#dc2626", values: ledger((y) => y.government.deadweightLoss) },
    ],
    dollars,
    marker,
  );

  // Who pays, over time: payments through every channel as a share of income, by income third.
  const burdenLines = lineChart({
    title: "Who pays: health costs as a share of income",
    yFmt: (v) => `${Math.round(v)}%`,
    yMin: 0,
    marker,
    legendNote: reform ? "dashed = no reform" : undefined,
    series: [
      ...BURDEN_GROUPS.map((g) => line(g.label, g.color, (y) => burdenShare(y, g.key))),
      ...(reform
        ? BURDEN_GROUPS.map((g) => ({ label: g.label, color: g.color, values: meanSeries(base, (y) => burdenShare(y, g.key)), dashed: true, hideLegend: true }))
        : []),
    ],
  });

  const challengeHtml = state.editingChallenge
    ? challengeEditor(state.challenge)
    : state.challenge
      ? challengeBanner(state.challenge, runs, runs.length === RUNS)
      : "";

  dash.innerHTML =
    challengeHtml +
    `<p class="timeline">${timeline}</p>` +
    `<div class="tiles">${tiles}</div>` +
    `<p class="runstatus" id="runstatus">${esc(runStatus(runs.length))}</p>` +
    `<div class="grid">${yearBar()}` +
    `<div class="cell" id="triCell">${triangleChart()}</div><div class="cell" id="scoreCell">${scoreChart()}</div>` +
    cell("coverage", coverageChart) +
    cell("spending", costChart) +
    cell("waits", waitChart) +
    cell("capacity", capacityChart) +
    (premChart.startsWith("<svg") ? cell("premiums", premChart) : premChart) +
    cell("prices", priceChart) +
    cell("uninsured", distChart) +
    cell("innovation", innoChart) +
    cell("employer", employerChart) +
    cell("gov", govChart) +
    `<div class="cell" id="burdenCell">${burdenBars()}</div>` +
    cell("burden", burdenLines) +
    `</div>` +
    `<div id="drillmount">${drillDown()}</div>`;

  wireDashboard(dash);
}

function wireDashboard(dash: HTMLElement): void {
  // Both year sliders (above the triangle and in the "Why?" panel) pick the same year.
  wireYearSliders(dash.querySelector(".grid")!);
  document.getElementById("playYears")!.addEventListener("click", togglePlayback);
  // One handler for every "Why?" button, including those in cells that are redrawn when the year changes.
  dash.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".whybtn");
    if (!btn) return;
    state.explain = btn.dataset.why ?? null;
    refreshDrill();
    document.getElementById("drillmount")!.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  wireDrill();
  wireChallenge(dash);
}

function wireYearSliders(root: ParentNode): void {
  for (const slider of root.querySelectorAll<HTMLInputElement>(".yearslider")) {
    slider.addEventListener("input", () => {
      stopPlayback();
      state.selectedYear = Number(slider.value);
      updateYearViews();
    });
  }
}

// ---------------- Year selection: the Iron Triangle and "Why?" follow it ----------------
const TRI_AXES = [
  { key: "cost", label: "Affordability", color: "#2563eb" },
  { key: "quality", label: "Quality", color: "#16a34a" },
  { key: "access", label: "Access", color: "#ea580c" },
] as const;

// ---- Who pays: the selected year, by income third and by channel ----
const BURDEN_GROUPS = [
  { key: "low", label: "Low income", color: "#dc2626" },
  { key: "mid", label: "Middle", color: "#d97706" },
  { key: "high", label: "High income", color: "#2563eb" },
] as const;
const BURDEN_PARTS = [
  { key: "outOfPocket", label: "Out of pocket", color: "#dc2626" },
  { key: "premiums", label: "Premiums", color: "#2563eb" },
  { key: "wages", label: "Wages given up", color: "#d97706" },
  { key: "taxes", label: "Taxes", color: "#9333ea" },
  { key: "drag", label: "Drag of taxation", color: "#cbd5e1" },
] as const;

/** Stacked bars for the selected year: each income group, with and without the reform. */
function burdenBars(): string {
  const { runs, base } = ready();
  const year = state.selectedYear;
  const reform = hasReform();
  const bar = (label: string, source: SimResult[], group: "low" | "mid" | "high" | "all") => {
    const income = source.reduce((sum, r) => sum + r.years[year]!.burden[group].income, 0) / source.length;
    const share = (key: (typeof BURDEN_PARTS)[number]["key"]) =>
      (source.reduce((sum, r) => sum + r.years[year]!.burden[group][key], 0) / source.length / income) * 100;
    const segments = BURDEN_PARTS.map((p) => ({ value: share(p.key), color: p.color }));
    const paid = segments.slice(0, 4).reduce((sum, s) => sum + s.value, 0);
    return { label, total: `${paid.toFixed(0)}%`, segments };
  };
  const groups = ([...BURDEN_GROUPS, { key: "all", label: "Everyone" }] as const).map((g) => ({
    label: g.label,
    bars: reform ? [bar("without", base, g.key), bar("with", runs, g.key)] : [bar("", runs, g.key)],
  }));
  const chart = groupedStackedBars({
    title: `Who pays — year ${year} (share of income)`,
    groups,
    legend: BURDEN_PARTS.map((p) => ({ label: p.label, color: p.color })),
    yFmt: (v) => `${Math.round(v)}%`,
  });
  return `${chart}<button class="whybtn" data-why="burden" title="What moved this chart, and why">Why?</button>`;
}

/** The triangle for the selected year, against the no-reform runs in the same year. */
function triangleChart(): string {
  const { runs, base } = ready();
  return ironTriangle(`Iron Triangle — year ${state.selectedYear}`, meanTriangle(runs, state.selectedYear), meanTriangle(base, state.selectedYear));
}

/** The three triangle scores in every year; the cursor marks the selected year. */
function scoreChart(): string {
  const { runs, base } = ready();
  const reform = hasReform();
  return lineChart({
    title: "Iron Triangle scores over time (1 = best)",
    yFmt: (v) => v.toFixed(2),
    yMin: 0,
    yMax: 1,
    marker: reform ? { start: state.reformYear, phaseIn: state.phaseInYears } : undefined,
    cursor: state.selectedYear,
    legendNote: reform ? "dashed = no reform" : undefined,
    series: [
      ...TRI_AXES.map((a) => ({ label: a.label, color: a.color, values: meanSeries(runs, (y) => triangleScore(y)[a.key]) })),
      ...(reform
        ? TRI_AXES.map((a) => ({ label: a.label, color: a.color, values: meanSeries(base, (y) => triangleScore(y)[a.key]), dashed: true, hideLegend: true }))
        : []),
    ],
  });
}

const PLAY = "▶ Play";
const PAUSE = "❚❚ Pause";
let playTimer: number | undefined;

function yearBar(): string {
  return (
    `<div class="yearbar"><button id="playYears" title="Step through the years">${playTimer === undefined ? PLAY : PAUSE}</button>` +
    `<input type="range" class="yearslider" aria-label="Year shown in the Iron Triangle" min="0" max="${YEARS - 1}" value="${state.selectedYear}">` +
    `<span class="yearlabel">${yearLabel()}</span></div>`
  );
}

/** Redraw everything that depends on the selected year (cheap: no re-simulation). */
function updateYearViews(): void {
  const set = (id: string, html: string) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };
  set("triCell", triangleChart());
  set("scoreCell", scoreChart());
  set("burdenCell", burdenBars());
  if (!state.explain) set("eventlist", eventItems());
  for (const el of document.querySelectorAll(".yearlabel")) el.textContent = yearLabel();
  for (const s of document.querySelectorAll<HTMLInputElement>(".yearslider")) s.value = String(state.selectedYear);
  for (const li of document.querySelectorAll<HTMLElement>("#eventlist li[data-year]")) {
    li.classList.toggle("current", Number(li.dataset.year) === state.selectedYear);
  }
}

function stopPlayback(): void {
  window.clearInterval(playTimer);
  playTimer = undefined;
  const btn = document.getElementById("playYears");
  if (btn) btn.textContent = PLAY;
}
function togglePlayback(): void {
  if (playTimer !== undefined) return stopPlayback();
  if (state.selectedYear >= YEARS - 1) state.selectedYear = 0;
  updateYearViews();
  document.getElementById("playYears")!.textContent = PAUSE;
  playTimer = window.setInterval(() => {
    if (state.selectedYear >= YEARS - 1) return stopPlayback();
    state.selectedYear += 1;
    updateYearViews();
  }, 500);
}

/** A dashboard-grid card showing an explanatory note in place of a chart. */
function noteCard(title: string, text: string): string {
  return `<div class="card notecard"><div class="charttitle">${title}</div><p class="note">${text}</p></div>`;
}

/** "Year 6 — reform phasing in" etc. */
function yearLabel(): string {
  const y = ready().runs[0]?.years[state.selectedYear];
  if (!y) return `Year ${state.selectedYear}`;
  const phase = !hasReform()
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

// ---------------- "Why?" panel: by year, or by chart ----------------
const eventHtml = (e: ExplanationEvent): string => `<span class="tag tag-${e.module}">${e.module}</span>${esc(e.narrative)}`;

/** Events are specific to one run (which year a merger happens is luck), so they come from run 1. */
const RUN_NOTE = `Events are from run 1 of ${RUNS}. Chance events such as mergers fall in different years in the other runs.`;

function drillDown(): string {
  return state.explain && EXPLAIN[state.explain] ? chartDrill(state.explain, EXPLAIN[state.explain]!) : yearDrill();
}

function yearDrill(): string {
  return (
    `<div class="drill"><div class="drillhead"><span class="charttitle">Why? — what happened in <span class="yearlabel">${yearLabel()}</span></span>` +
    `<input type="range" class="yearslider" aria-label="Year explained" min="0" max="${YEARS - 1}" value="${state.selectedYear}"></div>` +
    `<ul id="eventlist">${eventItems()}</ul>` +
    `<p class="drillnote">${RUN_NOTE} Use the “Why?” button on a chart to follow one outcome through all the years.</p></div>`
  );
}

function eventItems(): string {
  const y = ready().runs[0]?.years[state.selectedYear];
  if (!y || y.events.length === 0) return `<li class="muted">A quiet year — no notable events.</li>`;
  return y.events.map((e) => `<li>${eventHtml(e)}</li>`).join("");
}

/** Fiscal ledgers are written every year; for the chart view, keep the turning points. */
function ledgerYears(): Set<number> {
  return new Set([0, state.reformYear - 1, state.reformYear, state.reformYear + state.phaseInYears, YEARS - 1]);
}

function chartDrill(key: string, ex: Explain): string {
  const { runs } = ready();
  const primary = runs[0]!;
  const reform = hasReform();
  const keep = ledgerYears();
  const events = primary.years.flatMap((y) =>
    y.events.filter((e) => ex.types.includes(e.type) && (e.type !== "fiscal-ledger" || keep.has(y.year))),
  );
  const items =
    events.length === 0
      ? `<li class="muted">No notable events of this kind in this run: the chart moved gradually, for the reason above.</li>`
      : events
          .map(
            (e) =>
              `<li data-year="${e.year}" class="${e.year === state.selectedYear ? "current" : ""}">` +
              `<button class="yearlink" data-year="${e.year}" title="Show this year in the Iron Triangle">Year ${e.year}</button>${eventHtml(e)}</li>`,
          )
          .join("");

  // Where the lead series started, where it ended, and its biggest single-year move (mean of runs).
  let summary = "";
  if (ex.lead) {
    const lead = ex.lead;
    const perRun = runs.map((r) => r.years.map((y) => lead.read(y, r.years[0]!)));
    const mean = perRun[0]!.map((_, year) => {
      const vs = perRun.map((p) => p[year]!).filter((v): v is number => v !== null);
      return vs.length === perRun.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    });
    const fromYear = reform ? state.reformYear - 1 : 0;
    const from = mean[fromYear];
    const present = mean.map((v, year) => ({ v, year })).filter((p): p is { v: number; year: number } => p.v !== null);
    const lastPoint = present.at(-1);
    if (from != null && lastPoint) {
      let biggest = { year: -1, change: 0 };
      for (let year = 1; year < mean.length; year++) {
        const a = mean[year - 1];
        const b = mean[year];
        if (a != null && b != null && Math.abs(b - a) > Math.abs(biggest.change)) biggest = { year, change: b - a };
      }
      summary =
        `${esc(lead.label)} was ${esc(lead.fmt(from))} in year ${fromYear}${reform ? " (the last year before the reform)" : ""} ` +
        `and ${esc(lead.fmt(lastPoint.v))} in year ${lastPoint.year}` +
        (lastPoint.year < YEARS - 1 ? `, after which it no longer exists` : "") +
        `.` +
        (biggest.year >= 0
          ? ` Its largest one-year move came in year ${biggest.year}: from ${esc(lead.fmt(mean[biggest.year - 1]!))} to ${esc(lead.fmt(mean[biggest.year]!))}.`
          : "");
    }
  }

  return (
    `<div class="drill"><div class="drillhead"><span class="charttitle">Why? — ${esc(ex.title)}</span>` +
    `<button id="drillByYear">All events, year by year</button></div>` +
    `<p class="mechanism">${esc(ex.mechanism)}</p>` +
    (summary ? `<p class="mechanism">${summary}</p>` : "") +
    `<ul id="eventlist" data-chart="${key}">${items}</ul>` +
    `<p class="drillnote">${RUN_NOTE} Click a year to show it in the Iron Triangle.</p></div>`
  );
}

function refreshDrill(): void {
  const mount = document.getElementById("drillmount");
  if (!mount) return;
  mount.innerHTML = drillDown();
  wireDrill();
}

function wireDrill(): void {
  const mount = document.getElementById("drillmount");
  if (!mount) return;
  wireYearSliders(mount);
  mount.querySelector("#drillByYear")?.addEventListener("click", () => {
    state.explain = null;
    refreshDrill();
  });
  for (const btn of mount.querySelectorAll<HTMLButtonElement>(".yearlink")) {
    btn.addEventListener("click", () => {
      stopPlayback();
      state.selectedYear = Number(btn.dataset.year);
      updateYearViews();
    });
  }
}

// ---------------- Challenge: banner and editor ----------------
function wireChallenge(dash: HTMLElement): void {
  const editor = dash.querySelector<HTMLElement>("#challengeEditor");
  if (!editor) return;
  const rows = editor.querySelector("#chRows")!;
  const wireRow = (row: Element) => {
    row.querySelector(".chDel")!.addEventListener("click", () => row.remove());
    row.querySelector(".chMetric")!.addEventListener("change", (e) => {
      const unit = METRIC_BY_KEY.get((e.target as HTMLSelectElement).value)?.unit ?? "";
      row.querySelector(".chUnit")!.textContent = unit;
    });
  };
  rows.querySelectorAll(".chrow").forEach(wireRow);
  editor.querySelector("#chAdd")!.addEventListener("click", () => {
    if (rows.querySelectorAll(".chrow").length >= MAX_CRITERIA) return flash(`A challenge can have at most ${MAX_CRITERIA} targets.`);
    rows.insertAdjacentHTML("beforeend", criterionRow({ metric: "nhe", op: "<=", value: 18 }));
    wireRow(rows.lastElementChild!);
  });
  const close = (challenge: Challenge | null) => {
    state.challenge = challenge;
    state.editingChallenge = false;
    history.replaceState(null, "", `#${encodeState(shareState())}`);
    renderDashboard();
    syncChallengeButton();
  };
  editor.querySelector("#chApply")!.addEventListener("click", () => {
    const ch = readEditor(editor);
    if (!ch) return flash("Add at least one target with a number.");
    close(ch);
    flash("Challenge set. “Copy share link” now carries it.");
  });
  editor.querySelector("#chCancel")!.addEventListener("click", () => close(state.challenge));
  editor.querySelector("#chRemove")?.addEventListener("click", () => close(null));
}

function syncChallengeButton(): void {
  const btn = document.getElementById("challengeBtn");
  if (btn) btn.textContent = state.challenge ? "Edit challenge" : "Write a challenge";
}

// ---------------- Views ----------------
let view: "simulator" | "compare" = "simulator";

function showSimulator(): void {
  view = "simulator";
  shownRuns = -1;
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div><h1>Health Policy Simulator</h1><p class="sub">Design a reform, choose when it starts, and watch the Iron Triangle — cost, quality, access — play out against the system that already exists.</p></div>
      <div class="actions"><button id="challengeBtn">Write a challenge</button><button id="compareBtn">Compare packages</button><button id="share">Copy share link</button><button id="reset">Reset</button></div>
    </header>
    <div class="layout"><div id="panelmount"></div><main id="dash"><p class="timeline">Running the simulation…</p></main></div>`;
  syncFns.length = 0;
  document.getElementById("panelmount")!.replaceWith(buildPanel());
  syncInputs();
  syncChallengeButton();
  document.getElementById("share")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      flash(state.challenge ? "Link copied, with your package and the challenge." : "Link copied!");
    } catch {
      flash("Copy this URL from the address bar.");
    }
  });
  document.getElementById("reset")!.addEventListener("click", () => {
    state.policy = { ...BASELINE_POLICY };
    state.reformYear = TIMING.defaultReformYear;
    state.phaseInYears = 0;
    state.selectedYear = TIMING.defaultReformYear;
    state.explain = null;
    syncInputs();
    rerun();
  });
  document.getElementById("challengeBtn")!.addEventListener("click", () => {
    state.editingChallenge = !state.editingChallenge;
    renderDashboard();
    document.getElementById("dash")!.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("compareBtn")!.addEventListener("click", () => showCompare(""));
  rerun();
}

function showCompare(initialText: string): void {
  view = "compare";
  stopPlayback();
  pool.cancel("reform");
  document.body.classList.remove("computing");
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div><h1>Health Policy Simulator</h1><p class="sub">Packages side by side: the Iron Triangle, the headline numbers, and how each one gets there.</p></div>
    </header>
    <div id="compare"></div>`;
  if (!initialText) history.replaceState(null, "", "#cmp.");
  mountCompare(
    document.getElementById("compare")!,
    {
      pool,
      current: shareState,
      open: (s) => {
        applyShareState(s);
        showSimulator();
      },
      back: showSimulator,
      flash,
    },
    initialText,
  );
}

function applyShareState(s: ShareState): void {
  state.seed = s.seed;
  state.policy = { ...s.policy };
  state.reformYear = s.reformYear;
  state.phaseInYears = s.phaseInYears;
  state.challenge = s.challenge;
  state.selectedYear = s.reformYear;
  state.explain = null;
  state.editingChallenge = false;
}

function flash(msg: string): void {
  const el = document.createElement("div");
  el.className = "flash";
  el.textContent = msg;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2200);
}

// ---------------- Boot ----------------
function boot(): void {
  const hash = location.hash.slice(1);
  const compareText = decodeCompare(hash);
  if (compareText !== null) {
    showCompare(compareText);
    return;
  }
  if (hash) {
    const decoded = decodeState(hash);
    if (decoded) applyShareState(decoded);
  }
  showSimulator();
}

boot();
