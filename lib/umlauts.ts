/**
 * Guessing which "ae", "oe", "ue" were meant to be umlauts.
 *
 * Wortopia's board has no umlauts, so its dictionary is written out: ÖFFNEN is
 * stored and played as OEFFNEN. Proposals, though, travel on to spielwoerter.de,
 * which is meant to be a list of German words — and "oeffnen" is not one. Left
 * alone, a player reporting a missing word sends the spelling the game taught
 * them, and a moderator has to guess what they meant.
 *
 * The conversion cannot be done for them, only offered: plenty of ordinary words
 * contain those pairs without any umlaut behind them — Bauer, Steuer, Poesie,
 * Aerobic. So this returns a suggestion to put to the player, never a
 * correction to apply.
 */

/**
 * The word with every ae/oe/ue turned into its umlaut, or null if there is
 * nothing to turn. "qu" is left alone: Quelle and quer are not Qülle and qür.
 */
export function umlautCandidate(word: string): string | null {
  const lower = word.toLowerCase();
  let out = "";
  let changed = false;

  for (let i = 0; i < lower.length; i++) {
    const pair = lower.slice(i, i + 2);
    const isUmlautPair = pair === "ae" || pair === "oe" || pair === "ue";
    const afterQ = pair === "ue" && lower[i - 1] === "q";

    if (isUmlautPair && !afterQ) {
      out += pair === "ae" ? "ä" : pair === "oe" ? "ö" : "ü";
      changed = true;
      i++; // consumed both letters
    } else {
      out += lower[i];
    }
  }

  return changed ? out : null;
}
