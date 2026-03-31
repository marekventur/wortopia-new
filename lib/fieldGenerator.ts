import { DISTRIBUTION } from "./gameConfig.js";

// Linear Congruential Generator — Numerical Recipes constants.
// Good enough for non-cryptographic shuffling; no external dependency.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildLetterPool(): string[] {
  const pool: string[] = [];
  for (const [letter, count] of Object.entries(DISTRIBUTION)) {
    for (let i = 0; i < count; i++) pool.push(letter);
  }
  return pool;
}

/**
 * Generates a field of `size²` uppercase letters for the given round.
 * Seed is `roundId * 10 + size` so 4×4 and 5×5 always differ.
 * Deterministic: same roundId → same field even after server restart.
 */
export function generateField(roundId: number, size: number): string {
  const seed = roundId * 10 + size;
  const rand = lcg(seed);

  const pool = buildLetterPool();

  // Fisher-Yates shuffle — seeded
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, size * size).join("");
}
