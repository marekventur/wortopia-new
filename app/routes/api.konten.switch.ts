import { data } from "react-router";
import type { Route } from "./+types/api.konten.switch";
import { getSessionUser, createSession, sessionCookie } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

/**
 * Signs in as another account on the same address, without going through the
 * email code again.
 *
 * The account id arrives from the client, so it MUST be re-checked server-side
 * against an address the caller has already proven — here, the one on the
 * current session. Without that check, anyone signed in anywhere could switch
 * into any account by id.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await getSessionUser(request);
  if (!user) {
    return data({ error: "Bitte melde dich an." }, { status: 401 });
  }
  if (!user.email) {
    return data({ error: "Zu deinem Konto ist keine Email-Adresse hinterlegt." }, { status: 400 });
  }

  const form = await request.formData();
  const userId = Number(form.get("userId"));
  if (!Number.isInteger(userId)) {
    return data({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  if (userId === user.id) {
    return data({ ok: true });
  }

  const owns = getDb()
    .prepare("SELECT 1 FROM user_emails WHERE user_id = ? AND email = ?")
    .get(userId, user.email);

  if (!owns) {
    return data({ error: "Dieses Konto gehört nicht zu deiner Email-Adresse." }, { status: 403 });
  }

  const cookieHeader = await sessionCookie.serialize(await createSession(userId));
  return data({ ok: true }, { headers: { "Set-Cookie": cookieHeader } });
}
