import { getDb } from "./db.js";

/**
 * Translating between the word the game plays and the word the list holds.
 *
 * Wortopia's board has no umlauts, so the dictionary is flattened on the way
 * in: spielwoerter.de lists "öffnen", the game stores and plays "oeffnen", and
 * that is the spelling every player sees and reports. Sending it straight back
 * asks the word list to change a word it does not have.
 *
 * It used to be guessed — turn every ae/oe/ue back into an umlaut and hope —
 * which is wrong about as often as it is right ("Steuer", "Bauer", "Poesie")
 * and cannot tell you that "abbeisse" and "abbeiße" are *both* listed. Since
 * the sync now records the spellings it was given, nothing has to be guessed:
 * 33,901 of the 194,345 words the game plays are listed under a spelling that
 * is not the one on the board.
 */

/** How a listed spelling becomes a word the board can hold. */
export function normalizeWord(word: string): string {
  const lower = word.toLowerCase();
  // Five out of six words have nothing to replace, and this runs 195,000 times
  // per sync — so look before doing the work.
  if (!/[äöüß]/.test(lower)) return lower;

  return lower
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Every spelling under which spielwoerter.de lists this word, or an empty array
 * if it does not list it at all.
 *
 * Takes either spelling: a player may have been offered the umlaut form before
 * proposing, so both "buessi" and "büßi" have to find the same entry.
 *
 * More than one spelling means the word is listed twice over, and the game will
 * keep playing it until every one of them is gone — a removal has to name them
 * all. Falls back to the flattened spelling for a word that is in the list but
 * has no recorded spelling yet, which is how a database behaves between the
 * migration and its first sync.
 */
export function listedSpellings(word: string): string[] {
  const key = normalizeWord(word);
  const db = getDb();

  const rows = db
    .prepare("SELECT spelling FROM word_spellings WHERE word = ? ORDER BY spelling")
    .all(key) as { spelling: string }[];
  if (rows.length > 0) return rows.map((r) => r.spelling);

  const listed = db.prepare("SELECT 1 FROM words WHERE word = ?").get(key);
  return listed ? [key] : [];
}
