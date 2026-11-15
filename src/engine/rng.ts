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

/** Sample an index from a discrete probability vector (assumed to sum to 1). */
export function categorical(rng: Rng, probs: readonly number[]): number {
  const u = rng();
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i]!;
    if (u < cum) return i;
  }
  return probs.length - 1;
}

/** Gumbel(0, scale) draw — used for smooth (logit-style) discrete choice. */
export function gumbel(rng: Rng, scale: number): number {
  let u = 0;
  while (u === 0) u = rng();
  return -scale * Math.log(-Math.log(u));
}
