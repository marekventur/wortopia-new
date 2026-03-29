import { data } from "react-router";
import type { Route } from "./+types/api.login";
import { verifyPassword } from "../../lib/auth.js";
import { createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!username || !password) {
    return data({ error: "Name und Passwort sind erforderlich." }, { status: 400 });
  }

  const db = getDb();

  // Allow login by name or email
  let user = db
    .prepare("SELECT id, pw_hash FROM users WHERE name = ? COLLATE NOCASE")
    .get(username) as { id: number; pw_hash: string } | undefined;

  if (!user) {
    const emailRow = db
      .prepare(
        "SELECT u.id, u.pw_hash FROM users u JOIN user_emails e ON e.user_id = u.id WHERE e.email = ?"
      )
      .get(username.toLowerCase()) as { id: number; pw_hash: string } | undefined;
    user = emailRow;
  }

  if (!user) {
    return data({ error: "Ungültiger Name oder Passwort." }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.pw_hash);
  if (!valid) {
    return data({ error: "Ungültiger Name oder Passwort." }, { status: 401 });
  }

  const token = await createSession(user.id);
  const cookieHeader = await sessionCookie.serialize(token);

  return data(
    { ok: true },
    { headers: { "Set-Cookie": cookieHeader } }
  );
}
