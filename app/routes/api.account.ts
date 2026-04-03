import { data } from "react-router";
import type { Route } from "./+types/api.account";
import { getSessionUser } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

export async function action({ request }: Route.ActionArgs) {
  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Nicht eingeloggt." }, { status: 401 });
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const team = String(form.get("team") ?? "").trim() || null;
  const db = getDb();

  // Check name uniqueness if changed
  if (name && name.toLowerCase() !== user.name.toLowerCase()) {
    const existing = db.prepare("SELECT id FROM users WHERE name = ? AND id != ? COLLATE NOCASE").get(name, user.id);
    if (existing) {
      return data({ error: "Dieser Name ist bereits vergeben." }, { status: 409 });
    }
  }

  try {
    db.transaction(() => {
      if (name) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
      }
      db.prepare("UPDATE users SET team = ? WHERE id = ?").run(team, user.id);
    })();
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
