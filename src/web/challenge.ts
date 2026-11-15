/**
 * Challenges: an assignment an instructor writes as a list of targets
 * ("insured at least 95%, health spending at most 18% of GDP"). The challenge
 * travels in the share link, and is judged on the final year, averaged over
 * the runs, so a result is reproducible by anyone who opens the link.
 */
import type { SimResult } from "../engine/index.ts";
import { METRIC_BY_KEY, METRICS, type Metric } from "./metrics.ts";
import { statAt } from "./runs.ts";
import { esc } from "./format.ts";

export interface Criterion {
  metric: string;
  op: ">=" | "<=";
  value: number;
}

export interface Challenge {
  title: string;
  criteria: Criterion[];
}

export const MAX_CRITERIA = 6;
const MAX_TITLE = 80;

/** Accept only a well-formed challenge; anything else (a hand-edited link) is dropped. */
export function sanitizeChallenge(raw: unknown): Challenge | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { t?: unknown; c?: unknown };
  if (!Array.isArray(obj.c)) return null;
  const criteria: Criterion[] = [];
  for (const item of obj.c.slice(0, MAX_CRITERIA)) {
    if (!Array.isArray(item)) continue;
    const [metric, op, value] = item as unknown[];
    if (typeof metric !== "string" || !METRIC_BY_KEY.has(metric)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    criteria.push({ metric, op: op === "<=" ? "<=" : ">=", value });
  }
  if (criteria.length === 0) return null;
  const title = typeof obj.t === "string" ? obj.t.slice(0, MAX_TITLE) : "";
  return { title, criteria };
}

/** Compact form for the share link. */
export function packChallenge(ch: Challenge): { t: string; c: [string, string, number][] } {
  return { t: ch.title, c: ch.criteria.map((c) => [c.metric, c.op, c.value]) };
}

export function sameChallenge(a: Challenge | null, b: Challenge | null): boolean {
  return JSON.stringify(a ? packChallenge(a) : null) === JSON.stringify(b ? packChallenge(b) : null);
}

export interface Verdict {
  criterion: Criterion;
  metric: Metric;
  value: number;
  met: boolean;
}

/** Judge each criterion on the final year, averaged over the runs. */
export function judge(ch: Challenge, runs: SimResult[]): Verdict[] {
  const finalYear = (runs[0]?.years.length ?? 1) - 1;
  return ch.criteria.map((criterion) => {
    const metric = METRIC_BY_KEY.get(criterion.metric)!;
    const value = statAt(runs, finalYear, metric.read).mean;
    return { criterion, metric, value, met: criterion.op === ">=" ? value >= criterion.value : value <= criterion.value };
  });
}

const opWords = (op: Criterion["op"]): string => (op === ">=" ? "at least" : "at most");

export function describeCriterion(c: Criterion): string {
  const metric = METRIC_BY_KEY.get(c.metric)!;
  return `${metric.label} ${opWords(c.op)} ${metric.fmt(c.value)}`;
}

/** The banner students see: each target, where they stand, and whether it is met. */
export function challengeBanner(ch: Challenge, runs: SimResult[], settled: boolean): string {
  const verdicts = judge(ch, runs);
  const metCount = verdicts.filter((v) => v.met).length;
  const all = metCount === verdicts.length;
  const finalYear = (runs[0]?.years.length ?? 1) - 1;
  const items = verdicts
    .map(
      (v) =>
        `<li class="${v.met ? "met" : "unmet"}"><span class="mark">${v.met ? "✓" : "✗"}</span>` +
        `${esc(describeCriterion(v.criterion))} <span class="now">now ${esc(v.metric.fmt(v.value))}</span></li>`,
    )
    .join("");
  const status = !settled
    ? `Checking… (${metCount} of ${verdicts.length} met on the first run)`
    : all
      ? `Challenge met: all ${verdicts.length} targets.`
      : `${metCount} of ${verdicts.length} targets met.`;
  return (
    `<section class="challenge ${settled && all ? "passed" : ""}">` +
    `<div class="chead"><span class="ctitle">Challenge${ch.title ? `: ${esc(ch.title)}` : ""}</span>` +
    `<span class="cstatus">${esc(status)}</span></div>` +
    `<ul class="criteria">${items}</ul>` +
    `<p class="cnote">Judged in year ${finalYear}, on the average of ${runs.length} run${runs.length === 1 ? "" : "s"}. ` +
    `To hand in your answer, use “Copy share link”: the link carries your package and this challenge.</p>` +
    `</section>`
  );
}

/** The form an instructor fills in. Rows are read back with `readEditor`. */
export function challengeEditor(ch: Challenge | null): string {
  const rows = (ch?.criteria ?? [{ metric: "insured", op: ">=", value: 95 } satisfies Criterion])
    .map((c) => criterionRow(c))
    .join("");
  return (
    `<section class="card editor" id="challengeEditor">` +
    `<div class="charttitle">Write a challenge</div>` +
    `<p class="note">Set the levers to the starting point you want students to begin from, list the targets, then send them the share link. ` +
    `Targets are judged in the final year, averaged over the runs.</p>` +
    `<label class="field">Title <input type="text" id="chTitle" maxlength="${MAX_TITLE}" value="${esc(ch?.title ?? "")}" placeholder="e.g. Cover everyone without breaking the budget"></label>` +
    `<div id="chRows">${rows}</div>` +
    `<div class="editoractions"><button id="chAdd">Add a target</button>` +
    `<span class="spacer"></span>` +
    (ch ? `<button id="chRemove">Remove the challenge</button>` : "") +
    `<button id="chCancel">Cancel</button><button id="chApply" class="primary">Use this challenge</button></div>` +
    `</section>`
  );
}

export function criterionRow(c: Criterion): string {
  const options = METRICS.map((m) => `<option value="${m.key}"${m.key === c.metric ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  const unit = METRIC_BY_KEY.get(c.metric)?.unit ?? "";
  return (
    `<div class="chrow"><select class="chMetric">${options}</select>` +
    `<select class="chOp"><option value=">="${c.op === ">=" ? " selected" : ""}>at least</option><option value="<="${c.op === "<=" ? " selected" : ""}>at most</option></select>` +
    `<input type="number" class="chValue" step="any" value="${c.value}">` +
    `<span class="chUnit">${esc(unit)}</span>` +
    `<button class="chDel" title="Remove this target">×</button></div>`
  );
}

/** Read the editor back into a challenge, or null if no valid target is listed. */
export function readEditor(root: HTMLElement): Challenge | null {
  const title = (root.querySelector("#chTitle") as HTMLInputElement | null)?.value.trim().slice(0, MAX_TITLE) ?? "";
  const criteria: Criterion[] = [];
  for (const row of root.querySelectorAll(".chrow")) {
    const metric = (row.querySelector(".chMetric") as HTMLSelectElement).value;
    const op = (row.querySelector(".chOp") as HTMLSelectElement).value === "<=" ? "<=" : ">=";
    const value = Number((row.querySelector(".chValue") as HTMLInputElement).value);
    if (METRIC_BY_KEY.has(metric) && Number.isFinite(value)) criteria.push({ metric, op, value });
  }
  return criteria.length > 0 ? { title, criteria: criteria.slice(0, MAX_CRITERIA) } : null;
}
