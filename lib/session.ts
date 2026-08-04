import crypto from "crypto";
import type Database from "better-sqlite3";
import { createCookie } from "react-router";
import { getDb, nextGuestId } from "./db.js";
import {
  generateSessionToken,
  sessionExpiry,
  daysFromNow,
  SESSION_REFRESH_BELOW_DAYS,
} from "./auth.js";
import { secret } from "./secrets.js";

const GUEST_SECRET = secret("GUEST_TOKEN_SECRET");

// The cookie deliberately outlives the session row. Sessions are rolling and
// expire from inactivity (see getSession); if the cookie expired on its own
// 30-day schedule it would log active players out anyway, which is what used
// to push them into re-registering under a new name. 400 days is the maximum
// browsers will honour.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const sessionCookie = createCookie("wortopia_session", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: COOKIE_MAX_AGE_SECONDS,
  secrets: [secret("COOKIE_SECRET")],
});

export type SessionUser = {
  id: number;
  name: string;
  team: string | null;
  email: string | null;
};

export type Session =
  | { type: "user"; user: SessionUser }
  | { type: "guest"; guestId: number };

// ---------------------------------------------------------------------------
// Guest tokens — self-validating, no DB storage
// Format stored in cookie: "guest:<guestId>:<hmac>"
// ---------------------------------------------------------------------------

export function createGuestToken(guestId: number): string {
  const payload = `guest:${guestId}`;
  const hmac = crypto
    .createHmac("sha256", GUEST_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}:${hmac}`;
}

function parseGuestToken(token: string): number | null {
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== "guest") return null;

  // Guest ids used to be a random number in [0, 100000]; they now come from a
  // counter that starts above that range, so both remain valid.
  const guestId = parseInt(parts[1], 10);
  if (!Number.isSafeInteger(guestId) || guestId < 0) return null;

  const expected = crypto
    .createHmac("sha256", GUEST_SECRET)
    .update(`guest:${guestId}`)
    .digest("base64url");

  const actual = Buffer.from(parts[2], "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(actual, expectedBuf)) return null;

  return guestId;
}

// ---------------------------------------------------------------------------
// Why did someone end up logged out?
//
// Several players report having to enter an email code far more often than a
// 30-day rolling session should require — six addresses logged in 8 to 10 times
// in ten days. Sessions are only ever removed by logout or by expiry, so the
// interesting moment is the one where a browser presents a session cookie we
// refuse. These three cases look identical to the player and completely
// different to us:
//
//   gone     — no such row. Logged out here, or the row was removed underneath
//              them (a database rebuild that did not carry sessions over).
//   expired  — the row is there but past valid_until: genuinely inactive for
//              30 days, or the rolling refresh is not doing its job.
//   no user  — the row points at an account that no longer exists.
//
// Arriving with no cookie at all leaves no trace here, which is itself the
// answer if a player logs in repeatedly and never appears below: then the
// cookie is being dropped on their side, not rejected on ours.
// ---------------------------------------------------------------------------

/** Tokens already reported, so one logged-out tab does not fill the log. */
const reportedTokens = new Set<string>();

function logRejectedSession(db: Database.Database, token: string): void {
  if (reportedTokens.has(token)) return;
  // A browser that keeps presenting stale cookies would otherwise grow this
  // without limit; the cap is far above the number of players.
  if (reportedTokens.size > 1000) reportedTokens.clear();
  reportedTokens.add(token);

  const row = db
    .prepare(
      `SELECT s.user_id, u.name, s.created_at, s.valid_until
       FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.session_token = ?`
    )
    .get(token) as
    | { user_id: number | null; name: string | null; created_at: string; valid_until: string }
    | undefined;

  if (!row) {
    console.log("[session] rejected a session cookie: no such session (logged out, or removed)");
    return;
  }

  const ageDays = ((Date.now() - new Date(row.created_at).getTime()) / 86_400_000).toFixed(1);
  if (!row.name) {
    console.log(`[session] rejected a session cookie: account ${row.user_id} no longer exists`);
    return;
  }
  console.log(
    `[session] rejected a session cookie for "${row.name}": expired ` +
      `(created ${ageDays}d ago, valid until ${row.valid_until})`,
  );
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export async function getSession(request: Request): Promise<Session | null> {
  const cookieHeader = request.headers.get("Cookie");
  const token = await sessionCookie.parse(cookieHeader);
  if (!token || typeof token !== "string") return null;

  // Guest token
  if (token.startsWith("guest:")) {
    const guestId = parseGuestToken(token);
    return guestId !== null ? { type: "guest", guestId } : null;
  }

  // Registered user session
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.team, e.email
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_emails e ON e.user_id = u.id
       WHERE s.session_token = ?
         AND s.user_id IS NOT NULL
         AND s.valid_until > datetime('now')`
    )
    .get(token) as SessionUser | undefined;

  if (!row) {
    logRejectedSession(db, token);
    return null;
  }

  // Rolling expiry: push valid_until forward, but only once it has dropped
  // below the refresh threshold, so this costs at most one write per day.
  db.prepare(
    `UPDATE user_sessions SET valid_until = ?
     WHERE session_token = ? AND valid_until < ?`
  ).run(sessionExpiry(), token, daysFromNow(SESSION_REFRESH_BELOW_DAYS));

  return { type: "user", user: row };
}

/**
 * Returns the session, creating a guest session (with Set-Cookie) if none exists.
 * Use in loaders that don't need a game size.
 */
export async function getOrCreateSession(
  request: Request,
): Promise<{ session: Session; cookieHeader?: string }> {
  const session = await getSession(request);
  if (session) return { session };

  return { ...(await createGuestSession()) };
}

/**
 * Allocates a fresh guest identity and the cookie that carries it.
 * Ids come from a counter so two guests can never end up as the same player —
 * random ids collided often enough to matter (gameWsServer keys the player on
 * `-guestId`, so a collision merges two people into one).
 */
export async function createGuestSession(): Promise<{
  session: Session;
  cookieHeader: string;
}> {
  const guestId = nextGuestId();
  const guestToken = createGuestToken(guestId);
  const cookieHeader = await sessionCookie.serialize(guestToken);
  return { session: { type: "guest", guestId }, cookieHeader };
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const session = await getSession(request);
  return session?.type === "user" ? session.user : null;
}

/**
 * `reason` only exists for the log: switching accounts on /konten mints a
 * session exactly like a fresh login does, so without it a player who switches
 * names twice is indistinguishable from one who had to log in three times.
 */
export async function createSession(
  userId: number,
  reason: "login" | "switch" | "claim" | "register" = "login",
): Promise<string> {
  const db = getDb();
  const token = generateSessionToken();
  const validUntil = sessionExpiry();

  db.prepare(
    "INSERT INTO user_sessions (user_id, session_token, valid_until) VALUES (?, ?, ?)"
  ).run(userId, token, validUntil);

  const name = (db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as
    | { name: string }
    | undefined)?.name;
  const previous = db
    .prepare(
      `SELECT COUNT(*) n, MAX(created_at) last FROM user_sessions
       WHERE user_id = ? AND session_token != ?`
    )
    .get(userId, token) as { n: number; last: string | null };

  // How long ago the last one was is the number worth having: a player who
  // logs in daily has a persistence problem, whatever they report.
  const since = previous.last
    ? `, previous ${((Date.now() - new Date(previous.last).getTime()) / 86_400_000).toFixed(1)}d ago`
    : "";
  console.log(
    `[session] new session for "${name ?? userId}" (${reason}), ` +
      `${previous.n} earlier session(s)${since}`,
  );

  return token;
}

export async function deleteSession(request: Request): Promise<void> {
  const cookieHeader = request.headers.get("Cookie");
  const token = await sessionCookie.parse(cookieHeader);
  if (!token || typeof token !== "string") return;

  const db = getDb();
  // Read before deleting: afterwards there is nothing left to say who it was,
  // and "did they log out or did we lose it?" is the whole question.
  const row = db
    .prepare(
      `SELECT u.name FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.session_token = ?`
    )
    .get(token) as { name: string | null } | undefined;

  const info = db.prepare("DELETE FROM user_sessions WHERE session_token = ?").run(token);
  if (info.changes > 0) {
    console.log(`[session] "${row?.name ?? "unknown"}" logged out`);
  }
}
