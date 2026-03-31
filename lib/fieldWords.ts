import { getDb } from "./db.js";
import { fieldContains, fieldToGrid } from "./fieldContains.js";
import { MIN_WORD_LENGTH, type GameSize } from "./gameConfig.js";

/**
 * Returns all traceable 3-letter starting sequences present in the field.
 * The field is an uppercase flat string; we return lowercase triples.
 */
function fieldPrefixes(field: string, size: number): string[] {
  const seen = new Set<string>();
  for (let y0 = 0; y0 < size; y0++) {
    for (let x0 = 0; x0 < size; x0++) {
      for (let y1 = y0 - 1; y1 <= y0 + 1; y1++) {
        for (let x1 = x0 - 1; x1 <= x0 + 1; x1++) {
          if (x1 < 0 || y1 < 0 || x1 >= size || y1 >= size) continue;
          if (x1 === x0 && y1 === y0) continue;
          for (let y2 = y1 - 1; y2 <= y1 + 1; y2++) {
            for (let x2 = x1 - 1; x2 <= x1 + 1; x2++) {
              if (x2 < 0 || y2 < 0 || x2 >= size || y2 >= size) continue;
              if (x2 === x1 && y2 === y1) continue;
              if (x2 === x0 && y2 === y0) continue;
              seen.add(
                field[y0 * size + x0].toLowerCase() +
                field[y1 * size + x1].toLowerCase() +
                field[y2 * size + x2].toLowerCase(),
              );
            }
          }
        }
      }
    }
  }
  return [...seen];
}

/**
 * Computes the full set of valid words for a given field using a three-stage pipeline:
 *   1. DB query using the first_two index (cuts dictionary to ~2%)
 *   2. Letter-set filter in JS (no extra DB round-trips)
 *   3. fieldContains path check (recursive backtracking on small candidate list)
 */
export function computeValidWords(field: string, size: number): Set<string> {
  const db = getDb();
  const minLen = MIN_WORD_LENGTH[size as GameSize];

  // Stage 1 — prefix index query
  const prefixes = fieldPrefixes(field, size);
  if (prefixes.length === 0) return new Set();

  const placeholders = prefixes.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT word FROM words
       WHERE substr(word, 1, 3) IN (${placeholders})
         AND length(word) >= ?
         AND accepted = 1`,
    )
    .all(...prefixes, minLen) as { word: string }[];

  // Stage 2 — letter-set filter
  const fieldLetters = new Set(field.toLowerCase());
  const stage2 = rows.filter((r) =>
    r.word.split("").every((c) => fieldLetters.has(c)),
  );

  // Stage 3 — full path check
  const grid = fieldToGrid(field, size);
  const valid = new Set<string>();
  for (const { word } of stage2) {
    if (fieldContains(grid, word)) valid.add(word);
  }

  return valid;
}
