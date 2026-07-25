import { data } from "react-router";
import type { Route } from "./+types/api.auth.select";
import { verifyVerifyToken } from "../../lib/auth.js";
import { createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

/**
 * Logs in as one of several accounts sharing an email address.
 *
 * The verify token is the proof of address ownership — it is only handed out
 * by api/auth/verify after a correct OTP. The account id arrives from the
 * client, so it is re-checked against the token's address here; otherwise
 * anyone holding a token for their own address could log into any account.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const verifyToken = String(form.get("verifyToken") ?? "").trim();
  const userId = Number(form.get("userId"));

  if (!verifyToken || !Number.isInteger(userId)) {
    return data({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const email = verifyVerifyToken(verifyToken);
  if (!email) {
    return data(
      { error: "Die Anmeldung ist abgelaufen. Bitte starte den Vorgang erneut." },
      { status: 400 },
    );
  }

  const owns = getDb()
    .prepare("SELECT 1 FROM user_emails WHERE user_id = ? AND email = ?")
    .get(userId, email);

  if (!owns) {
    return data({ error: "Dieses Konto gehört nicht zu dieser Email-Adresse." }, { status: 403 });
  }

  const cookieHeader = await sessionCookie.serialize(await createSession(userId));
  return data({ ok: true }, { headers: { "Set-Cookie": cookieHeader } });
}
