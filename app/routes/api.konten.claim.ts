import { data } from "react-router";
import type { Route } from "./+types/api.konten.claim";
import { getSessionUser } from "../../lib/session.js";
import { claimAccount } from "../../lib/claims.js";

/**
 * Moves an imported account onto the signed-in user's address, given its old
 * password.
 *
 * The target address comes from the session, never from the form — otherwise
 * this would let anyone move any account anywhere.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Bitte melde dich an." }, { status: 401 });
  }
  if (!user.email) {
    return data(
      { error: "Zu deinem Konto ist keine Email-Adresse hinterlegt." },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!username || !password) {
    return data({ error: "Name und Passwort sind erforderlich." }, { status: 400 });
  }

  const result = await claimAccount(username, password, user.email);
  if (!result.ok) {
    return data({ error: result.error }, { status: result.status });
  }

  return data({ ok: true, username: result.username });
}
