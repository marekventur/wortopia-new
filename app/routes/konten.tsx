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
  // Logging in with more than one visible account lands here instead of in the
  // game (see api.auth.verify). Hiding the ones you never use is what makes that
  // stop, so say it here rather than leaving people to work it out.
  const showsOnEveryLogin = accounts.filter((a) => !a.hidden).length > 1;

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 640 }}>
        <h2>Deine Konten</h2>

        {showsOnEveryLogin && (
          <div className="alert alert-info">
            Um diese Seite nicht jedes Mal zu sehen, blende alle unbenutzten
            Spielernamen aus.
          </div>
        )}

        <AccountList accounts={accounts} currentId={currentId} />

        <ClaimForm />
      </div>
    </>
  );
}

/** Enough blue to mark the row you are on, not enough to compete with a button. */
const CURRENT_ROW_TINT = "#eef4fb";

function AccountList({
  accounts,
  currentId,
}: {
  accounts: ClaimableAccount[];
  currentId: number;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Someone with sixteen imported names has fifteen they will never use again;
  // once hidden, those should not be half the page.
  const [showHidden, setShowHidden] = useState(false);

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

  /**
   * The row is the control: clicking one switches to it, clicking the one you
   * are already on carries on into the game. A "Wechseln" button next to every
   * name was fifteen buttons of noise for the person who has sixteen names —
   * and the row they wanted was the only one without one.
   */
  function activate(account: ClaimableAccount) {
    if (busy !== null) return;
    if (account.id === currentId) {
      window.location.href = "/4";
      return;
    }
    post("/api/konten/switch", { userId: String(account.id) }, account.id);
  }

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="list-group" style={{ marginTop: 20 }}>
        {visible.map((account) => {
          const current = account.id === currentId;
          return (
            <li
              key={account.id}
              className="list-group-item"
              role="button"
              tabIndex={0}
              aria-current={current || undefined}
              onClick={() => activate(account)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate(account);
                }
              }}
              style={{
                cursor: busy === null ? "pointer" : "default",
                backgroundColor: current ? CURRENT_ROW_TINT : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <strong>{account.name}</strong>
                  {current && (
                    <span className="label label-success" style={{ marginLeft: 8 }}>
                      angemeldet
                    </span>
                  )}
                  <div className="text-muted" style={{ fontSize: "0.9em" }}>
                    {account.games} Runden · {formatLastPlayed(account.lastPlayed)}
                  </div>
                </div>

                {current ? (
                  // A real link, so it can be opened in a tab like any other —
                  // the row click does the same thing for everyone else.
                  <a
                    href="/4"
                    className="btn btn-primary btn-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Weiter zum Spiel
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={busy !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      post(
                        "/api/konten/hide",
                        { userId: String(account.id), hidden: "true" },
                        account.id,
                      );
                    }}
                  >
                    Ausblenden
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 && (
        <p style={{ marginTop: 16 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowHidden((shown) => !shown);
            }}
          >
            {showHidden
              ? "Ausgeblendete Konten verbergen"
              : `Ausgeblendete Konten anzeigen (${hidden.length})`}
          </a>
        </p>
      )}

      {hidden.length > 0 && showHidden && (
        <>
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
  // Most people who land here have every name they own already listed. The form
  // is for the ones who don't, so it starts out of the way.
  const [open, setOpen] = useState(false);

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
    <div style={{ marginTop: 8 }}>
      {!open && (
        <p>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
          >
            Wortopia-V1-Account mit Passwort hinzufügen
          </a>
        </p>
      )}

      {open && (
        <div style={{ marginTop: 24 }}>
          <h4>Wortopia-V1-Account hinzufügen</h4>
          <p className="text-muted">
            Hattest du früher einen anderen Namen, der jetzt nicht mehr angeboten wird?
            Beim alten Wortopia hast du dich mit Name und Passwort angemeldet. Gib beides
            ein, und der Name zieht auf deine Email-Adresse um.
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
                autoFocus
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
      )}
    </div>
  );
}
