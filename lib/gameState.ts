import { ROUND_DURATION, GAME_DURATION, SCORES } from "./gameConfig.js";

export type RoundPhase = "ongoing" | "cooldown";

/** Monotonically increasing round counter — changes every ROUND_DURATION seconds. */
export function getRoundId(): number {
  return Math.floor(Date.now() / 1000 / ROUND_DURATION);
}

/** How many seconds have elapsed within the current round cycle (0‥209). */
export function getRoundTime(): number {
  return Math.floor(Date.now() / 1000) % ROUND_DURATION;
}

export function getRoundPhase(roundTime: number): RoundPhase {
  return roundTime < GAME_DURATION ? "ongoing" : "cooldown";
}

export function getSecondsRemaining(roundTime: number): number {
  if (roundTime < GAME_DURATION) return GAME_DURATION - roundTime;
  return ROUND_DURATION - roundTime;
}

export function getScore(wordLength: number): number {
  return SCORES[wordLength] ?? SCORES[Math.max(...Object.keys(SCORES).map(Number))] ?? 0;
}

// ---------------------------------------------------------------------------
// Results builder
// ---------------------------------------------------------------------------

export type GuessRow = {
  word: string;
  result: string;
  points: number;
  username: string;
  user_id: number;
};

export type PlayerResult = {
  userId: number;
  username: string;
  words: number;
  points: number;
};

export type RoundResults = {
  players: PlayerResult[];
  /** All correct words found by anyone, with who found them */
  words: { word: string; username: string }[];
};

/**
 * Aggregates a list of guess rows into a results object.
 * If `forUserId` is supplied, only that user's data is included in `words`
 * (but all players appear in the leaderboard).
 */
export function buildResults(
  guesses: GuessRow[],
  forUserId?: number,
): RoundResults {
  const playerMap = new Map<number, PlayerResult>();

  for (const g of guesses) {
    if (g.result !== "correct") continue;
    if (!playerMap.has(g.user_id)) {
      playerMap.set(g.user_id, {
        userId: g.user_id,
        username: g.username,
        words: 0,
        points: 0,
      });
    }
    const p = playerMap.get(g.user_id)!;
    p.words++;
    p.points += g.points;
  }

  const players = [...playerMap.values()].sort((a, b) => b.points - a.points);

  const words =
    forUserId !== undefined
      ? guesses
          .filter((g) => g.result === "correct" && g.user_id === forUserId)
          .map((g) => ({ word: g.word, username: g.username }))
      : guesses
          .filter((g) => g.result === "correct")
          .map((g) => ({ word: g.word, username: g.username }));

  return { players, words };
}
