import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash    TEXT,
    team       TEXT    COLLATE NOCASE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (length(name) >= 4),
    CHECK (length(name) <= 15),
    CHECK (name NOT LIKE 'guest_%'),
    CHECK (team IS NULL OR (length(team) >= 5 AND length(team) <= 12))
  );

  CREATE TABLE IF NOT EXISTS email_codes (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_emails (
    user_id  INTEGER PRIMARY KEY
             REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    email    TEXT NOT NULL
  );

  -- session_token is generated in JS (crypto.randomUUID).
  -- valid_until is set to now + 30 days at insert time.
  CREATE TABLE IF NOT EXISTS user_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    guest_id      INTEGER,
    session_token TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    valid_until   TEXT NOT NULL,
    CHECK ((user_id IS NULL) != (guest_id IS NULL))
  );

  -- Words are imported externally (not auto-generated).
  -- 'description' replaces the old wiki table.
  CREATE TABLE IF NOT EXISTS words (
    word        TEXT    PRIMARY KEY COLLATE NOCASE,
    accepted    INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    CHECK (word = lower(word))
  );

  CREATE INDEX IF NOT EXISTS words_first_two_letters
    ON words (substr(replace(word, 'qu', 'q'), 1, 2));

  CREATE TABLE IF NOT EXISTS user_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL
               REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    round_id   INTEGER NOT NULL DEFAULT 0,
    finished   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    words      INTEGER NOT NULL,
    points     INTEGER NOT NULL,
    max_words  INTEGER NOT NULL,
    max_points INTEGER NOT NULL,
    size       INTEGER NOT NULL,
    UNIQUE (user_id, round_id, size)
  );

  CREATE TABLE IF NOT EXISTS muted_users (
    user_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS word_sync_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    synced_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    word_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS chat_messages_created_at
    ON chat_messages (created_at);

  CREATE TABLE IF NOT EXISTS round_guesses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id   INTEGER NOT NULL,
    size       INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    word       TEXT    NOT NULL,
    result     TEXT    NOT NULL,
    points     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS round_guesses_lookup
    ON round_guesses (round_id, size, user_id);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);

    // 3-letter prefix index used by fieldWords.ts.
    // words_prefix (2-letter) and words_first_two_letters (QU-replacement) are legacy;
    // words_first_two was a duplicate we added — drop it.
    db.exec(`CREATE INDEX IF NOT EXISTS words_three ON words (substr(word, 1, 3))`);
    try { db.exec(`DROP INDEX IF EXISTS words_first_two`); } catch { /* already gone */ }

    // Migration: namespace chat by game size
    const chatCols = (db.prepare(`PRAGMA table_info(chat_messages)`).all() as { name: string }[]).map(c => c.name);
    if (!chatCols.includes('size')) {
      db.exec(`ALTER TABLE chat_messages ADD COLUMN size INTEGER NOT NULL DEFAULT 4`);
    }

    // Migration: drop options column from users (no longer used)
    const userColInfo = db.prepare(`PRAGMA table_info(users)`).all() as { name: string; notnull: number }[];
    const userCols = userColInfo.map(c => c.name);
    if (userCols.includes('options')) {
      db.exec(`ALTER TABLE users DROP COLUMN options`);
    }

    // Migration: make pw_hash nullable (passwordless auth — existing hashes kept for recovery)
    const pwHashCol = userColInfo.find(c => c.name === 'pw_hash');
    if (pwHashCol?.notnull) {
      db.pragma("foreign_keys = OFF");
      db.exec(`
        CREATE TABLE users_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          pw_hash    TEXT,
          team       TEXT    COLLATE NOCASE,
          created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          CHECK (length(name) >= 4),
          CHECK (length(name) <= 15),
          CHECK (name NOT LIKE 'guest_%'),
          CHECK (team IS NULL OR (length(team) >= 5 AND length(team) <= 12))
        );
        INSERT INTO users_new SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.pragma("foreign_keys = ON");
    }

    // Index for rangliste time-filtered queries
    db.exec(`CREATE INDEX IF NOT EXISTS user_results_finished ON user_results (finished)`);

    // Migration: add round_id + unique constraint to user_results
    const resultCols = (db.prepare(`PRAGMA table_info(user_results)`).all() as { name: string }[]).map(c => c.name);
    if (!resultCols.includes('round_id')) {
      db.exec(`ALTER TABLE user_results ADD COLUMN round_id INTEGER NOT NULL DEFAULT 0`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS user_results_unique ON user_results (user_id, round_id, size)`);
    }
    if (!resultCols.includes('max_words')) {
      db.exec(`ALTER TABLE user_results ADD COLUMN max_words INTEGER NOT NULL DEFAULT 0`);
    }
    if (!resultCols.includes('max_points')) {
      db.exec(`ALTER TABLE user_results ADD COLUMN max_points INTEGER NOT NULL DEFAULT 0`);
    }
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
