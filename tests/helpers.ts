/** Shared by the scenario tests: every scenario is checked on several seeds, so no test is fitted to one draw. */
import { runSimulation, defaultConfig, reformConfig } from "../src/engine/index.ts";
import type { Policy, SimResult } from "../src/engine/index.ts";

export const SEEDS = [1, 7, 42] as const;
export const POPULATION = 10_000;

/** Runs are cached per (policy object, seed, mode), so tests in one file can share them. */
const cache = new Map<Policy, Map<string, SimResult>>();
function cached(policy: Policy, key: string, make: () => SimResult): SimResult {
  let byKey = cache.get(policy);
  if (!byKey) cache.set(policy, (byKey = new Map()));
  let res = byKey.get(key);
  if (!res) byKey.set(key, (res = make()));
  return res;
}

/** Steady-state run: the policy applies from year 0. */
export function steady(policy: Policy, seed: number, years = 20): SimResult {
  return cached(policy, `steady:${seed}:${years}`, () => runSimulation(defaultConfig(policy, seed, years)));
}

/** Reform run: current law until `reformYear`, then the policy. */
export function reform(policy: Policy, seed: number, years = 20, reformYear = 5): SimResult {
  return cached(policy, `reform:${seed}:${years}:${reformYear}`, () =>
    runSimulation(reformConfig(policy, { seed, years, reformYear })),
  );
}

/** Run `check` once per seed; a failure names the seed. */
export function eachSeed(check: (seed: number) => void): void {
  for (const seed of SEEDS) {
    try {
      check(seed);
    } catch (err) {
      if (err instanceof Error) err.message = `[seed ${seed}] ${err.message}`;
      throw err;
    }
  }
}

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
