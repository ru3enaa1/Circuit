/**
 * The crew's seeds (ADR-0014 G4, ADR-0019): a run's id gives the same draws on every machine, so the
 * same run always puts the crew the same way and moves it the same way (CLAUDE.md, «Reproducible»).
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32 bits: the run's seed, the same on every machine (ADR-0014). */
export function seedOf(text: string): number {
  let hash = FNV_OFFSET;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: a small fixed generator, so a seed always gives the same draws. */
export function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One draw in [0, 1) from a text, for a choice that needs a single draw. */
export function drawOf(text: string): number {
  return generator(seedOf(text))();
}
