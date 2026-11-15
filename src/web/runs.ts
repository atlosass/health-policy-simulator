/**
 * Running simulations off the main thread, and summarizing several runs of the
 * same package that differ only in their random seed.
 */
import { runSimulation } from "../engine/index.ts";
import type { SimConfig, SimResult, YearResult } from "../engine/index.ts";

interface Task {
  id: number;
  cfg: SimConfig;
  group: string;
  generation: number;
  resolve: (result: SimResult | null) => void;
}

/**
 * A small pool of Web Workers. `run` resolves with the result, or with null if
 * its group was cancelled in the meantime. If workers are unavailable the pool
 * falls back to running on the main thread, one simulation per timer tick.
 */
export class RunPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Task>();
  private queue: Task[] = [];
  private generations = new Map<string, number>();
  private nextId = 1;
  private useWorkers = true;

  constructor(size: number) {
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<{ id: number; result: SimResult }>) => this.finish(worker, e.data.result);
        worker.onerror = () => this.abandonWorkers();
        this.idle.push(worker);
      }
    } catch {
      this.abandonWorkers();
    }
  }

  run(cfg: SimConfig, group: string): Promise<SimResult | null> {
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, cfg, group, generation: this.generations.get(group) ?? 0, resolve });
      this.pump();
    });
  }

  /** Drop everything queued or running for this group; their promises resolve with null. */
  cancel(group: string): void {
    this.generations.set(group, (this.generations.get(group) ?? 0) + 1);
    const kept: Task[] = [];
    for (const task of this.queue) {
      if (task.group === group) task.resolve(null);
      else kept.push(task);
    }
    this.queue = kept;
  }

  private current(task: Task): boolean {
    return task.generation === (this.generations.get(task.group) ?? 0);
  }

  private pump(): void {
    if (!this.useWorkers) {
      if (this.queue.length > 0) window.setTimeout(() => this.runOnMainThread(), 0);
      return;
    }
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const task = this.queue.shift()!;
      this.busy.set(worker, task);
      worker.postMessage({ id: task.id, cfg: task.cfg });
    }
  }

  private finish(worker: Worker, result: SimResult): void {
    const task = this.busy.get(worker);
    this.busy.delete(worker);
    this.idle.push(worker);
    if (task) task.resolve(this.current(task) ? result : null);
    this.pump();
  }

  private runOnMainThread(): void {
    const task = this.queue.shift();
    if (!task) return;
    task.resolve(this.current(task) ? runSimulation(task.cfg) : null);
    this.pump();
  }

  /** Workers failed to start (old browser, file:// page): requeue their work and carry on without them. */
  private abandonWorkers(): void {
    if (!this.useWorkers) return;
    this.useWorkers = false;
    for (const [worker, task] of this.busy) {
      this.queue.unshift(task);
      worker.terminate();
    }
    for (const worker of this.idle) worker.terminate();
    this.busy.clear();
    this.idle = [];
    this.pump();
  }
}

// ---------------- Summaries across runs ----------------

/** A reading in one year across several runs. */
export interface Stat {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

function summarize(values: number[]): Stat {
  const n = values.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0, n: 0 };
  return { mean: values.reduce((a, b) => a + b, 0) / n, lo: Math.min(...values), hi: Math.max(...values), n };
}

export function statAt(runs: SimResult[], year: number, read: (y: YearResult) => number): Stat {
  return summarize(runs.map((r) => read(r.years[year]!)));
}

/** Reform minus no-reform in the same year, run by run (same seed), then summarized. */
export function pairedDelta(
  runs: SimResult[],
  base: SimResult[],
  year: number,
  read: (y: YearResult) => number,
): Stat & { sameSign: boolean } {
  const deltas = runs.map((r, i) => read(r.years[year]!) - read(base[i]!.years[year]!));
  const s = summarize(deltas);
  return { ...s, sameSign: s.lo > 0 || s.hi < 0 };
}

/** A time series across runs: the mean and the range, year by year. Null where the quantity does not exist. */
export interface Band {
  mean: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
}

export function band(runs: SimResult[], read: (y: YearResult) => number | null): Band {
  const years = runs[0]?.years.length ?? 0;
  const out: Band = { mean: [], lo: [], hi: [] };
  for (let year = 0; year < years; year++) {
    const values: number[] = [];
    for (const r of runs) {
      const v = read(r.years[year]!);
      if (v !== null) values.push(v);
    }
    // A quantity missing in any run (a market that has closed) is treated as missing.
    if (values.length < runs.length || values.length === 0) {
      out.mean.push(null);
      out.lo.push(null);
      out.hi.push(null);
    } else {
      const s = summarize(values);
      out.mean.push(s.mean);
      out.lo.push(s.lo);
      out.hi.push(s.hi);
    }
  }
  return out;
}

/** The mean series only, as plain numbers (for quantities that always exist). */
export function meanSeries(runs: SimResult[], read: (y: YearResult) => number): number[] {
  return band(runs, read).mean.map((v) => v ?? 0);
}
