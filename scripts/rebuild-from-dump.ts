/**
 * Builds a complete SQLite database from a PostgreSQL dump of the old site.
 *
 * Writes a brand-new file rather than merging into an existing one, so running
 * it twice gives the same result both times — the old site stays the source of
 * truth and anything that accumulated on v2 in between is discarded.
 *
 * Usage:
 *   node --import tsx/esm scripts/rebuild-from-dump.ts <dump> <target.db> [options]
 *
 * Options:
 *   --carry-over <db>   Copy the word list and guest-id counter from this
 *                       existing database (normally the live prod one). Without
 *                       it the new database starts with no words and the game
 *                       has nothing to score until the next sync.
 *   --drop-email <addr> Skip every account on this address. Repeatable.
 *   --no-leaderboard    Skip building the leaderboard cache.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith("--"));
const DUMP_FILE = positional[0];
const TARGET_DB = positional[1];

function optionValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

const CARRY_OVER_DB = optionValues("--carry-over")[0] ?? null;
const DROP_EMAILS = new Set(optionValues("--drop-email").map(e => e.toLowerCase().trim()));
const BUILD_LEADERBOARD = !argv.includes("--no-leaderboard");

if (!DUMP_FILE || !TARGET_DB) {
  console.error("Usage: rebuild-from-dump.ts <dump> <target.db> [--carry-over <db>] [--drop-email <addr>]");
  process.exit(2);
}
if (!fs.existsSync(DUMP_FILE)) {
  console.error(`Dump not found: ${DUMP_FILE}`);
  process.exit(2);
}
if (fs.existsSync(TARGET_DB)) {
  console.error(`Target already exists, refusing to overwrite: ${TARGET_DB}`);
  process.exit(2);
}

// The app's own schema module builds the target, so the result can never drift
// from what the running server expects.
process.env.DATABASE_PATH = path.resolve(TARGET_DB);

const { getDb } = await import("../lib/db.js");
const Database = (await import("better-sqlite3")).default;

// ---------------------------------------------------------------------------
// Dump parsing
// ---------------------------------------------------------------------------

/** "2016-03-15 21:03:31.999291" -> "2016-03-15T21:03:31.999Z" */
function pgTs(ts: string): string {
  return new Date(ts.replace(" ", "T") + "Z").toISOString();
}

/** Pulls one table's COPY rows out of the dump as arrays of fields. */
function extractCopyRows(table: string): (string | null)[][] {
  const result = spawnSync("pg_restore", ["-f", "-", "-a", "-t", table, DUMP_FILE], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pg_restore failed for ${table}: ${result.stderr}`);

  const rows: (string | null)[][] = [];
  let inCopy = false;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("COPY public.")) { inCopy = true; continue; }
    if (line === "\\.") { inCopy = false; continue; }
    if (!inCopy || line.trim() === "") continue;
    rows.push(line.split("\t").map(f => (f === "\\N" ? null : f)));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const started = Date.now();
console.log(`Dump   : ${DUMP_FILE}`);
console.log(`Target : ${TARGET_DB}`);
if (CARRY_OVER_DB) console.log(`Carry  : ${CARRY_OVER_DB}`);
if (DROP_EMAILS.size) console.log(`Drop   : ${[...DROP_EMAILS].join(", ")}`);
console.log();

const db = getDb(); // creates the file and applies the full app schema
db.pragma("foreign_keys = OFF"); // bulk load; turned back on at the end

// --- which accounts are we dropping? ---------------------------------------
// Resolved from the dump's own user_emails so --drop-email covers every
// account on that address, not just the one that happens to be first.
const droppedUserIds = new Set<number>();
if (DROP_EMAILS.size) {
  for (const [user_id, email] of extractCopyRows("user_emails")) {
    if (email && DROP_EMAILS.has(email.toLowerCase().trim())) {
      droppedUserIds.add(parseInt(user_id!, 10));
    }
  }
  console.log(`Dropping ${droppedUserIds.size} account(s) by email.\n`);
}

// --- users ------------------------------------------------------------------
console.log("users...");
const keptUserIds = new Set<number>();
{
  const rows = extractCopyRows("users");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO users (id, name, pw_hash, team, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  let inserted = 0, skipped = 0, dropped = 0;

  db.transaction(() => {
    for (const [id, name, pw_hash, team, created_at] of rows) {
      const uid = parseInt(id!, 10);
      if (droppedUserIds.has(uid)) { dropped++; continue; }

      // The old schema's CHECK constraints are looser than the new one's, so
      // validate here instead of letting the insert throw.
      if (!name || name.length < 4 || name.length > 15) { skipped++; continue; }
      if (name.toLowerCase().startsWith("guest_")) { skipped++; continue; }
      if (team !== null && (team.length < 5 || team.length > 12)) {
        // Keep the account, lose the unusable team.
        insert.run(uid, name, pw_hash ?? null, null, pgTs(created_at!));
        keptUserIds.add(uid);
        inserted++;
        continue;
      }
      insert.run(uid, name, pw_hash ?? null, team ?? null, pgTs(created_at!));
      keptUserIds.add(uid);
      inserted++;
    }
  })();

  // Names are UNIQUE COLLATE NOCASE here but case-sensitive citext in PG, so a
  // pair differing only by case loses one side to INSERT OR IGNORE.
  const actual = (db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
  const lostToCollision = inserted - actual;
  console.log(`  ${actual} imported, ${skipped} invalid, ${dropped} dropped` +
    (lostToCollision > 0 ? `, ${lostToCollision} lost to case-insensitive name collision` : ""));
  for (const id of [...keptUserIds]) {
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) keptUserIds.delete(id);
  }
}

// --- user_emails ------------------------------------------------------------
console.log("user_emails...");
{
  const rows = extractCopyRows("user_emails");
  const insert = db.prepare("INSERT OR IGNORE INTO user_emails (user_id, email) VALUES (?, ?)");
  let inserted = 0;
  db.transaction(() => {
    for (const [user_id, email] of rows) {
      const uid = parseInt(user_id!, 10);
      if (!keptUserIds.has(uid) || !email) continue;
      insert.run(uid, email.toLowerCase().trim());
      inserted++;
    }
  })();
  const shared = (db.prepare(
    "SELECT COUNT(*) n FROM (SELECT email FROM user_emails GROUP BY email HAVING COUNT(*) > 1)",
  ).get() as { n: number }).n;
  console.log(`  ${inserted} imported, ${shared} address(es) shared by several accounts`);
}

// --- user_results -----------------------------------------------------------
console.log("user_results (a few million rows, takes a moment)...");
{
  const rows = extractCopyRows("user_results");
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_results
       (user_id, round_id, finished, words, points, max_words, max_points, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0, skipped = 0;
  db.transaction(() => {
    for (const [id, user_id, finished, words, points, max_words, max_points, size] of rows) {
      const uid = parseInt(user_id!, 10);
      if (!keptUserIds.has(uid)) { skipped++; continue; }
      // Negative round ids: the old ids are unrelated to the new epoch-based
      // round numbering and must not collide with it.
      insert.run(
        uid, -parseInt(id!, 10), pgTs(finished!),
        parseInt(words!, 10), parseInt(points!, 10),
        parseInt(max_words!, 10), parseInt(max_points!, 10), parseInt(size!, 10),
      );
      inserted++;
    }
  })();
  console.log(`  ${inserted} imported, ${skipped} skipped (account not imported)`);
}

// --- carry-over from the live database --------------------------------------
if (CARRY_OVER_DB) {
  console.log("carrying over from the live database...");
  const live = new Database(CARRY_OVER_DB, { readonly: true });

  // The word list belongs to spielwoerter.de, not to this dump. Copying it
  // means the game can score immediately instead of waiting for the 3am sync.
  const words = live.prepare("SELECT word, accepted, description FROM words").all() as
    { word: string; accepted: number; description: string | null }[];
  const insWord = db.prepare(
    "INSERT OR IGNORE INTO words (word, accepted, description) VALUES (?, ?, ?)",
  );
  db.transaction(() => { for (const w of words) insWord.run(w.word, w.accepted, w.description); })();

  const syncLog = live.prepare("SELECT synced_at, word_count FROM word_sync_log").all() as
    { synced_at: string; word_count: number }[];
  const insSync = db.prepare("INSERT INTO word_sync_log (synced_at, word_count) VALUES (?, ?)");
  db.transaction(() => { for (const s of syncLog) insSync.run(s.synced_at, s.word_count); })();

  // Guest ids already live in visitors' cookies; restarting the counter would
  // hand the same id to somebody else.
  let nextGuest = 100001;
  try {
    const row = live.prepare("SELECT next_id FROM guest_id_counter WHERE id = 1").get() as
      { next_id: number } | undefined;
    if (row) nextGuest = Math.max(nextGuest, row.next_id);
  } catch { /* older database without the counter */ }
  db.prepare("UPDATE guest_id_counter SET next_id = ? WHERE id = 1").run(nextGuest);

  live.close();
  console.log(`  ${words.length} words, ${syncLog.length} sync log entries, guest counter at ${nextGuest}`);
}

// --- leaderboard ------------------------------------------------------------
if (BUILD_LEADERBOARD) {
  console.log("leaderboard cache...");
  const { refreshLeaderboardCache } = await import("../lib/leaderboardCache.js");
  refreshLeaderboardCache();
}

db.pragma("foreign_keys = ON");
const integrity = db.pragma("integrity_check", { simple: true });
if (integrity !== "ok") {
  console.error(`\nintegrity_check failed: ${integrity}`);
  process.exit(1);
}
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

console.log(`\nBuilt ${TARGET_DB} in ${Math.round((Date.now() - started) / 1000)}s — integrity ok.`);
