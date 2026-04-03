import crypto from "crypto";
import { createCookie } from "react-router";
import { getDb } from "./db.js";
import { generateSessionToken, sessionExpiry } from "./auth.js";

const GUEST_SECRET = process.env.GUEST_TOKEN_SECRET ?? "7515641e-35a4-4773-9326-0b7cf3edf9ec";

export const sessionCookie = createCookie("wortopia_session", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
  secrets: [process.env.COOKIE_SECRET ?? "7515641e-35a4-4773-9326-0b7cf3edf9ec"],
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

  const guestId = parseInt(parts[1], 10);
  if (isNaN(guestId) || guestId < 0 || guestId > 100_000) return null;

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

  return row ? { type: "user", user: row } : null;
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

  const guestId = Math.floor(Math.random() * 100_001);
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
