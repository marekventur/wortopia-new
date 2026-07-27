import { data } from "react-router";
import type { Route } from "./+types/api.konten.hide";
import { getSessionUser } from "../../lib/session.js";
import { setAccountHidden, accountsForEmail } from "../../lib/claims.js";

/**
 * Hides a nick from the login picker, or brings it back.
 *
 * Deliberately not a delete: user_results cascades, so deleting would destroy
 * the account's entire round history, and several tables carry a user_id with
 * no foreign key and would be left pointing at nothing.
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
  const hidden = String(form.get("hidden") ?? "") === "true";

  if (!Number.isInteger(userId)) {
    return data({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  // Hiding the account you are signed in as would leave you unable to pick it
  // again at the next login.
  if (hidden && userId === user.id) {
    return data(
      { error: "Du kannst das Konto, mit dem du gerade angemeldet bist, nicht ausblenden." },
      { status: 400 },
    );
  }

  // Never hide the last visible nick, or the address stops offering anything.
  if (hidden) {
    const visible = accountsForEmail(user.email).filter((a) => !a.hidden);
    if (visible.length <= 1) {
      return data({ error: "Mindestens ein Konto muss sichtbar bleiben." }, { status: 400 });
    }
  }

  if (!setAccountHidden(userId, user.email, hidden)) {
    return data({ error: "Dieses Konto gehört nicht zu deiner Email-Adresse." }, { status: 403 });
  }

  return data({ ok: true });
}
