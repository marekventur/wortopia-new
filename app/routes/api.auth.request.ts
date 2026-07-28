import { data } from "react-router";
import type { Route } from "./+types/api.auth.request";
import { expiryMinutes, maskEmail } from "../../lib/auth.js";
import { sendOtpEmail } from "../../lib/mailgun.js";
import { getDb } from "../../lib/db.js";

const RATE_LIMIT_SECONDS = 60;
/** Counted from the last time the code was emailed, not from when it was made. */
const CODE_TTL_MINUTES = 10;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return data({ error: "Bitte gib eine gültige Email-Adresse ein." }, { status: 400 });
  }

  const db = getDb();

  // Login on the old site was player name + password, so the name is what
  // people reach for first. The field used to be type="email", which meant the
  // browser refused to submit "asteramie" and nothing ever reached the server —
  // the only trace it left anywhere was the occasional "gibt es da noch einen
  // Zugang?" email. Those attempts now arrive here, get counted, and are told
  // what to type instead.
  if (!email.includes("@")) {
    // Only log the name when it belongs to a real account: then the line says
    // who is locked out and which address their code would go to, which is
    // worth acting on. Anything else is unidentified text typed into a login
    // form — it could be a password — and stays out of the log.
    const account = db
      .prepare(
        `SELECT u.name, e.email
         FROM users u
         LEFT JOIN user_emails e ON e.user_id = u.id
         WHERE u.name = ? COLLATE NOCASE`
      )
      .get(email) as { name: string; email: string | null } | undefined;

    console.log(
      account
        ? `[auth] player name "${account.name}" entered instead of an email address ` +
            `(that account is on ${account.email ? maskEmail(account.email) : "no address"})`
        : `[auth] not an email address, and no account by that name (${email.length} chars)`
    );

    // Worded the same either way: saying which names exist would turn this into
    // a way to enumerate accounts.
    return data(
      {
        error:
          "Bitte benutze deine Email-Adresse, nicht deinen Spielernamen — " +
          "wir schicken dir einen Code dorthin.",
      },
      { status: 400 }
    );
  }

  const existing = db
    .prepare("SELECT code, sent_at, expires_at, attempts FROM email_codes WHERE email = ?")
    .get(email) as
    | { code: string; sent_at: string; expires_at: string; attempts: number }
    | undefined;

  // Rate limit: at most one email a minute, however many times the button is
  // pressed. The client disables it for the same minute; this is what makes it
  // true.
  if (existing) {
    const secondsAgo = (Date.now() - new Date(existing.sent_at).getTime()) / 1000;
    if (secondsAgo < RATE_LIMIT_SECONDS) {
      const waitSeconds = Math.ceil(RATE_LIMIT_SECONDS - secondsAgo);
      console.log(`[auth] ${maskEmail(email)} rate-limited, ${waitSeconds}s left`);
      return data(
        { error: `Bitte warte noch ${waitSeconds} Sekunden, bevor du einen neuen Code anforderst.` },
        { status: 429 }
      );
    }
  }

  const stillValid = existing !== undefined && new Date(existing.expires_at).getTime() > Date.now();
  const expiresAt = expiryMinutes(CODE_TTL_MINUTES);
  let code: string;

  if (stillValid) {
    // Send the same code again rather than a new one. Mail takes as long as it
    // takes, so by the time someone gives up waiting and presses the button, the
    // first email is usually about to arrive — and if that press invalidated the
    // code inside it, they type six correct digits and are told they are wrong.
    // Nothing about which email they open matters now: every one of them says
    // the same thing, and it stays alive for as long as they keep asking.
    code = existing!.code;
    db.prepare(
      `UPDATE email_codes
       SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), expires_at = ?
       WHERE email = ?`
    ).run(expiresAt, email);
    console.log(
      `[auth] ${maskEmail(email)} same code sent again ` +
        `(${existing!.attempts} failed attempt(s) against it so far)`,
    );
  } else {
    code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    db.prepare(`
      INSERT INTO email_codes (email, code, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      ON CONFLICT (email) DO UPDATE SET
        -- Only reached once the previous code has expired, since a live one is
        -- resent above. Kept so a later failure can be identified as "used the
        -- code from an older email" rather than guessed at.
        prev_code  = email_codes.code,
        code       = excluded.code,
        sent_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        expires_at = excluded.expires_at,
        attempts   = 0
    `).run(email, code, expiresAt);

    if (existing) {
      const age = Math.round((Date.now() - new Date(existing.sent_at).getTime()) / 1000);
      console.log(
        `[auth] ${maskEmail(email)} new code issued, the previous one expired ` +
          `(last sent ${age}s ago, ${existing.attempts} failed attempt(s) against it)`,
      );
    } else {
      console.log(`[auth] ${maskEmail(email)} new code issued`);
    }
  }

  const siteUrl = process.env.SITE_URL ?? "http://localhost:3005";
  try {
    await sendOtpEmail(email, code, siteUrl);
  } catch (err) {
    console.error("[auth/request] Failed to send OTP email:", err);
    // Still return success to avoid enumeration, but in dev log the code
    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] OTP code for ${email}: ${code}`);
    }
  }

  // `resent` lets the page say "same code again" instead of implying the email
  // in front of them just went stale.
  return data({ ok: true, resent: stillValid });
}
