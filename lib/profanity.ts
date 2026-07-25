/**
 * Display-side profanity masking for user-supplied text (names, chat, word
 * proposals). Nothing is rewritten in the database — this only affects what
 * leaves the server, so a filter change takes effect everywhere at once and
 * nothing is lost if the list turns out to be wrong.
 *
 * German names are compounds without separators ("Mösenlecker",
 * "Karnickelarsch"), so matching has to work on substrings. That over-matches
 * on innocent words — "arsch" sits inside "Barsch" (the fish) and "Marsch",
 * "mose" inside the surname "Moser" — so every match is checked against a list
 * of legitimate words that contain a stem. On a German word game those
 * collisions are not hypothetical.
 */

/** Lowercase, umlaut-folded stems, matched as substrings. */
const STEMS = [
  "arsch", "fick", "fotze", "muschi", "moese", "penis", "schwanzlutsch",
  "wichs", "wixx", "wixer", "hurensohn", "schlampe", "kacke", "titten",
  "sperma", "pisser", "nutte", "bumser", "moepse", "rudelbums", "lustmolch",
  "samenschleuder", "dorfwix", "futtgesicht", "schwuchtel", "missgeburt",
  "vergewaltig", "hitler",
];

/**
 * Innocent words that contain a stem; a match inside one of these is ignored.
 * "Barsch" is a perch and "Marsch" a march — both plausible names on a German
 * word game, and both contain "arsch".
 */
const ALLOWED = ["barsch", "marsch", "harsch"];

const REPLACEMENT = "***";

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Finds stem matches in `folded`, dropping any that sit inside an allowed word.
 * Returns match ranges as [start, end) indices into `folded`.
 */
function findMatches(folded: string): Array<[number, number]> {
  const allowedRanges: Array<[number, number]> = [];
  for (const word of ALLOWED) {
    let i = folded.indexOf(word);
    while (i !== -1) {
      allowedRanges.push([i, i + word.length]);
      i = folded.indexOf(word, i + 1);
    }
  }

  const matches: Array<[number, number]> = [];
  for (const stem of STEMS) {
    let i = folded.indexOf(stem);
    while (i !== -1) {
      const end = i + stem.length;
      const shielded = allowedRanges.some(([s, e]) => i >= s && end <= e);
      if (!shielded) matches.push([i, end]);
      i = folded.indexOf(stem, i + 1);
    }
  }
  return matches;
}

/** True when the text contains something that should not be shown as-is. */
export function isProfane(text: string): boolean {
  if (!text) return false;
  return findMatches(fold(text)).length > 0;
}

/**
 * Masks a display name. Names are short and usually profane as a whole
 * ("Fickschlitten"), so the entire name is replaced rather than patched.
 */
export function maskName(name: string | null | undefined): string {
  if (!name) return name ?? "";
  return isProfane(name) ? REPLACEMENT : name;
}

/**
 * Masks offending words inside a longer text, leaving the rest readable.
 * Folding can change length (ö → oe), so matches are mapped back onto the
 * original string by folding each prefix.
 */
export function maskText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  const folded = fold(text);
  const matches = findMatches(folded);
  if (matches.length === 0) return text;

  // folded index -> original index
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const len = fold(text[i]).length;
    for (let k = 0; k < len; k++) map.push(i);
  }
  map.push(text.length);

  // Widen each match to the whole surrounding word, then splice back to front.
  const isBoundary = (c: string) => !/[\p{L}\p{N}_-]/u.test(c);
  const ranges = matches
    .map(([s, e]) => {
      let start = map[s] ?? 0;
      let end = map[e] ?? text.length;
      while (start > 0 && !isBoundary(text[start - 1])) start--;
      while (end < text.length && !isBoundary(text[end])) end++;
      return [start, end] as [number, number];
    })
    .sort((a, b) => b[0] - a[0]);

  let out = text;
  let lastStart = Infinity;
  for (const [s, e] of ranges) {
    if (e > lastStart) continue; // overlapping range already masked
    out = out.slice(0, s) + REPLACEMENT + out.slice(e);
    lastStart = s;
  }
  return out;
}
