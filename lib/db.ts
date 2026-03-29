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
    pw_hash    TEXT    NOT NULL,
    team       TEXT    COLLATE NOCASE,
    options    TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (length(name) >= 4),
    CHECK (length(name) <= 15),
    CHECK (name NOT LIKE 'guest_%'),
    CHECK (team IS NULL OR (length(team) >= 5 AND length(team) <= 12))
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
    finished   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    words      INTEGER NOT NULL,
    points     INTEGER NOT NULL,
    max_words  INTEGER NOT NULL,
    max_points INTEGER NOT NULL,
    size       INTEGER NOT NULL
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
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
