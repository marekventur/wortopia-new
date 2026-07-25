import { data } from "react-router";
import type { Route } from "./+types/api.auth.register";
import { verifyVerifyToken, generateSessionToken, sessionExpiry } from "../../lib/auth.js";
import { sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const verifyToken = String(form.get("verifyToken") ?? "").trim();
  const username = String(form.get("username") ?? "").trim();

  if (!verifyToken || !username) {
    return data({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const email = verifyVerifyToken(verifyToken);
  if (!email) {
    return data({ error: "Der Verifizierungslink ist abgelaufen. Bitte starte den Vorgang erneut." }, { status: 400 });
  }

  if (username.length < 4 || username.length > 15) {
    return data({ error: "Der Name muss zwischen 4 und 15 Zeichen lang sein." }, { status: 400 });
  }
  if (/\s/.test(username)) {
    return data({ error: "Der Name darf keine Leerzeichen enthalten." }, { status: 400 });
  }
  if (/^guest_/i.test(username)) {
    return data({ error: "Dieser Name ist nicht erlaubt." }, { status: 400 });
  }

  const db = getDb();

  // Check username uniqueness
  const existing = db.prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE").get(username);
  if (existing) {
    return data({ error: "Dieser Name ist bereits vergeben." }, { status: 409 });
  }

  // Check email not already registered (race condition guard)
  const emailTaken = db
    .prepare("SELECT user_id FROM user_emails WHERE email = ?")
    .get(email);
  if (emailTaken) {
    return data({ error: "Diese Email-Adresse ist bereits registriert." }, { status: 409 });
  }

  const token = generateSessionToken();
  const validUntil = sessionExpiry();

  // All three rows or none. A user without a user_emails row can never log in
  // again — there'd be no address to send a code to — so this must not be able
  // to half-succeed.
  const createAccount = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO users (name, pw_hash) VALUES (?, NULL)")
      .run(username) as { lastInsertRowid: number | bigint };
    const userId = Number(result.lastInsertRowid);

    db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").run(userId, email);
    db.prepare(
      "INSERT INTO user_sessions (user_id, session_token, valid_until) VALUES (?, ?, ?)"
    ).run(userId, token, validUntil);
  });

  try {
    createAccount();
  } catch (err: unknown) {
    // The name and email uniqueness checks above can lose a race; the database
    // constraints are the real guard, so turn them into the same 409.
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE") && msg.includes("user_emails")) {
      return data({ error: "Diese Email-Adresse ist bereits registriert." }, { status: 409 });
    }
    if (msg.includes("UNIQUE") && msg.includes("users.name")) {
      return data({ error: "Dieser Name ist bereits vergeben." }, { status: 409 });
    }
    throw err;
  }

  const cookieHeader = await sessionCookie.serialize(token);
  return data({ ok: true }, { headers: { "Set-Cookie": cookieHeader } });
}
