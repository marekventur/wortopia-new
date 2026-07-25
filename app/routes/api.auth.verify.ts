import { data } from "react-router";
import type { Route } from "./+types/api.auth.verify";
import { hashCode, signVerifyToken } from "../../lib/auth.js";
import { createSession, sessionCookie } from "../../lib/session.js";
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

  // Reject only once the previous attempts have already used up the allowance,
  // so the MAX_ATTEMPTS'th try still gets checked rather than being discarded.
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
    return data({ error: "Zu viele Fehlversuche. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  // Verify code
  const submitted = hashCode(code);
  if (submitted !== row.code_hash) {
    const newAttempts = row.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
      return data({ error: "Zu viele Fehlversuche. Bitte fordere einen neuen Code an." }, { status: 400 });
    }
    db.prepare("UPDATE email_codes SET attempts = ? WHERE email = ?").run(newAttempts, email);
    return data({ error: "Falscher Code. Bitte versuche es erneut." }, { status: 400 });
  }

  // Code correct — delete it (single-use)
  db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);

  // Which accounts sit behind this address? Usually one, but accounts imported
  // from the old site can share an address — it keyed login on username +
  // password and only used email for recovery, so several accounts per address
  // were normal. Those have to stay reachable, hence .all() rather than .get().
  const users = db
    .prepare(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM user_results r WHERE r.user_id = u.id)   AS games,
              (SELECT MAX(r.finished) FROM user_results r WHERE r.user_id = u.id) AS last_played
       FROM users u
       JOIN user_emails e ON e.user_id = u.id
       WHERE e.email = ?
       ORDER BY last_played DESC, games DESC`
    )
    .all(email) as Array<{ id: number; name: string; games: number; last_played: string | null }>;

  if (users.length === 0) {
    // New user — return a signed verify token
    const verifyToken = signVerifyToken(email);
    return data({ type: "new", verifyToken });
  }

  if (users.length > 1) {
    // Let the person say which account they want. The verify token is what
    // proves they control the address; api/auth/select checks the chosen
    // account actually belongs to it.
    return data({
      type: "choose",
      verifyToken: signVerifyToken(email),
      accounts: users.map(u => ({
        id: u.id,
        name: u.name,
        games: u.games,
        lastPlayed: u.last_played,
      })),
    });
  }

  const cookieHeader = await sessionCookie.serialize(await createSession(users[0].id));
  return data({ type: "existing" }, { headers: { "Set-Cookie": cookieHeader } });
}
