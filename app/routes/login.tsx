import { useState, type FormEvent } from "react";
import { redirect } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import type { Route } from "./+types/login";

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  if (session.type === "user") return redirect("/4");
  if (cookieHeader) {
    return Response.json({ session }, { headers: { "Set-Cookie": cookieHeader } });
  }
  return { session };
}


type Step =
  | { name: "email" }
  | { name: "code"; email: string }
  // Verified an address with no account behind it. Deliberately a stop rather
  // than a straight hand-off to registration: people coming back after a while
  // often try the wrong address, and silently offering them a new account is
  // how they end up with a second one and lose their history.
  | { name: "confirm-new"; email: string; verifyToken: string }
  | { name: "username"; email: string; verifyToken: string };

export default function Login({ loaderData }: Route.ComponentProps) {
  const { session } = loaderData;
  const [step, setStep] = useState<Step>({ name: "email" });

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 480 }}>
        <h2>Anmelden</h2>

        {step.name === "email" && (
          <EmailStep onNext={(email) => setStep({ name: "code", email })} />
        )}
        {step.name === "code" && (
          <CodeStep
            email={step.email}
            onBack={() => setStep({ name: "email" })}
            onNewUser={(verifyToken) => setStep({ name: "confirm-new", email: step.email, verifyToken })}
          />
        )}
        {step.name === "confirm-new" && (
          <ConfirmNewStep
            email={step.email}
            onTryAnotherEmail={() => setStep({ name: "email" })}
            onCreate={() => setStep({ name: "username", email: step.email, verifyToken: step.verifyToken })}
          />
        )}
        {step.name === "username" && (
          <UsernameStep email={step.email} verifyToken={step.verifyToken} />
        )}

        {/* Shown on every step: the accounts came across from the old site,
            where the address on file may be one the player can no longer read.
            Without a way out, their only option is a second account. */}
        <hr style={{ marginTop: 24 }} />
        <p className="text-muted">
          Kein Zugang zu deinem alten Account?{" "}
          <a href="mailto:marekventur@gmail.com">melde dich!</a>
        </p>
      </div>
    </>
  );
}

function EmailStep({ onNext }: { onNext: (email: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    try {
      const res = await fetch("/api/auth/request", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Senden des Codes.");
      } else {
        onNext(email);
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
      <p>Gib deine Email-Adresse ein. Wir senden dir einen 6-stelligen Code.</p>
      <div className="form-group">
        <label htmlFor="email">Email-Adresse</label>
        {/* Deliberately not type="email". On the old site you logged in with
            your player name, so that is what many people type here — and a
            browser that silently refuses to submit "asteramie" teaches them
            nothing and tells us nothing. Let it through and let the server say
            what to type instead. */}
        <input
          type="text"
          inputMode="email"
          autoComplete="email"
          className="form-control"
          name="email"
          id="email"
          placeholder="name@adresse.de"
          required
          autoFocus
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : "Code senden"}
      </button>
    </form>
  );
}

function CodeStep({
  email,
  onBack,
  onNewUser,
}: {
  email: string;
  onBack: () => void;
  onNewUser: (verifyToken: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const body = new FormData(e.currentTarget);
    body.set("email", email);
    body.set("code", String(body.get("code") ?? "").replace(/\D/g, ""));
    try {
      const res = await fetch("/api/auth/verify", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler bei der Verifizierung.");
      } else if (json.type === "existing") {
        // Signed in as the most recently used account. If the address carries
        // more than one, land on /konten rather than the game, so it is obvious
        // which one you are on and switching is one click away.
        window.location.href = json.multiple ? "/konten" : "/4";
      } else {
        onNewUser(json.verifyToken);
      }
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setResendMessage(null);
    setError(null);
    try {
      const body = new FormData();
      body.set("email", email);
      const res = await fetch("/api/auth/request", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setResendMessage(json.error ?? "Fehler beim erneuten Senden.");
      } else {
        setResendMessage("Ein neuer Code wurde gesendet.");
      }
    } catch {
      setResendMessage("Netzwerkfehler.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}
      {resendMessage && <div className="alert alert-info">{resendMessage}</div>}
      <p>Wir haben einen Code an <strong>{email}</strong> gesendet.</p>
      <div className="form-group">
        <label htmlFor="code">6-stelliger Code</label>
        <input
          type="text"
          className="form-control"
          name="code"
          id="code"
          placeholder="000000"
          // Not 6: pasting "012 345" would be truncated to "012 34" and fail
          // before it was ever sent. Non-digits are stripped on submit instead.
          maxLength={20}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginRight: 8 }}>
        {loading ? "..." : "Bestätigen"}
      </button>
      <button type="button" className="btn btn-link" onClick={onBack}>Andere Email</button>
      <p style={{ marginTop: 12 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); handleResend(); }}>
          {resending ? "..." : "Code erneut senden"}
        </a>
      </p>
    </form>
  );
}


function ConfirmNewStep({
  email,
  onTryAnotherEmail,
  onCreate,
}: {
  email: string;
  onTryAnotherEmail: () => void;
  onCreate: () => void;
}) {
  return (
    <div>
      <div className="alert alert-info">
        Diese Email-Adresse wurde bisher noch nicht verwendet.
      </div>
      <p>
        Wenn <strong>{email}</strong> die richtige Adresse ist, kannst du ein
        neues Konto erstellen.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        style={{ marginRight: 8 }}
        onClick={onCreate}
        autoFocus
      >
        Neues Konto erstellen
      </button>
      <button type="button" className="btn btn-link" onClick={onTryAnotherEmail}>
        Email ändern
      </button>
    </div>
  );
}

function UsernameStep({ email, verifyToken }: { email: string; verifyToken: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set when the chosen name turns out to be an imported account that still has
  // its old password. Rather than a dead-end "already taken", ask for it: the
  // person typing that exact name is usually the one who used to own it.
  const [claimable, setClaimable] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const body = new FormData(e.currentTarget);
    body.set("verifyToken", verifyToken);
    try {
      const res = await fetch("/api/auth/register", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Erstellen des Accounts.");
        if (json.claimable) setClaimable(String(body.get("username") ?? ""));
      } else {
        window.location.href = "/4";
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
      <p>Willkommen! Wähle einen Anzeigenamen für dein Konto.</p>
      <p>
        Das Konto wird mit <strong>{email}</strong> verknüpft — mit dieser
        Adresse meldest du dich in Zukunft an.
      </p>
      <div className="form-group">
        <label htmlFor="username">Name (4–15 Zeichen, keine Leerzeichen)</label>
        <input type="text" className="form-control" name="username" id="username" placeholder="Name" required autoFocus
               defaultValue={claimable ?? undefined} />
      </div>

      {claimable && (
        <div className="form-group">
          <label htmlFor="claim-pw">Passwort von früher</label>
          <input type="password" className="form-control" name="password" id="claim-pw"
                 autoComplete="current-password" autoFocus />
          <p className="help-block">
            Gehört „{claimable}“ dir? Dann melde dich mit dem Passwort von früher an, und
            der Name zieht auf <strong>{email}</strong> um. Falls nicht, wähle einfach
            einen anderen Namen.
          </p>
        </div>
      )}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : claimable ? "Konto übernehmen" : "Konto erstellen"}
      </button>
    </form>
  );
}
