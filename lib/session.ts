import crypto from "crypto";
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

  if (!row) return null;

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

export async function createSession(userId: number): Promise<string> {
  const db = getDb();
  const token = generateSessionToken();
  const validUntil = sessionExpiry();

  db.prepare(
    "INSERT INTO user_sessions (user_id, session_token, valid_until) VALUES (?, ?, ?)"
  ).run(userId, token, validUntil);

  return token;
}

export async function deleteSession(request: Request): Promise<void> {
  const cookieHeader = request.headers.get("Cookie");
  const token = await sessionCookie.parse(cookieHeader);
  if (!token || typeof token !== "string") return;

  const db = getDb();
  db.prepare("DELETE FROM user_sessions WHERE session_token = ?").run(token);
}
