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
            onNewUser={(verifyToken) => setStep({ name: "username", email: step.email, verifyToken })}
          />
        )}
        {step.name === "username" && (
          <UsernameStep verifyToken={step.verifyToken} />
        )}
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
        <input type="email" className="form-control" name="email" id="email" placeholder="name@adresse.de" required autoFocus />
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
    try {
      const res = await fetch("/api/auth/verify", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler bei der Verifizierung.");
      } else if (json.type === "existing") {
        window.location.href = "/4";
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
          maxLength={6}
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

function UsernameStep({ verifyToken }: { verifyToken: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      <div className="form-group">
        <label htmlFor="username">Name (4–15 Zeichen, keine Leerzeichen)</label>
        <input type="text" className="form-control" name="username" id="username" placeholder="Name" required autoFocus />
      </div>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : "Konto erstellen"}
      </button>
    </form>
  );
}
