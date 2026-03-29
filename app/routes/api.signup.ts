import { data } from "react-router";
import type { Route } from "./+types/api.signup";
import { hashPassword } from "../../lib/auth.js";
import { createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password1 = String(form.get("password1") ?? "");
  const password2 = String(form.get("password2") ?? "");

  if (!username || !email || !password1 || !password2) {
    return data({ error: "Alle Felder sind erforderlich." }, { status: 400 });
  }
  if (password1 !== password2) {
    return data({ error: "Passwörter stimmen nicht überein." }, { status: 400 });
  }
  if (password1.length < 6) {
    return data({ error: "Passwort muss mindestens 6 Zeichen lang sein." }, { status: 400 });
  }

  const db = getDb();

  const existingUser = db
    .prepare("SELECT id FROM users WHERE name = ? COLLATE NOCASE")
    .get(username);
  if (existingUser) {
    return data({ error: "Dieser Name ist bereits vergeben." }, { status: 409 });
  }

  const existingEmail = db
    .prepare("SELECT user_id FROM user_emails WHERE email = ?")
    .get(email.toLowerCase());
  if (existingEmail) {
    return data({ error: "Diese Email-Adresse ist bereits registriert." }, { status: 409 });
  }

  let userId: number;
  try {
    const pwHash = await hashPassword(password1);
    const result = db
      .prepare("INSERT INTO users (name, pw_hash) VALUES (?, ?)")
      .run(username, pwHash);
    userId = result.lastInsertRowid as number;
    db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").run(
      userId,
      email.toLowerCase()
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("CHECK")) {
      return data(
        { error: "Name ungültig (4–15 Zeichen, keine Leerzeichen, nicht 'guest_...')" },
        { status: 400 }
      );
    }
    throw err;
  }

  const token = await createSession(userId);
  const cookieHeader = await sessionCookie.serialize(token);

  return data(
    { ok: true },
    { headers: { "Set-Cookie": cookieHeader } }
  );
}
