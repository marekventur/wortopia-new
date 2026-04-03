import { useState, type FormEvent } from "react";
import { redirect } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import type { SessionUser } from "../../lib/session.js";
import type { Route } from "./+types/account";

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  if (session.type !== "user") return redirect("/login");
  if (cookieHeader) {
    return Response.json({ session }, { headers: { "Set-Cookie": cookieHeader } });
  }
  return { session };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const { session } = loaderData;
  const user = session.type === "user" ? session.user : null;

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 480 }}>
        <h2>Dein Account</h2>
        <AccountForm user={user} />
      </div>
    </>
  );
}

function AccountForm({ user }: { user: SessionUser | null }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const res = await fetch("/api/account", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Speichern.");
      } else {
        setSuccess(true);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">Änderungen gespeichert.</div>}
      <div className="form-group">
        <label htmlFor="accountName">Name (keine Leerzeichen erlaubt)</label>
        <input type="text" className="form-control" name="name" id="accountName" placeholder="Name" defaultValue={user?.name ?? ""} />
      </div>
      <div className="form-group">
        <label htmlFor="accountTeam">Teamname (freilassen, wenn du kein Team willst)</label>
        <input type="text" className="form-control" name="team" id="accountTeam" placeholder="Teamname" defaultValue={user?.team ?? ""} />
      </div>
      <div className="form-group">
        <label htmlFor="accountEmail">Email-Adresse</label>
        <input type="email" className="form-control" id="accountEmail" defaultValue={user?.email ?? ""} readOnly disabled />
      </div>
      <button type="submit" className="btn btn-primary" disabled={loading || success}>
        {loading ? "..." : "Speichern"}
      </button>
    </form>
  );
}
