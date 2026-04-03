/**
 * Import script: PostgreSQL custom dump → SQLite
 *
 * Imports: users, user_emails, user_results
 * Skips:   words (synced from spielwoerter.de), sessions, wiki, migrations
 *
 * Usage:
 *   node --import tsx/esm scripts/import-pg.ts /path/to/wortopia_dump.sql
 *
 * Notes:
 *   - user_results rows get round_id = -id (negative of old PG id) so they
 *     don't collide with real round IDs (which are epoch-based positive ints)
 *   - users with names that fail CHECK constraints are skipped with a warning
 *   - existing data is left untouched (INSERT OR IGNORE)
 */

import { spawnSync } from "child_process";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const DUMP_FILE = process.argv[2] ?? "/home/marek/wortopia_dump.sql";
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert PG timestamp to SQLite ISO string: "2016-03-15 21:03:31.999291" → "2016-03-15T21:03:31.999Z" */
function pgTs(ts: string): string {
  const d = new Date(ts.replace(" ", "T") + "Z");
  return d.toISOString();
}

/** Extract COPY rows for a table from the dump, returned as arrays of string fields. */
function extractCopyRows(table: string): string[][] {
  const result = spawnSync("pg_restore", ["-f", "-", "-a", "-t", table, DUMP_FILE], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024, // 512 MB
  });

  if (result.error) throw result.error;

  const rows: string[][] = [];
  let inCopy = false;

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("COPY public.")) {
      inCopy = true;
      continue;
    }
    if (line === "\\.") {
      inCopy = false;
      continue;
    }
    if (!inCopy || line.trim() === "") continue;

    rows.push(line.split("\t").map(f => f === "\\N" ? null : f) as string[]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // disable during bulk import

console.log(`Importing from: ${DUMP_FILE}`);
console.log(`Into DB:        ${DB_PATH}`);
console.log();

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
// PG columns: id, name, pw_hash, team, created_at, options

console.log("Importing users...");
{
  const rows = extractCopyRows("users");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, pw_hash, team, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0, skipped = 0;

  db.transaction(() => {
    for (const [id, name, pw_hash, team, created_at] of rows) {
      // Validate CHECK constraints manually before inserting
      if (!name || name.length < 4 || name.length > 15) {
        console.warn(`  Skipping user id=${id} name="${name}" (length ${name?.length})`);
        skipped++;
        continue;
      }
      if (name.toLowerCase().startsWith("guest_")) {
        console.warn(`  Skipping user id=${id} name="${name}" (reserved prefix)`);
        skipped++;
        continue;
      }
      if (team !== null && (team.length < 5 || team.length > 12)) {
        console.warn(`  Skipping user id=${id} name="${name}" (invalid team "${team}")`);
        skipped++;
        continue;
      }

      insert.run(
        parseInt(id),
        name,
        pw_hash ?? null,
        team ?? null,
        pgTs(created_at),
      );
      inserted++;
    }
  })();

  console.log(`  Inserted: ${inserted}, skipped: ${skipped}`);
}

// ---------------------------------------------------------------------------
// user_emails
// ---------------------------------------------------------------------------
// PG columns: user_id, email

console.log("Importing user_emails...");
{
  const rows = extractCopyRows("user_emails");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_emails (user_id, email) VALUES (?, ?)
  `);

  let inserted = 0;

  db.transaction(() => {
    for (const [user_id, email] of rows) {
      insert.run(parseInt(user_id), email.toLowerCase().trim());
      inserted++;
    }
  })();

  console.log(`  Inserted: ${inserted}`);
}

// ---------------------------------------------------------------------------
// user_results
// ---------------------------------------------------------------------------
// PG columns: id, user_id, finished, words, points, max_words, max_points, size
// New schema also needs: round_id → use -id to avoid collision with real round IDs

console.log("Importing user_results (3.7M rows, this may take a minute)...");
{
  const rows = extractCopyRows("user_results");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_results (user_id, round_id, finished, words, points, max_words, max_points, size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Build a Set of valid user IDs to avoid per-row DB lookups
  const validUserIds = new Set<number>(
    (db.prepare("SELECT id FROM users").all() as { id: number }[]).map(r => r.id)
  );

  let inserted = 0, skipped = 0;

  db.transaction(() => {
    for (const [id, user_id, finished, words, points, max_words, max_points, size] of rows) {
      if (!validUserIds.has(parseInt(user_id))) { skipped++; continue; }

      insert.run(
        parseInt(user_id),
        -parseInt(id),          // negative old id as round_id
        pgTs(finished),
        parseInt(words),
        parseInt(points),
        parseInt(max_words),
        parseInt(max_points),
        parseInt(size),
      );
      inserted++;
    }
  })();

  console.log(`  Inserted: ${inserted}, skipped (no user): ${skipped}`);
}

db.pragma("foreign_keys = ON");
db.close();

console.log("\nDone.");
