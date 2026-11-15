/**
 * Comparison view: several packages (pasted as share links) side by side, for
 * team presentations and for checking submissions against a challenge.
 */
import { BASELINE_POLICY, describeChanges } from "../engine/index.ts";
import type { SimResult } from "../engine/index.ts";
import { decodeState, encodeState, toBase64, fromBase64, type ShareState } from "./levers.ts";
import { RunPool, statAt, meanSeries } from "./runs.ts";
import { METRICS } from "./metrics.ts";
import { judge, describeCriterion, sameChallenge, type Challenge } from "./challenge.ts";
import { lineChart, ironTriangleMulti } from "./charts.ts";
import { esc, PACKAGE_COLORS } from "./format.ts";
import { RUNS, YEARS, configFor, seedsFor, meanTriangle } from "./shared.ts";

const MAX_PACKAGES = PACKAGE_COLORS.length;
const GROUP = "compare";

export interface PackageSpec {
  name: string;
  state: ShareState;
}

/** One package per line: "Name | link", or just a link. */
export function parsePackages(text: string): { specs: PackageSpec[]; errors: string[] } {
  const specs: PackageSpec[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const bar = line.indexOf("|");
    const name = bar >= 0 ? line.slice(0, bar).trim() : "";
    const link = (bar >= 0 ? line.slice(bar + 1) : line).trim();
    const hash = link.includes("#") ? link.slice(link.indexOf("#") + 1) : link;
    const state = hash.startsWith("cmp.") ? null : decodeState(hash);
    if (!state) {
      errors.push(`Line ${i + 1} is not a simulator share link.`);
      return;
    }
    if (specs.length >= MAX_PACKAGES) {
      if (!errors.some((e) => e.startsWith("Only the first"))) errors.push(`Only the first ${MAX_PACKAGES} packages are compared.`);
      return;
    }
    specs.push({ name: (name || `Package ${specs.length + 1}`).slice(0, 40), state });
  });
  return { specs, errors };
}

export function encodeCompare(specs: PackageSpec[]): string {
  return `cmp.${toBase64(JSON.stringify(specs.map((s) => [s.name, encodeState(s.state)])))}`;
}

/** Turn a comparison link back into the text of the input box. */
export function decodeCompare(hash: string): string | null {
  if (!hash.startsWith("cmp.")) return null;
  try {
    const list = JSON.parse(fromBase64(hash.slice(4))) as unknown;
    if (!Array.isArray(list)) return null;
    return list
      .filter((item): item is [string, string] => Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string")
      .map(([name, link]) => `${name.replace(/[|\r\n]/g, " ")} | #${link}`)
      .join("\n");
  } catch {
    return null;
  }
}

export interface CompareHost {
  pool: RunPool;
  /** The package currently in the simulator, offered as a line to add. */
  current(): ShareState;
  /** Open a package in the simulator. */
  open(state: ShareState): void;
  /** Leave the comparison view. */
  back(): void;
  flash(message: string): void;
}

interface Entry {
  spec: PackageSpec;
  runs: SimResult[];
}

export function mountCompare(root: HTMLElement, host: CompareHost, initialText: string): void {
  let entries: Entry[] = [];
  let noReform: SimResult[] = [];
  let errors: string[] = [];
  let expected = 0;
  let run = 0;

  root.innerHTML =
    `<section class="card compareinput">` +
    `<div class="charttitle">Compare packages</div>` +
    `<p class="note">Paste one share link per line. Put a name and a bar in front to label it, for example <code>Team A | http://…</code>. ` +
    `Each package is run ${RUNS} times and shown as the average, in its final year (year ${YEARS - 1}).</p>` +
    `<textarea id="cmpText" rows="6" spellcheck="false" placeholder="Team A | (paste share link)&#10;Team B | (paste share link)"></textarea>` +
    `<div class="editoractions"><button id="cmpAddCurrent">Add the package in the simulator</button><span class="spacer"></span>` +
    `<button id="cmpBack">Back to the simulator</button><button id="cmpCopy">Copy comparison link</button><button id="cmpRun" class="primary">Compare</button></div>` +
    `<div id="cmpErrors" class="errors"></div>` +
    `</section><div id="cmpResults"></div>`;

  const textarea = root.querySelector("#cmpText") as HTMLTextAreaElement;
  const results = root.querySelector("#cmpResults") as HTMLElement;
  const errorBox = root.querySelector("#cmpErrors") as HTMLElement;
  textarea.value = initialText;

  const done = (): number => entries.reduce((n, e) => n + e.runs.filter(Boolean).length, 0) + noReform.filter(Boolean).length;

  function start(): void {
    const parsed = parsePackages(textarea.value);
    errors = parsed.errors;
    errorBox.innerHTML = errors.map((e) => `<div>${esc(e)}</div>`).join("");
    host.pool.cancel(GROUP);
    const mine = ++run;
    entries = parsed.specs.map((spec) => ({ spec, runs: [] }));
    noReform = [];
    if (entries.length === 0) {
      results.innerHTML = "";
      history.replaceState(null, "", "#cmp.");
      return;
    }
    history.replaceState(null, "", `#${encodeCompare(parsed.specs)}`);
    expected = (entries.length + 1) * RUNS;
    render();
    const first = entries[0]!.spec.state;
    seedsFor(first.seed).forEach((seed, i) => {
      void host.pool.run(configFor(first, BASELINE_POLICY, seed), GROUP).then((res) => {
        if (!res || mine !== run) return;
        noReform[i] = res;
        render();
      });
    });
    for (const entry of entries) {
      seedsFor(entry.spec.state.seed).forEach((seed, i) => {
        void host.pool.run(configFor(entry.spec.state, entry.spec.state.policy, seed), GROUP).then((res) => {
          if (!res || mine !== run) return;
          entry.runs[i] = res;
          render();
        });
      });
    }
  }

  function render(): void {
    const finished = done();
    if (finished < expected) {
      results.innerHTML = `<p class="timeline">Running the packages: ${finished} of ${expected} runs finished…</p>`;
      return;
    }
    const finalYear = YEARS - 1;
    const colored = entries.map((e, i) => ({ ...e, color: PACKAGE_COLORS[i % PACKAGE_COLORS.length]! }));

    // The challenge everyone is judged against: the first one found among the links.
    const referee: Challenge | null = entries.find((e) => e.spec.state.challenge)?.spec.state.challenge ?? null;

    const triangle = ironTriangleMulti(
      `Iron Triangle — year ${finalYear}`,
      colored.map((e) => ({ color: e.color, score: meanTriangle(e.runs, finalYear) })),
      meanTriangle(noReform, finalYear),
    );

    // Table: one row per package, best value in each column marked.
    const cells = METRICS.map((m) => {
      const values = colored.map((e) => statAt(e.runs, finalYear, m.read).mean);
      const best = m.better === "higher" ? Math.max(...values) : Math.min(...values);
      return { metric: m, values, best, base: statAt(noReform, finalYear, m.read).mean };
    });
    const head = `<tr><th>Package</th>${cells.map((c) => `<th title="${esc(c.metric.help)}">${esc(c.metric.label)}</th>`).join("")}${referee ? "<th>Challenge</th>" : ""}<th></th></tr>`;
    const rows = colored
      .map((e, i) => {
        const tds = cells
          .map((c) => {
            const v = c.values[i]!;
            const isBest = colored.length > 1 && Math.abs(v - c.best) < 1e-9;
            return `<td class="${isBest ? "best" : ""}">${esc(c.metric.fmt(v))}</td>`;
          })
          .join("");
        let challengeCell = "";
        if (referee) {
          const verdicts = judge(referee, e.runs);
          const met = verdicts.filter((v) => v.met).length;
          const own = e.spec.state.challenge;
          const mismatch = own && !sameChallenge(own, referee) ? ` <span class="warn" title="This link carries a different challenge from the one being judged.">different challenge in link</span>` : "";
          const detail = verdicts.map((v) => `${v.met ? "✓" : "✗"} ${describeCriterion(v.criterion)} (now ${v.metric.fmt(v.value)})`).join("\n");
          challengeCell = `<td class="${met === verdicts.length ? "pass" : "fail"}" title="${esc(detail)}">${met === verdicts.length ? "✓ met" : `${met} of ${verdicts.length}`}${mismatch}</td>`;
        }
        const changes = describeChanges(BASELINE_POLICY, e.spec.state.policy);
        const what = changes.length === 0 ? "No reform (current law)." : `Reform in year ${e.spec.state.reformYear}: ${changes.join("; ")}.`;
        return (
          `<tr><td class="pname" title="${esc(what)}"><span class="swatch" style="background:${e.color}"></span>${esc(e.spec.name)}</td>` +
          `${tds}${challengeCell}<td><button class="cmpOpen" data-index="${i}">Open</button></td></tr>`
        );
      })
      .join("");
    const baseRow =
      `<tr class="baserow"><td class="pname"><span class="swatch dashed"></span>No reform</td>` +
      `${cells.map((c) => `<td>${esc(c.metric.fmt(c.base))}</td>`).join("")}${referee ? "<td></td>" : ""}<td></td></tr>`;

    const refereeNote = referee
      ? `<p class="note">Judged against the challenge${referee.title ? ` “${esc(referee.title)}”` : ""}: ${esc(referee.criteria.map(describeCriterion).join("; "))}. ` +
        `Hover over a result for the detail.</p>`
      : "";

    // Paths over time, one line per package.
    const charts = METRICS.slice(0, 6)
      .concat(METRICS.filter((m) => m.key === "longestWait"))
      .map((m) => {
        const series = [
          ...colored.map((e) => ({ label: e.spec.name, color: e.color, values: meanSeries(e.runs, m.read), hideLegend: true })),
          { label: "No reform", color: "#64748b", values: meanSeries(noReform, m.read), dashed: true, hideLegend: true },
        ];
        // Scale each chart to its own data, so differences between packages are visible.
        const all = series.flatMap((s) => s.values);
        const lo = Math.min(...all);
        const hi = Math.max(...all);
        const pad = Math.max((hi - lo) * 0.08, Math.abs(hi) * 0.01, 1e-6);
        return lineChart({
          title: `${m.label}${m.unit.startsWith("(") ? "" : ` (${m.unit})`}`,
          yFmt: (v) => m.fmt(v),
          yMin: Math.max(0, lo - pad),
          yMax: hi + pad,
          series,
        });
      })
      .join("");

    results.innerHTML =
      `<p class="timeline">Final-year values (year ${finalYear}), averaged over ${RUNS} runs per package. The best value in each column is highlighted. ` +
      `Hover over a package name to see what it changes. “No reform” uses the first package’s seed.</p>` +
      `<div class="tablewrap"><table class="cmptable"><thead>${head}</thead><tbody>${rows}${baseRow}</tbody></table></div>` +
      refereeNote +
      `<div class="grid"><div class="cell">${triangle}</div>${charts}</div>`;

    for (const btn of results.querySelectorAll<HTMLButtonElement>(".cmpOpen")) {
      btn.addEventListener("click", () => host.open(entries[Number(btn.dataset.index)]!.spec.state));
    }
  }

  root.querySelector("#cmpRun")!.addEventListener("click", start);
  root.querySelector("#cmpBack")!.addEventListener("click", () => {
    host.pool.cancel(GROUP);
    host.back();
  });
  root.querySelector("#cmpAddCurrent")!.addEventListener("click", () => {
    const n = parsePackages(textarea.value).specs.length + 1;
    const line = `Package ${n} | #${encodeState(host.current())}`;
    textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n${line}` : line;
  });
  root.querySelector("#cmpCopy")!.addEventListener("click", async () => {
    const { specs } = parsePackages(textarea.value);
    const url = `${location.origin}${location.pathname}#${encodeCompare(specs)}`;
    try {
      await navigator.clipboard.writeText(url);
      host.flash("Comparison link copied!");
    } catch {
      host.flash("Copy the URL from the address bar after pressing Compare.");
    }
  });

  if (initialText.trim()) start();
}
