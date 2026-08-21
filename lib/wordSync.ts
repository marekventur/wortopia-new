import { getDb } from "./db.js";
import { normalizeWord } from "./wordSpellings.js";

const WORDS_URL = "https://spielwoerter.de/api/words.csv";
const VERSION_URL = "https://spielwoerter.de/api/latest-update";
const FETCH_TIMEOUT_MS = 60_000;

/**
 * How often to ask whether the list has moved. The question is a few bytes and
 * cached for a minute at the far end; the answer is what decides whether the
 * six megabytes are worth pulling.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Pull anyway if the list has said nothing for this long — a version string that
 * stops moving must not be able to freeze the dictionary. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A sync replaces the whole dictionary, so a truncated response would silently
 * break the game. The list only ever shrinks slowly through moderation on
 * spielwoerter.de (~100 words/day), so anything below this fraction of the
 * current count means the feed is broken, not that words were removed.
 */
const MIN_SHRINK_RATIO = 0.9;

/** Below this, treat the response as broken regardless of what's in the DB. */
const MIN_ABSOLUTE_WORDS = 1000;

// ---------------------------------------------------------------------------
// Minimal CSV parser (handles double-quoted fields with embedded commas)
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

/**
 * Let the game have the thread back.
 *
 * better-sqlite3 is synchronous and this process is the game: every millisecond
 * spent here is a millisecond nobody's guess is being scored. Rewriting the
 * whole dictionary took 3.8 seconds of that in one unbroken block, which was
 * survivable at 03:00 and is not survivable now the list is pulled whenever a
 * moderator approves something. So the work is done in slices, with the loop
 * free in between: the same total, none of it noticeable.
 */
const SLICE = 2_000;
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

type WordRow = { word: string; description: string | null };
type Listing = { rows: WordRow[]; spellings: { word: string; spelling: string }[] };

/**
 * The list as spielwoerter.de sends it, parsed as it arrives.
 *
 * Read in chunks rather than as one string: the response is twelve megabytes,
 * and decoding that in a single call blocks the game for about a tenth of a
 * second on its own — more than everything else here put together. A chunk is
 * a few hundred lines, and the read between chunks is a natural breath.
 */
async function fetchList(): Promise<Listing> {
  const res = await fetch(WORDS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error("no response body");

  const rows: WordRow[] = [];
  const spellings: { word: string; spelling: string }[] = [];
  const seen = new Set<string>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let lineNo = 0;

  const take = (line: string) => {
    // The header row names the columns and is not a word.
    if (lineNo++ === 0) return;
    if (line.trim() === "") return;

    const fields = parseCSVLine(line);
    const rawWord = fields[0]?.trim();
    if (!rawWord) return;

    const normalized = normalizeWord(rawWord);
    if (!normalized) return;

    // Every spelling the list uses, keyed by the word the board can hold. The
    // collisions used to be dropped on the floor; they are the whole point
    // here, because a word listed as both "abbeisse" and "abbeiße" stays
    // playable until both are gone, and only this table can say so.
    spellings.push({ word: normalized, spelling: rawWord.toLowerCase() });

    // One playable word per spelling collision: the board cannot tell them
    // apart, so the first description wins.
    if (seen.has(normalized)) return;
    seen.add(normalized);

    rows.push({ word: normalized, description: fields[2]?.trim() || null });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    carry += decoder.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? ""; // the last one may be half a line
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && i % SLICE === 0) await breathe();
      take(lines[i]);
    }
  }
  carry += decoder.decode();
  if (carry !== "") take(carry);

  return { rows, spellings };
}

/**
 * What the game currently holds, in slices.
 *
 * Paged by key rather than iterated: an open better-sqlite3 iterator locks the
 * connection, and handing the thread back mid-iteration would make the next
 * chat message or score write throw.
 */
async function readCurrent(): Promise<{ words: Map<string, string | null>; spellings: Set<string> }> {
  const db = getDb();
  const words = new Map<string, string | null>();
  const spellings = new Set<string>();

  const wordPage = db.prepare(
    "SELECT word, description FROM words WHERE word > ? ORDER BY word LIMIT ?",
  );
  for (let after = ""; ; ) {
    const page = wordPage.all(after, SLICE) as WordRow[];
    if (page.length === 0) break;
    for (const row of page) words.set(row.word, row.description);
    after = page[page.length - 1].word;
    await breathe();
  }

  const spellingPage = db.prepare(
    "SELECT word, spelling FROM word_spellings WHERE (word, spelling) > (?, ?) ORDER BY word, spelling LIMIT ?",
  );
  for (let afterWord = "", afterSpelling = ""; ; ) {
    const page = spellingPage.all(afterWord, afterSpelling, SLICE) as {
      word: string;
      spelling: string;
    }[];
    if (page.length === 0) break;
    for (const row of page) spellings.add(`${row.word}\u0000${row.spelling}`);
    afterWord = page[page.length - 1].word;
    afterSpelling = page[page.length - 1].spelling;
    await breathe();
  }

  return { words, spellings };
}

export async function syncWords(version: string | null = null): Promise<void> {
  console.log("[wordSync] Starting word sync from", WORDS_URL);

  let rows: WordRow[];
  let spellings: { word: string; spelling: string }[];
  try {
    ({ rows, spellings } = await fetchList());
  } catch (err) {
    console.error("[wordSync] Fetch failed, skipping sync:", err);
    return;
  }

  const db = getDb();
  const held = await readCurrent();

  // Sanity check before touching the existing dictionary. The count comes from
  // what was just read rather than a COUNT(*), which is a single statement over
  // 194,000 rows and cannot be sliced — on a cold page cache it was the one
  // thing here that still blocked the game for a tenth of a second.
  const current = held.words.size;
  const floor = Math.max(MIN_ABSOLUTE_WORDS, Math.floor(current * MIN_SHRINK_RATIO));
  if (current > 0 && rows.length < floor) {
    console.error(
      `[wordSync] Refusing to sync: got ${rows.length} words but have ${current} ` +
        `(minimum ${floor}). Feed looks truncated — keeping the current word list.`,
    );
    return;
  }

  // ── What actually changed ─────────────────────────────────────────────────
  // Usually a handful of words: the list moves when a moderator decides
  // something, not by the thousand. Writing only the difference is what keeps
  // the transaction — the one part that cannot be sliced, because the game must
  // never see half a dictionary — down to a few milliseconds.
  const upserts: WordRow[] = [];
  const wanted = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    if (i % SLICE === 0) await breathe();
    const row = rows[i];
    wanted.add(row.word);
    if (!held.words.has(row.word) || held.words.get(row.word) !== row.description) {
      upserts.push(row);
    }
  }

  const removals: string[] = [];
  let seenWords = 0;
  for (const word of held.words.keys()) {
    if (++seenWords % SLICE === 0) await breathe();
    if (!wanted.has(word)) removals.push(word);
  }

  const spellingInserts: { word: string; spelling: string }[] = [];
  const wantedSpellings = new Set<string>();
  for (let i = 0; i < spellings.length; i++) {
    if (i % SLICE === 0) await breathe();
    const key = `${spellings[i].word}\u0000${spellings[i].spelling}`;
    if (wantedSpellings.has(key)) continue; // the list may repeat a row
    wantedSpellings.add(key);
    if (!held.spellings.has(key)) spellingInserts.push(spellings[i]);
  }

  const spellingRemovals: string[] = [];
  let seenSpellings = 0;
  for (const key of held.spellings) {
    if (++seenSpellings % SLICE === 0) await breathe();
    if (!wantedSpellings.has(key)) spellingRemovals.push(key);
  }

  const touched =
    upserts.length + removals.length + spellingInserts.length + spellingRemovals.length;

  db.transaction(() => {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO words (word, accepted, description) VALUES (?, 1, ?)",
    );
    for (const { word, description } of upserts) insert.run(word, description);

    const remove = db.prepare("DELETE FROM words WHERE word = ?");
    for (const word of removals) remove.run(word);

    const insertSpelling = db.prepare(
      "INSERT OR IGNORE INTO word_spellings (word, spelling) VALUES (?, ?)",
    );
    for (const { word, spelling } of spellingInserts) insertSpelling.run(word, spelling);

    const removeSpelling = db.prepare(
      "DELETE FROM word_spellings WHERE word = ? AND spelling = ?",
    );
    for (const key of spellingRemovals) {
      const [word, spelling] = key.split("\u0000");
      removeSpelling.run(word, spelling);
    }

    db.prepare("INSERT INTO word_sync_log (word_count, version) VALUES (?, ?)").run(
      rows.length,
      version,
    );
  })();

  console.log(
    `[wordSync] Synced ${rows.length} words (${spellings.length} spellings)` +
      (version ? ` at ${version}` : "") +
      `: ${upserts.length} changed, ${removals.length} gone` +
      (touched === 0 ? " — nothing to write" : ""),
  );
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * The list's version string, or null if it could not be asked.
 *
 * Null is deliberately not "unchanged": it means the question failed, and the
 * age check below is what decides whether to pull anyway.
 */
async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = (await res.json()) as { version?: string };
    return version ?? null;
  } catch (err) {
    console.error("[wordSync] Could not read the list version:", err);
    return null;
  }
}

function lastSync(): { synced_at: string; version: string | null } | undefined {
  return getDb()
    .prepare("SELECT synced_at, version FROM word_sync_log ORDER BY synced_at DESC LIMIT 1")
    .get() as { synced_at: string; version: string | null } | undefined;
}

/**
 * Pull the list if it has changed, or if it has been quiet for too long.
 *
 * The word list only moves when a moderator decides something, which is a
 * handful of times a day — so asking costs a few bytes and almost always ends
 * here. What it buys is the wait: a word approved at 09:00 used to become
 * playable at 03:00 the next morning, and players read that as their reports
 * being ignored.
 */
export async function pollForChanges(): Promise<void> {
  const last = lastSync();
  const stale = !last || Date.now() - new Date(last.synced_at).getTime() > MAX_AGE_MS;
  const version = await fetchVersion();

  if (stale) {
    await syncWords(version);
    return;
  }
  if (version === null || version === last.version) return;

  console.log(`[wordSync] The list moved (${last.version ?? "unknown"} → ${version})`);
  await syncWords(version);
}

export function startWordSyncScheduler(): void {
  const tick = () =>
    pollForChanges().catch(err => console.error("[wordSync] Sync check failed:", err));

  tick();
  setInterval(tick, POLL_INTERVAL_MS);
  console.log(
    `[wordSync] Watching ${VERSION_URL} every ${POLL_INTERVAL_MS / 60_000} minutes`,
  );
}
