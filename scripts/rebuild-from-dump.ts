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
 *   --merge-v2 <db>     Also bring across the games played on v2 itself. See
 *                       mergeV2() for how accounts are matched up.
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
const MERGE_V2_DB = optionValues("--merge-v2")[0] ?? null;
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

/**
 * Pulls one table's COPY rows out of the dump as arrays of fields.
 *
 * Only for the small tables. user_results has millions of rows and holding
 * them all at once is what the OOM killer objects to — use streamCopyRows.
 */
function extractCopyRows(table: string): (string | null)[][] {
  const result = spawnSync("pg_restore", ["-f", "-", "-a", "-t", table, DUMP_FILE], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pg_restore failed for ${table}: ${result.stderr}`);

  const rows: (string | null)[][] = [];
  for (const line of result.stdout.split("\n")) {
    const fields = parseCopyLine(line);
    if (fields) rows.push(fields);
  }
  return rows;
}

/** State machine shared by both readers: null means "not a data line". */
let inCopy = false;
function parseCopyLine(line: string): (string | null)[] | null {
  if (line.startsWith("COPY public.")) { inCopy = true; return null; }
  if (line === "\\.") { inCopy = false; return null; }
  if (!inCopy || line.trim() === "") return null;
  return line.split("\t").map(f => (f === "\\N" ? null : f));
}

/**
 * Streams one table's COPY rows, handing each to `onRow` as it arrives.
 *
 * pg_restore writes faster than we insert, so its stdout is paused while a
 * batch is committed — otherwise the backlog just moves from pg_restore's
 * buffer into ours and the memory problem comes back.
 */
async function streamCopyRows(
  table: string,
  onBatch: (rows: (string | null)[][]) => void,
  batchSize = 50_000,
): Promise<void> {
  const { spawn } = await import("child_process");
  const child = spawn("pg_restore", ["-f", "-", "-a", "-t", table, DUMP_FILE]);

  inCopy = false;
  let pending = "";
  let batch: (string | null)[][] = [];
  let stderr = "";
  child.stderr.on("data", d => { stderr += d.toString(); });

  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let nl: number;
      while ((nl = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        const fields = parseCopyLine(line);
        if (fields) batch.push(fields);
      }
      if (batch.length >= batchSize) {
        child.stdout.pause();
        const full = batch;
        batch = [];
        onBatch(full);
        child.stdout.resume();
      }
    });
    child.on("error", reject);
    child.on("close", code => {
      const tail = parseCopyLine(pending);
      if (tail) batch.push(tail);
      if (batch.length) onBatch(batch);
      code === 0 ? resolve() : reject(new Error(`pg_restore failed for ${table}: ${stderr}`));
    });
  });
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
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_results
       (user_id, round_id, finished, words, points, max_words, max_points, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0, skipped = 0;
  const writeBatch = db.transaction((rows: (string | null)[][]) => {
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
  });

  await streamCopyRows("user_results", rows => {
    writeBatch(rows);
    if (inserted % 500_000 < 50_000) {
      process.stdout.write(`  ${inserted}...\n`);
    }
  });
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

// --- merge the games played on v2 itself ------------------------------------
if (MERGE_V2_DB) {
  console.log("merging v2's own data...");
  mergeV2(MERGE_V2_DB);
}

/**
 * Folds the v2 database into the freshly imported one.
 *
 * v2 account ids were assigned independently of the old site's, so they cannot
 * be reused — v2 #1 and old #1 are different people. Every account is therefore
 * either matched to an existing old account, or given a brand-new id.
 *
 * Matching, in order:
 *   1. same display name — 18 of the 24 beta accounts, and name matches are
 *      one-to-one, so there is no ambiguity
 *   2. an address that belongs to exactly one old account. Not used when the
 *      address is shared, which is common in the imported data and would make
 *      the choice a guess
 *   3. otherwise the account is carried across under a new id
 *
 * Results keep their round ids, which are positive on v2 and negative for
 * imported rows, so they cannot collide.
 */
function mergeV2(dbPath: string): void {
  const v2 = new Database(dbPath, { readonly: true });

  const v2Users = v2.prepare(
    `SELECT u.id, u.name, u.team, u.created_at, e.email
     FROM users u LEFT JOIN user_emails e ON e.user_id = u.id`,
  ).all() as { id: number; name: string; team: string | null; created_at: string; email: string | null }[];

  const findByName = db.prepare("SELECT id, name FROM users WHERE name = ? COLLATE NOCASE");
  const findByEmail = db.prepare(
    "SELECT u.id, u.name FROM users u JOIN user_emails e ON e.user_id = u.id WHERE e.email = ?",
  );
  const maxId = (db.prepare("SELECT COALESCE(MAX(id), 0) m FROM users").get() as { m: number }).m;

  type Plan = { v2Id: number; v2Name: string; targetId: number; how: string; note: string };
  const plans: Plan[] = [];
  let nextId = maxId + 1;

  for (const u of v2Users) {
    const byName = findByName.get(u.name) as { id: number; name: string } | undefined;
    if (byName) {
      const emailDiffers = u.email
        ? !(db.prepare("SELECT 1 FROM user_emails WHERE user_id = ? AND email = ?").get(byName.id, u.email))
        : false;
      plans.push({
        v2Id: u.id, v2Name: u.name, targetId: byName.id, how: "name",
        // Only one address fits per account, so a beta address that differs
        // from the old one cannot be kept — worth saying out loud.
        note: emailDiffers ? "keeps the old address; the beta one is dropped" : "",
      });
      continue;
    }
    const byEmail = u.email ? (findByEmail.all(u.email) as { id: number; name: string }[]) : [];
    if (byEmail.length === 1) {
      plans.push({
        v2Id: u.id, v2Name: u.name, targetId: byEmail[0].id, how: "email",
        note: `-> ${byEmail[0].name}`,
      });
      continue;
    }
    plans.push({
      v2Id: u.id, v2Name: u.name, targetId: nextId++, how: "new",
      note: byEmail.length > 1 ? `address shared by ${byEmail.length} accounts` : "",
    });
  }

  const idMap = new Map(plans.map(p => [p.v2Id, p.targetId]));

  db.transaction(() => {
    // New accounts first, so results have somewhere to land.
    const insUser = db.prepare(
      "INSERT OR IGNORE INTO users (id, name, pw_hash, team, created_at) VALUES (?, ?, NULL, ?, ?)",
    );
    const insEmail = db.prepare("INSERT OR IGNORE INTO user_emails (user_id, email) VALUES (?, ?)");
    for (const p of plans.filter(x => x.how === "new")) {
      const u = v2Users.find(x => x.id === p.v2Id)!;
      insUser.run(p.targetId, u.name, u.team, u.created_at);
      if (u.email) insEmail.run(p.targetId, u.email);
    }

    const insResult = db.prepare(
      `INSERT OR IGNORE INTO user_results
         (user_id, round_id, finished, words, points, max_words, max_points, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let moved = 0, collided = 0;
    for (const r of v2.prepare(
      "SELECT user_id, round_id, finished, words, points, max_words, max_points, size FROM user_results",
    ).iterate() as Iterable<Record<string, number | string>>) {
      const target = idMap.get(r.user_id as number);
      if (target === undefined) continue;
      const info = insResult.run(
        target, r.round_id, r.finished, r.words, r.points, r.max_words, r.max_points, r.size,
      );
      info.changes === 1 ? moved++ : collided++;
    }

    // Settings and live sessions ride along so beta testers stay logged in.
    const insSettings = db.prepare(
      `INSERT OR IGNORE INTO user_settings (user_id, show_rotate, word_list_sort, high_contrast, board_scale)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const s of v2.prepare("SELECT * FROM user_settings").all() as Record<string, number | string>[]) {
      const target = idMap.get(s.user_id as number);
      if (target !== undefined) {
        insSettings.run(target, s.show_rotate, s.word_list_sort, s.high_contrast, s.board_scale);
      }
    }

    const insSession = db.prepare(
      "INSERT OR IGNORE INTO user_sessions (user_id, session_token, created_at, valid_until) VALUES (?, ?, ?, ?)",
    );
    let sessions = 0;
    for (const s of v2.prepare(
      "SELECT user_id, session_token, created_at, valid_until FROM user_sessions WHERE user_id IS NOT NULL AND valid_until > datetime('now')",
    ).all() as Record<string, number | string>[]) {
      const target = idMap.get(s.user_id as number);
      if (target !== undefined) {
        insSession.run(target, s.session_token, s.created_at, s.valid_until);
        sessions++;
      }
    }

    // Chat comes along too. Nothing else deletes it, so the table is the only
    // record of what players said — and that is where they report what is
    // broken, weeks before it reaches a survey. Dropping it here was the one
    // thing that made the history start over at every sync.
    const insChat = db.prepare(
      `INSERT OR IGNORE INTO chat_messages (user_id, username, message, size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let chatKept = 0;
    for (const m of v2.prepare(
      "SELECT user_id, username, message, size, created_at FROM chat_messages",
    ).all() as Record<string, number | string>[]) {
      const userId = m.user_id as number;
      // Guests have negative ids, are not in users, and there is no foreign key
      // on this table — they carry over as they are.
      const target = userId < 0 ? userId : idMap.get(userId);
      if (target !== undefined) {
        insChat.run(target, m.username, m.message, m.size, m.created_at);
        chatKept++;
      }
    }

    console.log(`  ${moved} results moved` + (collided ? `, ${collided} already present` : "") +
      `, ${sessions} live session(s) kept, ${chatKept} chat message(s) kept`);
  })();

  // The mapping is the part worth a human glance, so print all of it.
  console.log("\n  beta account            ->  merged into");
  console.log("  " + "-".repeat(64));
  for (const p of plans.sort((a, b) => a.how.localeCompare(b.how) || a.v2Name.localeCompare(b.v2Name))) {
    const target = p.how === "new"
      ? `new account #${p.targetId}`
      : `#${p.targetId} (matched by ${p.how})`;
    console.log(`  ${p.v2Name.padEnd(22)} ->  ${target}${p.note ? `  — ${p.note}` : ""}`);
  }
  console.log();

  v2.close();
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
