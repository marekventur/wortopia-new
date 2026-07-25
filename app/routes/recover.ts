import { redirect } from "react-router";

/**
 * The old site emailed password-reset links of the form /recover?t=<token>.
 * Those tokens mean nothing here (accounts are passwordless now), but the
 * links are already out in people's inboxes, so send them somewhere useful
 * instead of letting them 404.
 */
export function loader() {
  return redirect("/login");
}
