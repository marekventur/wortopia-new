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

export async function syncWords(version: string | null = null): Promise<void> {
  console.log("[wordSync] Starting word sync from", WORDS_URL);

  let text: string;
  try {
    const res = await fetch(WORDS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error("[wordSync] Fetch failed, skipping sync:", err);
    return;
  }

  const lines = text.split("\n");
  // Skip header row
  const dataLines = lines.slice(1).filter(l => l.trim() !== "");

  type WordRow = { word: string; description: string | null };
  const rows: WordRow[] = [];
  const seen = new Set<string>();
  // Every spelling the list uses, keyed by the word the board can hold. The
  // collisions used to be dropped on the floor; they are the whole point here,
  // because a word listed as both "abbeisse" and "abbeiße" stays playable until
  // both are gone, and only this table can say so.
  const spellings: { word: string; spelling: string }[] = [];

  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    const rawWord = fields[0]?.trim();
    if (!rawWord) continue;

    const normalized = normalizeWord(rawWord);
    if (!normalized) continue;

    spellings.push({ word: normalized, spelling: rawWord.toLowerCase() });

    // One playable word per spelling collision: the board cannot tell them
    // apart, so the first description wins.
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const description = fields[2]?.trim() || null;
    rows.push({ word: normalized, description });
  }

  const db = getDb();

  // Sanity check before destroying the existing dictionary.
  const { current } = db.prepare("SELECT COUNT(*) AS current FROM words").get() as {
    current: number;
  };
  const floor = Math.max(MIN_ABSOLUTE_WORDS, Math.floor(current * MIN_SHRINK_RATIO));
  if (current > 0 && rows.length < floor) {
    console.error(
      `[wordSync] Refusing to sync: got ${rows.length} words but have ${current} ` +
        `(minimum ${floor}). Feed looks truncated — keeping the current word list.`,
    );
    return;
  }

  db.transaction(() => {
    db.exec("DELETE FROM words");
    db.exec("DELETE FROM word_spellings");

    const insert = db.prepare(
      "INSERT OR IGNORE INTO words (word, accepted, description) VALUES (?, 1, ?)"
    );
    for (const { word, description } of rows) {
      insert.run(word, description);
    }

    const insertSpelling = db.prepare(
      "INSERT OR IGNORE INTO word_spellings (word, spelling) VALUES (?, ?)"
    );
    for (const { word, spelling } of spellings) {
      insertSpelling.run(word, spelling);
    }

    db.prepare(
      "INSERT INTO word_sync_log (word_count, version) VALUES (?, ?)"
    ).run(rows.length, version);
  })();

  console.log(
    `[wordSync] Synced ${rows.length} words (${spellings.length} spellings)` +
      (version ? ` at ${version}` : ""),
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
