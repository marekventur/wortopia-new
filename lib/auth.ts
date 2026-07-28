import crypto from "crypto";
import { secret } from "./secrets.js";

const VERIFY_TOKEN_SECRET = secret("VERIFY_TOKEN_SECRET");
const VERIFY_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Renders an address for the log: enough to match against a support email,
 * without writing everyone's address to disk in full. "elisabeth@x.de" becomes
 * "el****th@x.de".
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 4) return `${local[0]}***${domain}`;
  return `${local.slice(0, 2)}****${local.slice(-2)}${domain}`;
}

/** Compares two login codes without leaking their difference through timing. */
export function codesMatch(submitted: string, stored: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(stored);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Signs a verify token proving ownership of an email address. Valid for 10 minutes. */
export function signVerifyToken(email: string): string {
  const exp = Date.now() + VERIFY_TOKEN_TTL_MS;
  const payload = `${email}:${exp}`;
  const hmac = crypto.createHmac("sha256", VERIFY_TOKEN_SECRET).update(payload).digest("base64url");
  return Buffer.from(`${payload}:${hmac}`).toString("base64url");
}

/** Verifies a verify token. Returns the email address if valid, null otherwise. */
export function verifyVerifyToken(token: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }

  // Format: email:exp:hmac — email may contain ':', so split from the right
  const lastColon = decoded.lastIndexOf(":");
  const secondLastColon = decoded.lastIndexOf(":", lastColon - 1);
  if (lastColon === -1 || secondLastColon === -1) return null;

  const hmac = decoded.slice(lastColon + 1);
  const payload = decoded.slice(0, lastColon);
  const exp = parseInt(decoded.slice(secondLastColon + 1, lastColon), 10);

  if (isNaN(exp) || Date.now() > exp) return null;

  const expected = crypto.createHmac("sha256", VERIFY_TOKEN_SECRET).update(payload).digest("base64url");
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const hmacBuf = Buffer.from(hmac);
  const expectedBuf = Buffer.from(expected);
  if (hmacBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;

  const email = payload.slice(0, secondLastColon);
  return email || null;
}

/** Generates a session token. */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/** How long a session stays valid after it was last used. */
export const SESSION_TTL_DAYS = 30;

/**
 * Sessions are rolling: `valid_until` is pushed forward on use (see getSession),
 * so a session only expires after SESSION_TTL_DAYS of *inactivity*. To avoid a
 * write on every single request, it's only extended once it drops below this
 * much remaining — i.e. at most once a day per session.
 */
export const SESSION_REFRESH_BELOW_DAYS = SESSION_TTL_DAYS - 1;

function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/** Returns a SQLite-compatible timestamp N days from now. */
export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return sqliteTimestamp(d);
}

/** Returns a SQLite-compatible timestamp for a fresh session's valid_until. */
export function sessionExpiry(): string {
  return daysFromNow(SESSION_TTL_DAYS);
}

/** Returns a SQLite-compatible timestamp for N minutes from now. */
export function expiryMinutes(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
