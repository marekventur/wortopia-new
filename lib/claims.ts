import bcrypt from "bcryptjs";
import { getDb } from "./db.js";
import { maskEmail } from "./auth.js";

/**
 * Claiming an imported account: prove you know its old password, and it moves
 * onto your address.
 *
 * The old site keyed login on username + password and only used email for
 * recovery, so many imported accounts sit on addresses their owner no longer
 * reads — that is exactly why they cannot log in. The password is the only
 * proof of ownership available.
 *
 * Those hashes are bcrypt cost 6 (64 iterations), which is cheap to attack by
 * modern standards, and the passwords are years old and likely reused. Three
 * things keep that in bounds:
 *
 *   1. Rate limits on BOTH ends — per target account (someone hammering one
 *      valuable nick) and per claiming address (someone trying one likely
 *      password against every imported account in turn).
 *   2. Single use — a successful claim deletes the hash, so the pool of
 *      claimable accounts only ever shrinks.
 *   3. claim_log — no mail is sent to the previous address, so this is the
 *      only record that a rebind happened.
 */

// Per target account.
const MAX_ACCOUNT_ATTEMPTS = 5;
const ACCOUNT_LOCK_MINUTES = 60;

// Per claiming address, across all accounts.
const MAX_CLAIMER_ATTEMPTS = 10;
const CLAIMER_WINDOW_MINUTES = 60;

export type ClaimResult =
  | { ok: true; userId: number; username: string }
  | { ok: false; error: string; status: number };

export type ClaimableAccount = {
  id: number;
  name: string;
  games: number;
  lastPlayed: string | null;
  hidden: boolean;
};

/**
 * What to say when someone asks for a name that is already on their address.
 * Points at where it is rather than just denying the request — hidden accounts
 * are behind a toggle on /konten, so saying "look in the list" would be wrong.
 */
function alreadyYours(name: string, hidden: boolean): string {
  return hidden
    ? `„${name}“ gehört bereits zu deiner Email-Adresse, ist aber ausgeblendet. ` +
        `Du kannst den Namen oben unter „Ausgeblendete Konten anzeigen“ wieder einblenden.`
    : `„${name}“ gehört bereits zu deiner Email-Adresse — du findest den Namen oben in der Liste.`;
}

/** Is this name an imported account that can still be claimed with a password? */
export function isClaimable(username: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM users u
       JOIN v1_claims c ON c.user_id = u.id
       WHERE u.name = ? COLLATE NOCASE`
    )
    .get(username);
  return row !== undefined;
}

/** Accounts currently reachable from an address, hidden ones included. */
export function accountsForEmail(email: string): ClaimableAccount[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.name, u.hidden_at,
              (SELECT COUNT(*) FROM user_results r WHERE r.user_id = u.id)       AS games,
              (SELECT MAX(r.finished) FROM user_results r WHERE r.user_id = u.id) AS last_played
       FROM users u
       JOIN user_emails e ON e.user_id = u.id
       WHERE e.email = ?
       ORDER BY last_played DESC, games DESC`
    )
    .all(email)
    .map((row) => {
      const r = row as {
        id: number;
        name: string;
        hidden_at: string | null;
        games: number;
        last_played: string | null;
      };
      return {
        id: r.id,
        name: r.name,
        games: r.games,
        lastPlayed: r.last_played,
        hidden: r.hidden_at !== null,
      };
    });
}

function claimerBlocked(email: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT attempts, window_start FROM claim_attempts WHERE email = ?")
    .get(email) as { attempts: number; window_start: string } | undefined;
  if (!row) return false;

  const windowAge = Date.now() - new Date(row.window_start).getTime();
  if (windowAge > CLAIMER_WINDOW_MINUTES * 60_000) {
    db.prepare("DELETE FROM claim_attempts WHERE email = ?").run(email);
    return false;
  }
  return row.attempts >= MAX_CLAIMER_ATTEMPTS;
}

function recordClaimerAttempt(email: string): void {
  getDb()
    .prepare(
      `INSERT INTO claim_attempts (email, attempts) VALUES (?, 1)
       ON CONFLICT(email) DO UPDATE SET attempts = attempts + 1`
    )
    .run(email);
}

/**
 * Verifies the old password for `username` and, on success, moves the account
 * onto `email`. `email` must already be proven — callers pass the address of an
 * authenticated session, never anything from the request body.
 */
export async function claimAccount(
  username: string,
  password: string,
  email: string
): Promise<ClaimResult> {
  const db = getDb();
  const who = maskEmail(email);

  if (claimerBlocked(email)) {
    console.log(`[claims] ${who} blocked: too many claim attempts in the last hour`);
    return {
      ok: false,
      status: 429,
      error: "Zu viele Versuche. Bitte versuche es in einer Stunde noch einmal.",
    };
  }

  const account = db
    .prepare(
      `SELECT u.id, u.name, c.pw_hash, c.attempts, c.locked_until, e.email AS current_email
       FROM users u
       JOIN v1_claims c ON c.user_id = u.id
       LEFT JOIN user_emails e ON e.user_id = u.id
       WHERE u.name = ? COLLATE NOCASE`
    )
    .get(username) as
    | {
        id: number;
        name: string;
        pw_hash: string;
        attempts: number;
        locked_until: string | null;
        current_email: string | null;
      }
    | undefined;

  // Same message whether the name does not exist, was never imported, or was
  // already claimed — otherwise this endpoint reports which accounts still
  // carry a usable password.
  const notClaimable: ClaimResult = {
    ok: false,
    status: 400,
    error:
      "Zu diesem Namen gibt es kein altes Konto mit Passwort. " +
      "Falls du dir sicher bist, melde dich bitte bei uns.",
  };

  if (!account) {
    // A name with no claim row is usually one that already sits on an address.
    // When that address is the caller's own — because they were moved by hand,
    // or claimed it earlier — "there is no such account" is not just unhelpful,
    // it is the opposite of the truth, and it is what sends people to support
    // for an account they already have.
    const mine = db
      .prepare(
        `SELECT u.name, u.hidden_at
         FROM users u
         JOIN user_emails e ON e.user_id = u.id
         WHERE u.name = ? COLLATE NOCASE AND e.email = ?`
      )
      .get(username, email) as { name: string; hidden_at: string | null } | undefined;

    if (mine) {
      console.log(`[claims] ${who} tried to claim "${mine.name}", which is already theirs`);
      // Not counted as a claim attempt: it is their own account, not a guess.
      return { ok: false, status: 400, error: alreadyYours(mine.name, mine.hidden_at !== null) };
    }

    recordClaimerAttempt(email);
    console.log(`[claims] ${who} tried to claim "${username}": no claimable account`);
    return notClaimable;
  }

  if (account.current_email === email) {
    // Same case as above, for a name that still carries its old password.
    const hidden = db
      .prepare("SELECT hidden_at FROM users WHERE id = ?")
      .get(account.id) as { hidden_at: string | null };
    return { ok: false, status: 400, error: alreadyYours(account.name, hidden.hidden_at !== null) };
  }

  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    console.log(`[claims] ${who} tried to claim "${account.name}": account locked`);
    return {
      ok: false,
      status: 429,
      error: "Zu viele Fehlversuche für dieses Konto. Bitte versuche es später noch einmal.",
    };
  }

  const correct = await bcrypt.compare(password, account.pw_hash);

  if (!correct) {
    recordClaimerAttempt(email);
    const attempts = account.attempts + 1;
    const lock =
      attempts >= MAX_ACCOUNT_ATTEMPTS
        ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000).toISOString()
        : null;
    db.prepare("UPDATE v1_claims SET attempts = ?, locked_until = ? WHERE user_id = ?").run(
      attempts,
      lock,
      account.id
    );
    console.log(
      `[claims] ${who} wrong password for "${account.name}" ` +
        `(${attempts}/${MAX_ACCOUNT_ATTEMPTS})${lock ? " — account now locked for an hour" : ""}`
    );
    return { ok: false, status: 400, error: "Das Passwort stimmt nicht." };
  }

  // Correct. Rebind, burn the hash, record it — all or nothing.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO user_emails (user_id, email) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email`
    ).run(account.id, email);

    db.prepare(
      `INSERT INTO claim_log (user_id, username, from_email, to_email) VALUES (?, ?, ?, ?)`
    ).run(account.id, account.name, account.current_email, email);

    // Single use: from here the account is an ordinary passwordless one.
    db.prepare("DELETE FROM v1_claims WHERE user_id = ?").run(account.id);

    // A claim un-hides, otherwise the nick still would not appear in the picker.
    db.prepare("UPDATE users SET hidden_at = NULL WHERE id = ?").run(account.id);
  })();

  console.log(
    `[claims] ${who} claimed "${account.name}" (was ${
      account.current_email ? maskEmail(account.current_email) : "no address"
    })`
  );

  return { ok: true, userId: account.id, username: account.name };
}

/** Hides or unhides one of the caller's own accounts. */
export function setAccountHidden(userId: number, email: string, hidden: boolean): boolean {
  const info = getDb()
    .prepare(
      `UPDATE users SET hidden_at = ?
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM user_emails e WHERE e.user_id = users.id AND e.email = ?)`
    )
    .run(hidden ? new Date().toISOString() : null, userId, email);
  return info.changes === 1;
}
