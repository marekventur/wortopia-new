import { data } from "react-router";
import type { Route } from "./+types/api.auth.request";
import { hashCode, expiryMinutes } from "../../lib/auth.js";
import { sendOtpEmail } from "../../lib/mailgun.js";
import { getDb } from "../../lib/db.js";

const RATE_LIMIT_SECONDS = 60;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return data({ error: "Bitte gib eine gültige Email-Adresse ein." }, { status: 400 });
  }

  const db = getDb();

  // Rate limit: check if a code was sent within the last 60 seconds
  const existing = db
    .prepare("SELECT created_at FROM email_codes WHERE email = ?")
    .get(email) as { created_at: string } | undefined;

  if (existing) {
    const sentAt = new Date(existing.created_at).getTime();
    const secondsAgo = (Date.now() - sentAt) / 1000;
    if (secondsAgo < RATE_LIMIT_SECONDS) {
      const waitSeconds = Math.ceil(RATE_LIMIT_SECONDS - secondsAgo);
      return data(
        { error: `Bitte warte noch ${waitSeconds} Sekunden, bevor du einen neuen Code anforderst.` },
        { status: 429 }
      );
    }
  }

  const code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  const codeHash = hashCode(code);
  const expiresAt = expiryMinutes(10);

  db.prepare(`
    INSERT INTO email_codes (email, code_hash, expires_at, attempts)
    VALUES (?, ?, ?, 0)
    ON CONFLICT (email) DO UPDATE SET
      code_hash  = excluded.code_hash,
      created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      expires_at = excluded.expires_at,
      attempts   = 0
  `).run(email, codeHash, expiresAt);

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

  return data({ ok: true });
}
