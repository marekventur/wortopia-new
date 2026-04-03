import { data } from "react-router";
import type { Route } from "./+types/api.auth.verify";
import { hashCode, signVerifyToken, generateSessionToken, sessionExpiry } from "../../lib/auth.js";
import { sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

const MAX_ATTEMPTS = 5;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const code = String(form.get("code") ?? "").trim();

  if (!email || !code) {
    return data({ error: "Email und Code sind erforderlich." }, { status: 400 });
  }

  const db = getDb();

  const row = db
    .prepare("SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?")
    .get(email) as { code_hash: string; expires_at: string; attempts: number } | undefined;

  if (!row) {
    return data({ error: "Kein Code gefunden. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  // Check expiry
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
    return data({ error: "Der Code ist abgelaufen. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  // Increment attempt count
  const newAttempts = row.attempts + 1;
  if (newAttempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
    return data({ error: "Zu viele Fehlversuche. Bitte fordere einen neuen Code an." }, { status: 400 });
  }
  db.prepare("UPDATE email_codes SET attempts = ? WHERE email = ?").run(newAttempts, email);

  // Verify code
  const submitted = hashCode(code);
  if (submitted !== row.code_hash) {
    return data({ error: "Falscher Code. Bitte versuche es erneut." }, { status: 400 });
  }

  // Code correct — delete it (single-use)
  db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);

  // Check if user exists for this email
  const user = db
    .prepare(
      `SELECT u.id FROM users u
       JOIN user_emails e ON e.user_id = u.id
       WHERE e.email = ?`
    )
    .get(email) as { id: number } | undefined;

  if (user) {
    // Existing user — create session
    const token = generateSessionToken();
    const validUntil = sessionExpiry();
    db.prepare(
      "INSERT INTO user_sessions (user_id, session_token, valid_until) VALUES (?, ?, ?)"
    ).run(user.id, token, validUntil);
    const cookieHeader = await sessionCookie.serialize(token);
    return data({ type: "existing" }, { headers: { "Set-Cookie": cookieHeader } });
  } else {
    // New user — return a signed verify token
    const verifyToken = signVerifyToken(email);
    return data({ type: "new", verifyToken });
  }
}
