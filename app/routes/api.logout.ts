import { data } from "react-router";
import type { Route } from "./+types/api.logout";
import { deleteSession, sessionCookie } from "../../lib/session.js";

export async function action({ request }: Route.ActionArgs) {
  await deleteSession(request);
  const cookieHeader = await sessionCookie.serialize("", { maxAge: 0 });

  return data({ ok: true }, { headers: { "Set-Cookie": cookieHeader } });
}
