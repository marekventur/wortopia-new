import { useState, type FormEvent } from "react";
import { redirect } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import { accountsForEmail, type ClaimableAccount } from "../../lib/claims.js";
import type { Route } from "./+types/konten";

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  if (session.type !== "user") return redirect("/login");

  const accounts = session.user.email ? accountsForEmail(session.user.email) : [];
  const payload = { session, accounts, currentId: session.user.id };

  if (cookieHeader) {
    return Response.json(payload, { headers: { "Set-Cookie": cookieHeader } });
  }
  return payload;
}

function formatLastPlayed(iso: string | null): string {
  if (!iso) return "noch nie gespielt";
  return `zuletzt ${new Date(iso).toLocaleDateString("de-DE")}`;
}

export default function Konten({ loaderData }: Route.ComponentProps) {
  const { session, accounts, currentId } = loaderData;

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 640 }}>
        <h2>Deine Konten</h2>
        <p className="text-muted">
          Alle Namen, die zu deiner Email-Adresse gehören. Du bist mit dem zuletzt
          benutzten angemeldet — du kannst wechseln, alte Namen ausblenden und
          frühere Konten dazuholen. Ausgeblendete Namen tauchen beim Anmelden nicht
          mehr auf.
        </p>

        <AccountList accounts={accounts} currentId={currentId} />

        {/* Logging in with several accounts on the address lands here rather
            than in the game, so there has to be an obvious way onward. */}
        <p style={{ marginTop: 20 }}>
          <a href="/4" className="btn btn-primary">
            Weiter zum Spiel
          </a>
        </p>

        <ClaimForm />
      </div>
    </>
  );
}

function AccountList({
  accounts,
  currentId,
}: {
  accounts: ClaimableAccount[];
  currentId: number;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: Record<string, string>, userId: number) {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", body: new URLSearchParams(body) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Das hat nicht geklappt.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setBusy(null);
    }
  }

  const visible = accounts.filter((a) => !a.hidden);
  const hidden = accounts.filter((a) => a.hidden);

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="list-group" style={{ marginTop: 20 }}>
        {visible.map((account) => (
          <li key={account.id} className="list-group-item">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <strong>{account.name}</strong>
                {account.id === currentId && (
                  <span className="label label-success" style={{ marginLeft: 8 }}>
                    angemeldet
                  </span>
                )}
                <div className="text-muted" style={{ fontSize: "0.9em" }}>
                  {account.games} Runden · {formatLastPlayed(account.lastPlayed)}
                </div>
              </div>

              {account.id !== currentId && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy !== null}
                    onClick={() => post("/api/konten/switch", { userId: String(account.id) }, account.id)}
                  >
                    Wechseln
                  </button>
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={busy !== null}
                    onClick={() =>
                      post(
                        "/api/konten/hide",
                        { userId: String(account.id), hidden: "true" },
                        account.id,
                      )
                    }
                  >
                    Ausblenden
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <>
          <h4 style={{ marginTop: 30 }}>Ausgeblendet</h4>
          <p className="text-muted" style={{ fontSize: "0.9em" }}>
            Diese Namen erscheinen beim Anmelden nicht mehr. Nichts ist gelöscht — alle
            Runden bleiben erhalten.
          </p>
          <ul className="list-group">
            {hidden.map((account) => (
              <li key={account.id} className="list-group-item">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <span className="text-muted">{account.name}</span>
                    <div className="text-muted" style={{ fontSize: "0.9em" }}>
                      {account.games} Runden · {formatLastPlayed(account.lastPlayed)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={busy !== null}
                    onClick={() =>
                      post(
                        "/api/konten/hide",
                        { userId: String(account.id), hidden: "false" },
                        account.id,
                      )
                    }
                  >
                    Wieder einblenden
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ClaimForm() {
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setClaimed(null);
    setLoading(true);
    try {
      const res = await fetch("/api/konten/claim", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Das hat nicht geklappt.");
        return;
      }
      setClaimed(json.username);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 40 }}>
      <h4>Früheren Namen dazuholen</h4>
      <p className="text-muted">
        Hattest du früher einen anderen Namen, der jetzt nicht mehr angeboten wird? Beim
        alten Wortopia hast du dich mit Name und Passwort angemeldet. Gib beides ein, und
        der Name zieht auf deine Email-Adresse um.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="claim-username">Alter Name</label>
          <input
            id="claim-username"
            name="username"
            className="form-control"
            autoComplete="username"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="claim-password">Altes Passwort</label>
          <input
            id="claim-password"
            name="password"
            type="password"
            className="form-control"
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {claimed && (
          <div className="alert alert-success">
            „{claimed}“ gehört jetzt zu deiner Email-Adresse.
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Moment…" : "Konto dazuholen"}
        </button>
      </form>
    </div>
  );
}
