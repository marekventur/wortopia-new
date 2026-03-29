import crypto from "crypto";

const SECRET = process.env.RESET_TOKEN_SECRET ?? "dev-reset-secret-change-me";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Creates an HMAC-signed reset token.
 * Format: `<userId>.<timestamp>.<hmac>`
 * The token is self-contained — no DB storage needed.
 * It is invalidated when the password changes because pw_hash is included in the HMAC.
 */
export function createResetToken(userId: number, pwHash: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}.${ts}`;
  const hmac = sign(payload, pwHash);
  return Buffer.from(`${payload}.${hmac}`).toString("base64url");
}

/**
 * Verifies a reset token. Returns the userId if valid, null otherwise.
 */
export function verifyResetToken(
  token: string,
  pwHash: string
): number | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) return null;

  const [userIdStr, ts, hmac] = parts;
  const payload = `${userIdStr}.${ts}`;

  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sign(payload, pwHash)))) {
    return null;
  }

  const timestamp = parseInt(ts, 10);
  if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_TTL_MS) {
    return null;
  }

  return parseInt(userIdStr, 10);
}

function sign(payload: string, pwHash: string): string {
  return crypto
    .createHmac("sha256", SECRET + pwHash)
    .update(payload)
    .digest("base64url");
}
