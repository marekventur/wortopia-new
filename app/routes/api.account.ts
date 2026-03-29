import { data } from "react-router";
import type { Route } from "./+types/api.account";
import { getSessionUser } from "../../lib/session.js";
import { hashPassword, verifyPassword } from "../../lib/auth.js";
import { getDb } from "../../lib/db.js";

export async function action({ request }: Route.ActionArgs) {
  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Nicht eingeloggt." }, { status: 401 });
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const team = String(form.get("team") ?? "").trim() || null;
  const email = String(form.get("email") ?? "").trim().toLowerCase() || null;
  const password1 = String(form.get("password1") ?? "");
  const password2 = String(form.get("password2") ?? "");

  if (password1 || password2) {
    if (password1 !== password2) {
      return data({ error: "Passwörter stimmen nicht überein." }, { status: 400 });
    }
    if (password1.length < 6) {
      return data({ error: "Passwort muss mindestens 6 Zeichen lang sein." }, { status: 400 });
    }
  }

  const db = getDb();

  // Check name uniqueness if changed
  if (name && name.toLowerCase() !== user.name.toLowerCase()) {
    const existing = db.prepare("SELECT id FROM users WHERE name = ? AND id != ? COLLATE NOCASE").get(name, user.id);
    if (existing) {
      return data({ error: "Dieser Name ist bereits vergeben." }, { status: 409 });
    }
  }

  // Check email uniqueness if changed
  if (email && email !== user.email) {
    const existing = db.prepare("SELECT user_id FROM user_emails WHERE email = ? AND user_id != ?").get(email, user.id);
    if (existing) {
      return data({ error: "Diese Email-Adresse ist bereits registriert." }, { status: 409 });
    }
  }

  try {
    db.transaction(() => {
      if (name) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
      }
      db.prepare("UPDATE users SET team = ? WHERE id = ?").run(team, user.id);

      if (email) {
        db.prepare(`
          INSERT INTO user_emails (user_id, email) VALUES (?, ?)
          ON CONFLICT (user_id) DO UPDATE SET email = excluded.email
        `).run(user.id, email);
      }

      if (password1) {
        // We can't await inside a transaction, so we'll handle this outside
      }
    })();

    if (password1) {
      const pwHash = await hashPassword(password1);
      db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(pwHash, user.id);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("CHECK")) {
      return data(
        { error: "Name ungültig (4–15 Zeichen, nicht 'guest_...')" },
        { status: 400 }
      );
    }
    throw err;
  }

  return data({ ok: true });
}
