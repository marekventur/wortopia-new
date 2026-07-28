import { data } from "react-router";
import type { Route } from "./+types/api.auth.verify";
import { codesMatch, signVerifyToken, maskEmail } from "../../lib/auth.js";
import { createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

const MAX_ATTEMPTS = 5;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  // Keep only the digits. The code is rendered with letter-spacing in the
  // email, so people transcribe it as "012 345" and some clients copy it that
  // way too — trimming the ends isn't enough, and a mismatch here reads to the
  // player as "the code is wrong" when they typed exactly what they were sent.
  const raw = String(form.get("code") ?? "");
  const code = raw.replace(/\D/g, "");

  // Never log the code or its hash — the log would become a way in. Shape only:
  // how it was formatted, and how far off the length was.
  const shape =
    `${code.length} digits` +
    (raw.trim().length !== code.length ? `, ${raw.trim().length - code.length} non-digit char(s)` : "");
  const who = maskEmail(email);

  if (!email || !code) {
    console.log(`[auth] ${who} verify rejected: no code submitted (${shape})`);
    return data({ error: "Email und Code sind erforderlich." }, { status: 400 });
  }

  const db = getDb();

  const row = db
    .prepare("SELECT code, prev_code, sent_at, expires_at, attempts FROM email_codes WHERE email = ?")
    .get(email) as
      | { code: string; prev_code: string | null; sent_at: string; expires_at: string; attempts: number }
      | undefined;

  if (!row) {
    console.log(`[auth] ${who} verify failed: no code on file (already used, expired, or never requested)`);
    return data({ error: "Kein Code gefunden. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  const ageSeconds = Math.round((Date.now() - new Date(row.sent_at).getTime()) / 1000);

  // Check expiry
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
    console.log(`[auth] ${who} verify failed: code expired (last sent ${ageSeconds}s ago)`);
    return data({ error: "Der Code ist abgelaufen. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  // Reject only once the previous attempts have already used up the allowance,
  // so the MAX_ATTEMPTS'th try still gets checked rather than being discarded.
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
    console.log(`[auth] ${who} verify failed: attempt allowance already used up`);
    return data({ error: "Zu viele Fehlversuche. Bitte fordere einen neuen Code an." }, { status: 400 });
  }

  // Verify code
  if (!codesMatch(code, row.code)) {
    // The single most useful thing to know: was this the code from an earlier
    // email? Only ever compared for the log — a superseded code never logs you
    // in. Since a live code is now resent rather than replaced, this can only
    // mean the email predates an expiry, not merely a "Code erneut senden".
    const superseded = row.prev_code !== null && codesMatch(code, row.prev_code);
    const why = superseded
      ? "code from an EARLIER email (the one it replaced had expired)"
      : `code did not match (${shape}, last sent ${ageSeconds}s ago)`;
    console.log(`[auth] ${who} verify failed: ${why}, attempt ${row.attempts + 1}/${MAX_ATTEMPTS}`);

    const newAttempts = row.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
      return data({ error: "Zu viele Fehlversuche. Bitte fordere einen neuen Code an." }, { status: 400 });
    }
    db.prepare("UPDATE email_codes SET attempts = ? WHERE email = ?").run(newAttempts, email);
    // Several emails now normally carry the same code, so "take the newest one"
    // is no longer the whole story — the only way to hold a dead code is for it
    // to have expired in between. Say that instead.
    return data(
      {
        error:
          "Falscher Code. Nimm den Code aus der neuesten Email — " +
          "ältere Codes verfallen nach 10 Minuten.",
      },
      { status: 400 },
    );
  }

  // Code correct — delete it (single-use)
  db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);

  // Which accounts sit behind this address? Usually one, but accounts imported
  // from the old site can share an address — it keyed login on username +
  // password and only used email for recovery, so several accounts per address
  // were normal. Those have to stay reachable, hence .all() rather than .get().
  //
  // Ordered by last use, because the first row is the one we log in as. "Use"
  // is the later of a finished round and a login: someone who signed in as an
  // account but did not finish a round still used it most recently.
  const users = db
    .prepare(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM user_results r WHERE r.user_id = u.id)   AS games,
              (SELECT MAX(r.finished) FROM user_results r WHERE r.user_id = u.id) AS last_played,
              MAX(
                COALESCE((SELECT MAX(r.finished)    FROM user_results  r WHERE r.user_id = u.id), ''),
                COALESCE((SELECT MAX(s.created_at)  FROM user_sessions s WHERE s.user_id = u.id), '')
              ) AS last_used
       FROM users u
       JOIN user_emails e ON e.user_id = u.id
       WHERE e.email = ?
         AND u.hidden_at IS NULL
       ORDER BY last_used DESC, games DESC`
    )
    .all(email) as Array<{ id: number; name: string; games: number; last_played: string | null }>;

  console.log(
    `[auth] ${who} code accepted ${ageSeconds}s after it was last sent, ${row.attempts} earlier failed attempt(s) ` +
      `-> ${users.length === 0 ? "no account (offering signup)" : users.length === 1 ? "1 account" : users.length + " accounts (picker)"}`,
  );

  if (users.length === 0) {
    // New user — return a signed verify token
    const verifyToken = signVerifyToken(email);
    return data({ type: "new", verifyToken });
  }

  // Always sign in as the most recently used account, even when several share
  // the address. Picking one from a list was a whole extra step and a whole
  // extra page, and it could only ever do less than /konten, which also
  // switches, hides and claims. When there is more than one, the client sends
  // them there instead of into the game, so they land somewhere that says which
  // account they are on and lets them change it in one click.
  //
  // Hidden accounts are excluded above, so tidying up once means never seeing
  // this detour again.
  const cookieHeader = await sessionCookie.serialize(await createSession(users[0].id));
  return data(
    { type: "existing", multiple: users.length > 1 },
    { headers: { "Set-Cookie": cookieHeader } },
  );
}
