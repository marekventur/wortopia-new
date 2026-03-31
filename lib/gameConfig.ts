export const ROUND_DURATION = 210; // total seconds per cycle
export const GAME_DURATION = 180;  // seconds of active gameplay
export const COOLDOWN = 30;        // seconds of cooldown
export const SIZES = [4, 5] as const;
export type GameSize = (typeof SIZES)[number];

export const MIN_WORD_LENGTH: Record<GameSize, number> = { 4: 3, 5: 4 };

// Q has weight 0 — never appears on the field, no QU logic needed
export const DISTRIBUTION: Record<string, number> = {
  A: 21, B: 6,  C: 12, D: 18, E: 48, F: 6,  G: 9,  H: 15,
  I: 27, J: 3,  K: 6,  L: 12, M: 12, N: 30, O: 15, P: 3,
  Q: 0,  R: 21, S: 24, T: 15, U: 21, V: 2,  W: 2,  X: 2,
  Y: 1,  Z: 2,
};

export const SCORES: Record<number, number> = {
  3: 1, 4: 1, 5: 2, 6: 3, 7: 5, 8: 11, 9: 17, 10: 25,
  11: 35, 12: 45, 13: 55, 14: 65, 15: 75, 16: 85,
};
