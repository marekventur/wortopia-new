import { ROUND_DURATION, GAME_DURATION, SCORES } from "./gameConfig.js";
import { getDb } from "./db.js";
import { maskName } from "./profanity.js";
import type { WordDetail, LastRoundResults, TeamResult } from "./gameTypes.js";

export type { WordDetail, LastRoundResults, TeamResult };

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
  team: string | null;
};

export type PlayerResult = {
  userId: number;
  username: string;
  team: string | null;
  words: number;
  points: number;
};

export type RoundResults = {
  players: PlayerResult[];
  teams: TeamResult[];
  /** All correct words found by anyone, with who found them */
  words: { word: string; username: string }[];
};

/**
 * Players and teams from one round's guesses.
 *
 * A team scores the *union* of the words its members found, not the sum of
 * their points: if both partners find HAUS it counts once. That is how the old
 * site scored teams and it is the whole point of playing as one — the number
 * answers "what did we cover together", so covering the same ground twice does
 * not flatter it.
 *
 * A team only appears once at least two of its members are in the round.
 * Someone playing alone is just a player, with no team shown, because a team of
 * one is a scoreboard entry that duplicates the row beneath it.
 */
function aggregate(guesses: GuessRow[]): { players: PlayerResult[]; teams: TeamResult[] } {
  const playerMap = new Map<number, PlayerResult>();
  // Keyed case-insensitively: users.team is COLLATE NOCASE, so "Watzmann" and
  // "watzmann" are one team in the database and must be one here too.
  const teamMap = new Map<
    string,
    { name: string; members: Set<number>; words: Map<string, number> }
  >();

  for (const g of guesses) {
    if (g.result !== "correct") continue;

    if (!playerMap.has(g.user_id)) {
      playerMap.set(g.user_id, {
        userId: g.user_id,
        username: maskName(g.username),
        team: maskName(g.team),
        words: 0,
        points: 0,
      });
    }
    const p = playerMap.get(g.user_id)!;
    p.words++;
    p.points += g.points;

    if (!g.team) continue;
    const key = g.team.toLowerCase();
    let team = teamMap.get(key);
    if (!team) {
      team = { name: maskName(g.team), members: new Set(), words: new Map() };
      teamMap.set(key, team);
    }
    team.members.add(g.user_id);
    // First finder wins the entry; the score depends on the word, not on who
    // typed it, so a second finder adds nothing.
    const word = g.word.toLowerCase();
    if (!team.words.has(word)) team.words.set(word, g.points);
  }

  const byPoints = (a: { points: number }, b: { points: number }) => b.points - a.points;

  const teams: TeamResult[] = [...teamMap.values()]
    .filter((t) => t.members.size > 1)
    .map((t) => ({
      name: t.name,
      memberIds: [...t.members],
      words: t.words.size,
      points: [...t.words.values()].reduce((sum, n) => sum + n, 0),
    }))
    .sort(byPoints);

  return { players: [...playerMap.values()].sort(byPoints), teams };
}

/**
 * Aggregates a list of guess rows into a results object.
 * If `forUserId` is supplied, only that user's data is included in `words`
 * (but all players appear in the leaderboard).
 */
export function buildResults(
  guesses: GuessRow[],
  forUserId?: number,
): RoundResults {
  const { players, teams } = aggregate(guesses);

  const words =
    forUserId !== undefined
      ? guesses
          .filter((g) => g.result === "correct" && g.user_id === forUserId)
          .map((g) => ({ word: g.word, username: maskName(g.username) }))
      : guesses
          .filter((g) => g.result === "correct")
          .map((g) => ({ word: g.word, username: maskName(g.username) }));

  return { players, teams, words };
}

/**
 * Persists per-user results for a finished round into user_results.
 * Only registered users (positive user_id) are recorded.
 * Safe to call multiple times — skips users already recorded for this round.
 */
export function persistRoundResults(
  roundId: number,
  size: number,
  guesses: GuessRow[],
  validWords: Set<string>,
): void {
  const db = getDb();

  // Max possible score for this field
  const maxWords = validWords.size;
  const maxPoints = [...validWords].reduce((sum, w) => sum + getScore(w.length), 0);

  // Aggregate per registered user
  const userMap = new Map<number, { words: number; points: number }>();
  for (const g of guesses) {
    if (g.user_id <= 0 || g.result !== "correct") continue;
    if (!userMap.has(g.user_id)) userMap.set(g.user_id, { words: 0, points: 0 });
    const u = userMap.get(g.user_id)!;
    u.words++;
    u.points += g.points;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_results (user_id, round_id, words, points, max_words, max_points, size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const [userId, { words, points }] of userMap) {
      insert.run(userId, roundId, words, points, maxWords, maxPoints, size);
    }
  });
  run();

  console.log(`[gameState] Persisted results for round ${roundId} size ${size}: ${userMap.size} users`);
}

/**
 * Builds the full word list for a completed round.
 * Includes ALL valid words (not just guessed ones), with description, points,
 * and the list of user IDs who guessed each word correctly.
 * Sorted most-guessed → least-guessed, then alphabetically.
 */
export function buildLastRoundResults(
  guesses: GuessRow[],
  validWords: Set<string>,
): LastRoundResults {
  // ── Leaderboard (same as buildResults) ────────────────────────────────────
  const { players, teams } = aggregate(guesses);

  // ── Per-word guess map: word → userId[] ────────────────────────────────────
  const guessedByMap = new Map<string, number[]>();
  for (const g of guesses) {
    if (g.result !== "correct") continue;
    const key = g.word.toLowerCase();
    if (!guessedByMap.has(key)) guessedByMap.set(key, []);
    guessedByMap.get(key)!.push(g.user_id);
  }

  // ── Fetch descriptions for all valid words ─────────────────────────────────
  const wordArray = [...validWords];
  const descriptions = new Map<string, string | null>();
  if (wordArray.length > 0) {
    const placeholders = wordArray.map(() => "?").join(",");
    const rows = getDb()
      .prepare(`SELECT word, description FROM words WHERE word IN (${placeholders})`)
      .all(...wordArray) as { word: string; description: string | null }[];
    for (const row of rows) descriptions.set(row.word, row.description ?? null);
  }

  // ── Build WordDetail list ──────────────────────────────────────────────────
  const words: WordDetail[] = wordArray.map((word) => ({
    word,
    description: descriptions.get(word) ?? null,
    points: getScore(word.length),
    guessedBy: guessedByMap.get(word) ?? [],
  }));

  // Most-guessed first, then alphabetically
  words.sort(
    (a, b) => b.guessedBy.length - a.guessedBy.length || a.word.localeCompare(b.word),
  );

  return { players, teams, words };
}
