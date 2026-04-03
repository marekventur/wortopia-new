import crypto from "crypto";

const VERIFY_TOKEN_SECRET = process.env.VERIFY_TOKEN_SECRET ?? "7515641e-35a4-4773-9326-0b7cf3edf9ec";
const VERIFY_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Hashes a 6-digit OTP code with SHA-256, returns hex string. */
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
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
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;

  const email = payload.slice(0, secondLastColon);
  return email || null;
}

/** Generates a session token. */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/** Returns a SQLite-compatible timestamp for 30 days from now, for use as valid_until. */
export function sessionExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/** Returns a SQLite-compatible timestamp for N minutes from now. */
export function expiryMinutes(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
