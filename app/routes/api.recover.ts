import { data, redirect } from "react-router";
import type { Route } from "./+types/api.recover";
import { createResetToken, verifyResetToken } from "../../lib/resetToken.js";
import { sendRecoveryEmail } from "../../lib/mailgun.js";
import { createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

/** GET /api/recover?token=... — verify token, create session, redirect home */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return redirect("/?error=invalid_token");
  }

  const db = getDb();

  // We don't know the user yet; scan approach: decode token to get userId first
  // Token format (base64url): userId.timestamp.hmac
  let userId: number;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) throw new Error("bad format");
    userId = parseInt(parts[0], 10);
    if (isNaN(userId)) throw new Error("bad userId");
  } catch {
    return redirect("/?error=invalid_token");
  }

  const user = db
    .prepare("SELECT id, pw_hash FROM users WHERE id = ?")
    .get(userId) as { id: number; pw_hash: string } | undefined;

  if (!user) return redirect("/?error=invalid_token");

  const verified = verifyResetToken(token, user.pw_hash);
  if (!verified) return redirect("/?error=invalid_token");

  const sessionToken = await createSession(user.id);
  const cookieHeader = await sessionCookie.serialize(sessionToken);

  return redirect("/", { headers: { "Set-Cookie": cookieHeader } });
}

/** POST /api/recover — send recovery email */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return data({ error: "Email-Adresse ist erforderlich." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      "SELECT u.id, u.name, u.pw_hash FROM users u JOIN user_emails e ON e.user_id = u.id WHERE e.email = ?"
    )
    .get(email) as { id: number; name: string; pw_hash: string } | undefined;

  // Always return success to avoid user enumeration
  if (!row) {
    return data({ ok: true });
  }

  const siteUrl = process.env.SITE_URL ?? "http://localhost:3005";
  const resetToken = createResetToken(row.id, row.pw_hash);
  const resetLink = `${siteUrl}/api/recover?token=${resetToken}`;

  try {
    await sendRecoveryEmail(email, row.name, resetLink, siteUrl);
  } catch (err) {
    console.error("[recover] Failed to send email:", err);
    // Still return success to avoid enumeration
  }

  return data({ ok: true });
}
