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

  -- The login code is kept in the clear, because "Code erneut senden" has to be
  -- able to send the same one again — a resend that mints a new code kills the
  -- email the player is holding, which is exactly how people ended up typing
  -- correct-but-dead codes for days. Hashing it would only be worth something if
  -- the plaintext were nowhere on the box, and it buys nothing next to
  -- user_sessions.session_token, which sits here in the clear and is a live
  -- credential. Codes are six digits, single-use, and deleted on success, on
  -- expiry (lib/cleanup.ts) and after five wrong guesses.
  CREATE TABLE IF NOT EXISTS email_codes (
    email      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    -- The code this one replaced. Never accepted for login, only compared
    -- against so a failure can be reported as "you used an older email".
    prev_code  TEXT,
    -- When the code was last emailed, not when it was first made: a resend
    -- pushes both this and expires_at forward, so the code stays alive for as
    -- long as someone is actively asking for it.
    sent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_emails (
    user_id  INTEGER PRIMARY KEY
             REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    email    TEXT NOT NULL
  );

  -- NOT unique: the old site keyed login on username+password and let several
  -- accounts share one address (families, school classes). 138 imported
  -- addresses have more than one account behind them, so a unique constraint
  -- here would reject the import outright. Login has to disambiguate instead.
  CREATE INDEX IF NOT EXISTS user_emails_email
    ON user_emails (email);

  CREATE TABLE IF NOT EXISTS user_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    guest_id      INTEGER,
    session_token TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    valid_until   TEXT NOT NULL,
    CHECK ((user_id IS NULL) != (guest_id IS NULL))
  );

  CREATE TABLE IF NOT EXISTS words (
    word        TEXT    PRIMARY KEY COLLATE NOCASE,
    accepted    INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    CHECK (word = lower(word))
  );

  CREATE INDEX IF NOT EXISTS words_first_two_letters
    ON words (substr(replace(word, 'qu', 'q'), 1, 2));

  CREATE INDEX IF NOT EXISTS words_three
    ON words (substr(word, 1, 3));

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

  -- Must match the live table: refreshLeaderboardCache() writes a rank column.
  -- This declaration had drifted, and because CREATE TABLE IF NOT EXISTS leaves
  -- an existing table alone, the mismatch only shows up on a fresh database.
  -- Covering index for the leaderboard aggregation: leading with user_id lets
  -- the GROUP BY read straight down the index, and carrying the summed columns
  -- avoids touching the table at all. On the full 3.9M-row history this takes
  -- the nightly refresh from ~9s per query to ~0.8s; without it the 3am rebuild
  -- blocks the event loop for tens of minutes.
  CREATE INDEX IF NOT EXISTS user_results_leaderboard
    ON user_results (user_id, size, finished, max_points, points, words);

  CREATE TABLE IF NOT EXISTS leaderboard_cache (
    days         INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    rank         INTEGER NOT NULL,
    name         TEXT    NOT NULL,
    team         TEXT,
    games        INTEGER NOT NULL,
    pct          REAL    NOT NULL,
    avg_words    REAL    NOT NULL,
    best_round   INTEGER NOT NULL,
    generated_at TEXT    NOT NULL,
    PRIMARY KEY (days, size, rank)
  );

  CREATE TABLE IF NOT EXISTS muted_users (
    user_id INTEGER NOT NULL
  );

  -- How spielwoerter.de actually spells each word the game plays.
  --
  -- The board has no umlauts, so the dictionary is normalised on the way in:
  -- ÖFFNEN is stored and played as OEFFNEN, and that is the only spelling
  -- wortopia has ever known. It is not the spelling the word list uses, and a
  -- report travelling the other way has to name the listed one — asking for
  -- "buessi" to be removed leaves "büßi" listed and the word still playable,
  -- which is exactly what players kept reporting.
  --
  -- One row per (normalised word, listed spelling). Usually one, but 1,137
  -- words are listed under two spellings at once ("abbeisse" and "abbeiße"),
  -- and for those the game only stops playing the word when both are gone.
  CREATE TABLE IF NOT EXISTS word_spellings (
    word     TEXT NOT NULL COLLATE NOCASE,
    spelling TEXT NOT NULL,
    PRIMARY KEY (word, spelling)
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
    size       INTEGER NOT NULL DEFAULT 4,
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

  CREATE TABLE IF NOT EXISTS word_proposals (
    id                TEXT    PRIMARY KEY,
    user_id           INTEGER NOT NULL,
    username          TEXT    NOT NULL,
    word              TEXT    NOT NULL COLLATE NOCASE,
    action            TEXT    NOT NULL CHECK (action IN ('add', 'update', 'remove')),
    description       TEXT,
    base              TEXT,
    status            TEXT    NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'approved', 'rejected', 'sent_for_approval')),
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closes_at         TEXT    NOT NULL,
    held_for_cooldown INTEGER NOT NULL DEFAULT 0,
    size              INTEGER NOT NULL DEFAULT 4,
    reason            TEXT
  );

  CREATE INDEX IF NOT EXISTS word_proposals_created
    ON word_proposals (created_at);

  CREATE TABLE IF NOT EXISTS word_proposal_votes (
    proposal_id TEXT    NOT NULL REFERENCES word_proposals(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL,
    vote        TEXT    NOT NULL CHECK (vote IN ('support', 'oppose')),
    PRIMARY KEY (proposal_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    show_rotate    INTEGER NOT NULL DEFAULT 1,
    word_list_sort TEXT    NOT NULL DEFAULT 'default',
    high_contrast  INTEGER NOT NULL DEFAULT 0,
    board_scale    INTEGER NOT NULL DEFAULT 100
  );

  -- Single-row counter handing out unique guest ids. Seeded above the range of
  -- the old random ids (0..100000) so ids already living in visitors' cookies
  -- can never be handed out a second time.
  CREATE TABLE IF NOT EXISTS guest_id_counter (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    next_id INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO guest_id_counter (id, next_id) VALUES (1, 100001);

  -- Password hashes carried over from the old site, kept ONLY so someone can
  -- prove an imported account is theirs and move it onto an address they can
  -- actually receive mail at (see lib/claims.ts). They are never a login
  -- method. Held here rather than on users.pw_hash so "is claimable" is one
  -- clean predicate, and so the row can be deleted outright once used — the
  -- hashes are bcrypt cost 6, which is weak by current standards, so the set
  -- of claimable accounts should only ever shrink.
  CREATE TABLE IF NOT EXISTS v1_claims (
    user_id      INTEGER PRIMARY KEY
                 REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    pw_hash      TEXT    NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
  );

  -- Successful claims. There is no notification to the previous address (for
  -- imported accounts it is usually stale — that is the whole reason someone
  -- is claiming), so this table is the only record that a rebind happened.
  CREATE TABLE IF NOT EXISTS claim_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    from_email TEXT,
    to_email   TEXT    NOT NULL,
    claimed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Rate limit for the claimer, not the target. Per-account limits alone would
  -- still let one person try a single likely password against every imported
  -- account in turn.
  CREATE TABLE IF NOT EXISTS claim_attempts (
    email        TEXT    PRIMARY KEY,
    attempts     INTEGER NOT NULL DEFAULT 0,
    window_start TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

/** Returns a guest id that has never been issued before. */
export function nextGuestId(): number {
  const row = getDb()
    .prepare(
      "UPDATE guest_id_counter SET next_id = next_id + 1 WHERE id = 1 RETURNING next_id"
    )
    .get() as { next_id: number };
  return row.next_id - 1;
}

function migrateWordProposals(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(word_proposals)").all() as { name: string }[]).map(c => c.name);

  // If the table was created before the 'add' action and held-proposal columns existed,
  // recreate it. The table is ephemeral (30-min vote window) so data loss is acceptable.
  if (!cols.includes("held_for_cooldown")) {
    db.exec(`
      CREATE TABLE word_proposals_new (
        id                TEXT    PRIMARY KEY,
        user_id           INTEGER NOT NULL,
        username          TEXT    NOT NULL,
        word              TEXT    NOT NULL COLLATE NOCASE,
        action            TEXT    NOT NULL CHECK (action IN ('add', 'update', 'remove')),
        description       TEXT,
        base              TEXT,
        status            TEXT    NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'approved', 'rejected', 'sent_for_approval')),
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        closes_at         TEXT    NOT NULL,
        held_for_cooldown INTEGER NOT NULL DEFAULT 0,
        size              INTEGER NOT NULL DEFAULT 4
      );
      INSERT INTO word_proposals_new (id, user_id, username, word, action, description, base, status, created_at, closes_at)
        SELECT id, user_id, username, word, action, description, base, status, created_at, closes_at
        FROM word_proposals
        WHERE action IN ('update', 'remove');
      DROP TABLE word_proposals;
      ALTER TABLE word_proposals_new RENAME TO word_proposals;
      CREATE INDEX IF NOT EXISTS word_proposals_created ON word_proposals (created_at);
    `);
  }
}

function migrateUserSettings(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE user_settings ADD COLUMN high_contrast INTEGER NOT NULL DEFAULT 0").run();
  } catch {}
}

function migrateWordProposalReason(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE word_proposals ADD COLUMN reason TEXT").run();
  } catch {}
}

function migrateBoardScale(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE user_settings ADD COLUMN board_scale INTEGER NOT NULL DEFAULT 100").run();
  } catch {}
}

/**
 * When a proposal actually reached spielwoerter.de.
 *
 * The bridge POSTed and never looked at the answer, so six weeks of 401s went
 * unnoticed and ~540 finalized proposals were dropped on the floor. Recording
 * delivery makes "what never arrived" a query rather than an archaeology
 * project, and lets a backfill run twice without sending anything twice.
 */
function migrateProposalDeliveryMarker(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE word_proposals ADD COLUMN synced_to_spielwoerter_at TEXT").run();
  } catch {}
}

/**
 * An index leading with `finished`, so a leaderboard window can be seeked
 * rather than scanned.
 *
 * user_results_leaderboard leads with user_id, which is right for "one player's
 * history" and useless for "everyone in the last day": SQLite scanned all 3.9
 * million entries every time, ~370ms per window. With this index the 24-hour
 * board drops to ~1ms, which is what makes it affordable to compute live
 * instead of once a night.
 *
 * ANALYZE is not optional here. Without the statistics SQLite sticks with the
 * old covering index and the new one is never used — measured, not assumed. It
 * takes about three seconds on the live database and runs once, when the index
 * is first created.
 */
/**
 * The word list's version string, as it stood at the last sync.
 *
 * Without it the only way to know whether the list has moved is to pull all six
 * megabytes of it, so the sync ran once a night and an approved word waited up
 * to 24 hours to become playable. Players read that lag as their reports being
 * ignored.
 */
function migrateWordSyncVersion(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE word_sync_log ADD COLUMN version TEXT").run();
  } catch {}
}

function migrateLeaderboardFinishedIndex(db: Database.Database): void {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get("user_results_finished");
  if (exists) return;

  console.log("[db] Building user_results_finished (one-off, a few seconds)...");
  db.prepare("CREATE INDEX user_results_finished ON user_results (finished)").run();
  db.prepare("ANALYZE").run();
  console.log("[db] user_results_finished ready.");
}

/**
 * Brings email_codes to the shape above: codes in the clear so a resend can
 * repeat one, and `sent_at` rather than `created_at` now that a resend moves it.
 *
 * The rows hold hashes, which cannot be turned back into something to email, so
 * they go. At most a handful of logins are ever in flight; those people request
 * a code again.
 */
function migrateEmailCodePlaintext(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(email_codes)").all() as { name: string }[])
    .map(c => c.name);
  if (cols.includes("code")) return;

  db.transaction(() => {
    db.prepare("DELETE FROM email_codes").run();
    db.prepare("ALTER TABLE email_codes RENAME COLUMN code_hash TO code").run();
    db.prepare("ALTER TABLE email_codes RENAME COLUMN created_at TO sent_at").run();
    // prev_code_hash only exists on databases that saw the previous migration.
    if (cols.includes("prev_code_hash")) {
      db.prepare("ALTER TABLE email_codes RENAME COLUMN prev_code_hash TO prev_code").run();
    } else {
      db.prepare("ALTER TABLE email_codes ADD COLUMN prev_code TEXT").run();
    }
  })();
}

/**
 * Moves the imported password hashes off users.pw_hash into v1_claims.
 *
 * A move, not a copy: two live copies of a credential is strictly worse than
 * one, and accounts created since the rewrite are passwordless anyway
 * (api/auth/register inserts pw_hash NULL), so afterwards the column is dead.
 */
function migrateV1Claims(db: Database.Database): void {
  const remaining = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE pw_hash IS NOT NULL")
    .get() as { c: number };
  if (remaining.c === 0) return;

  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO v1_claims (user_id, pw_hash)
       SELECT id, pw_hash FROM users WHERE pw_hash IS NOT NULL`
    ).run();
    db.prepare("UPDATE users SET pw_hash = NULL WHERE pw_hash IS NOT NULL").run();
  })();

  console.log(`[claims] moved ${remaining.c} v1 password hash(es) into v1_claims`);
}

/**
 * Lets someone drop a nick out of their login picker without deleting it.
 * Deleting would cascade away the account's whole round history, and five
 * tables (chat_messages, round_guesses, word_proposals, word_proposal_votes,
 * muted_users) carry a user_id with no foreign key at all, so a delete would
 * silently orphan those rows instead of cleaning them up.
 */
function migrateHiddenAccounts(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE users ADD COLUMN hidden_at TEXT").run();
  } catch {}
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // The daily word sync rewrites ~195k rows in one transaction, which grows
    // the WAL past the size of the database itself. Cap it so checkpoints give
    // the space back instead of leaving a permanently inflated file.
    db.pragma("journal_size_limit = 67108864"); // 64 MB
    db.exec(SCHEMA);
    migrateWordProposals(db);
    migrateUserSettings(db);
    migrateWordProposalReason(db);
    migrateBoardScale(db);
    migrateEmailCodePlaintext(db);
    migrateLeaderboardFinishedIndex(db);
    migrateProposalDeliveryMarker(db);
    migrateWordSyncVersion(db);
    migrateHiddenAccounts(db);
    migrateV1Claims(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
