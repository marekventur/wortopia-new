import { getDb } from "./db.js";

const WORDS_URL = "https://spielwoerter.de/api/words.csv";
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

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

export async function syncWords(): Promise<void> {
  console.log("[wordSync] Starting word sync from", WORDS_URL);

  let text: string;
  try {
    const res = await fetch(WORDS_URL);
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

  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    const rawWord = fields[0]?.trim();
    if (!rawWord) continue;

    const normalized = normalizeWord(rawWord);
    if (!normalized) continue;

    // Skip duplicates that arise from normalisation collisions
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const description = fields[2]?.trim() || null;
    rows.push({ word: normalized, description });
  }

  const db = getDb();

  db.transaction(() => {
    db.exec("DELETE FROM words");

    const insert = db.prepare(
      "INSERT OR IGNORE INTO words (word, accepted, description) VALUES (?, 1, ?)"
    );
    for (const { word, description } of rows) {
      insert.run(word, description);
    }

    db.prepare(
      "INSERT INTO word_sync_log (word_count) VALUES (?)"
    ).run(rows.length);
  })();

  console.log(`[wordSync] Synced ${rows.length} words`);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function msUntilNext3am(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function needsImmediateSync(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT synced_at FROM word_sync_log ORDER BY synced_at DESC LIMIT 1")
    .get() as { synced_at: string } | undefined;

  if (!row) return true;

  const lastSync = new Date(row.synced_at);
  return Date.now() - lastSync.getTime() > SYNC_INTERVAL_MS;
}

export function startWordSyncScheduler(): void {
  if (needsImmediateSync()) {
    syncWords().catch(err => console.error("[wordSync] Immediate sync failed:", err));
  }

  // Schedule next run at 3am, then every 24h after that
  const msToNext3am = msUntilNext3am();
  console.log(
    `[wordSync] Next scheduled sync in ${Math.round(msToNext3am / 1000 / 60)} minutes`
  );

  setTimeout(() => {
    syncWords().catch(err => console.error("[wordSync] Scheduled sync failed:", err));
    setInterval(
      () => syncWords().catch(err => console.error("[wordSync] Scheduled sync failed:", err)),
      SYNC_INTERVAL_MS
    );
  }, msToNext3am);
}
