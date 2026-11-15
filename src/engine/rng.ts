/**
 * Deterministic seeded PRNG (mulberry32). Every simulation run is fully
 * reproducible from its seed — required for shareable/verifiable student
 * scenarios.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Lognormal with given log-scale parameters. */
export function lognormal(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * normal(rng));
}


// ---- Counter-based draws: one independent random number per (seed, a, b, c). ----
//
// Household shocks and choice noise are looked up by (seed, household, year,
// purpose) instead of being pulled off a shared sequence. A household's luck is
// therefore the same under every policy: changing a lever cannot reshuffle
// anyone's draws, so two policies run on the same seed differ only because of
// the policy ("common random numbers").

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** Uniform in (0, 1), a pure function of its four integer arguments. */
export function hashUniform(seed: number, a: number, b: number, c: number): number {
  let h = mix(mix(mix(seed | 0, a), b), c) ^ 12;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/** Gumbel(0, scale) from a uniform draw. */
export function gumbelFrom(u: number, scale: number): number {
  return -scale * Math.log(-Math.log(u));
}

/** Index from a discrete probability vector, given a uniform draw. */
export function categoricalFrom(u: number, probs: readonly number[]): number {
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i]!;
    if (u < cum) return i;
  }
  return probs.length - 1;
}

/** What each per-household, per-year draw is for. */
export const DRAW = {
  shock: 0,
  noiseUninsured: 1,
  noiseEsi: 2,
  noisePublic: 3,
  /** Individual-market tiers use noiseTier, noiseTier + 1, … in tier order. */
  noiseTier: 4,
} as const;
