import { getDb } from "./db.js";
import { fieldContains, fieldToGrid } from "./fieldContains.js";
import { MIN_WORD_LENGTH, SCORES, type GameSize } from "./gameConfig.js";

export type GuessResult =
  | "correct"
  | "duplicate"
  | "not_on_field"
  | "not_in_dictionary"
  | "too_short";

export type ValidateResult = {
  result: GuessResult;
  points: number;
  /**
   * Whether the word exists in the dictionary at all. Only set for
   * `not_on_field`, where the result on its own does not say: a word can miss
   * the board and still be a perfectly good word, or be missing from both. The
   * client needs the difference to decide whether offering "add to dictionary"
   * would make any sense.
   */
  inDictionary?: boolean;
};

/**
 * Validates a guess against the current round state.
 *
 * Check order:
 *   1. too_short  — word shorter than minimum for this size
 *   2. duplicate  — already guessed correctly this round
 *   3. not_on_field / not_in_dictionary — checked against pre-computed validWords set
 *   4. correct — insert into DB and return points
 *
 * The `validWords` set already encodes both "on field" and "in dictionary", so
 * the happy-path (correct) costs zero DB reads. We only hit the path-checker
 * to distinguish not_on_field from not_in_dictionary for invalid words.
 */
export function validateGuess(
  word: string,
  size: number,
  userId: number,
  roundId: number,
  field: string,
  validWords: Set<string>,
): ValidateResult {
  const lower = word.toLowerCase();
  const minLen = MIN_WORD_LENGTH[size as GameSize];

  // 1. Too short
  if (lower.length < minLen) return { result: "too_short", points: 0 };

  // 2. Duplicate — check DB
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT 1 FROM round_guesses
       WHERE round_id = ? AND size = ? AND user_id = ? AND word = ? AND result = 'correct'`,
    )
    .get(roundId, size, userId, lower);
  if (existing) return { result: "duplicate", points: 0 };

  // 3 & 4. Check against pre-computed valid set
  if (!validWords.has(lower)) {
    // Distinguish: is it on the field (but not in dictionary) or not traceable?
    const grid = fieldToGrid(field, size);
    const onField = fieldContains(grid, lower) !== null;
    if (onField) return { result: "not_in_dictionary", points: 0, inDictionary: false };

    // Off the board. Players report missing words by typing them, and typing a
    // word that is not on this board is the only way to do that without wrecking
    // the round they are playing — so look it up, and let them propose it if it
    // is genuinely unknown. A primary-key hit on `words`, on the error path only.
    const known = db.prepare("SELECT 1 FROM words WHERE word = ?").get(lower) !== undefined;
    return { result: "not_on_field", points: 0, inDictionary: known };
  }

  // 5. Correct
  const points = SCORES[lower.length] ?? 0;
  return { result: "correct", points };
}
