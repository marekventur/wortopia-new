import { useState, type FormEvent } from "react";
import { redirect } from "react-router";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import type { Route } from "./+types/login";

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  // Already logged in → go to game
  if (session.type === "user") return redirect("/4");
  if (cookieHeader) {
    return Response.json({ session }, { headers: { "Set-Cookie": cookieHeader } });
  }
  return { session };
}

type Tab = "login" | "signup" | "recover";

export default function Login({ loaderData }: Route.ComponentProps) {
  const { session } = loaderData;
  const [tab, setTab] = useState<Tab>("login");

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 480 }}>
        <ul className="nav nav-tabs" style={{ marginBottom: 20 }}>
          <li className={tab === "login" ? "active" : ""}>
            <a href="#" onClick={(e) => { e.preventDefault(); setTab("login"); }}>Login</a>
          </li>
          <li className={tab === "signup" ? "active" : ""}>
            <a href="#" onClick={(e) => { e.preventDefault(); setTab("signup"); }}>Registrieren</a>
          </li>
          <li className={tab === "recover" ? "active" : ""}>
            <a href="#" onClick={(e) => { e.preventDefault(); setTab("recover"); }}>Passwort vergessen</a>
          </li>
        </ul>

        {tab === "login" && <LoginForm onSwitchTab={setTab} />}
        {tab === "signup" && <SignupForm onSwitchTab={setTab} />}
        {tab === "recover" && <RecoverForm onSwitchTab={setTab} />}
      </div>
    </>
  );
}

function LoginForm({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Login.");
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
      <div className="form-group">
        <label htmlFor="loginUsername">Name</label>
        <input type="text" className="form-control" name="username" id="loginUsername" placeholder="Name" required autoFocus />
      </div>
      <div className="form-group">
        <label htmlFor="loginPassword">Passwort</label>
        <input type="password" className="form-control" name="password" id="loginPassword" placeholder="Passwort" required />
      </div>
      <p>
        <a href="#" onClick={(e) => { e.preventDefault(); onSwitchTab("recover"); }}>
          Passwort oder Name vergessen?
        </a>
      </p>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : "Login"}
      </button>
    </form>
  );
}

function SignupForm({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/signup", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler bei der Anmeldung.");
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
      <div className="form-group">
        <label htmlFor="signupUsername">Name (keine Leerzeichen erlaubt)</label>
        <input type="text" className="form-control" name="username" id="signupUsername" placeholder="Name" required autoFocus />
      </div>
      <div className="form-group">
        <label htmlFor="signupEmail">Email</label>
        <input type="email" className="form-control" name="email" id="signupEmail" placeholder="name@adresse.de" required />
      </div>
      <div className="form-group">
        <label htmlFor="signupPassword1">Passwort</label>
        <input type="password" className="form-control" name="password1" id="signupPassword1" placeholder="Passwort" required />
      </div>
      <div className="form-group">
        <label htmlFor="signupPassword2">Passwort (wiederholen)</label>
        <input type="password" className="form-control" name="password2" id="signupPassword2" placeholder="Passwort" required />
      </div>
      <p>
        <a href="#" onClick={(e) => { e.preventDefault(); onSwitchTab("recover"); }}>
          Du hast bereits einen Account, hast aber deine Zugangsdaten vergessen?
        </a>
      </p>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : "Registrieren"}
      </button>
    </form>
  );
}

function RecoverForm({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/recover", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Senden der Email.");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="alert alert-success">
        Falls diese Email-Adresse bei uns registriert ist, haben wir dir eine Email gesendet.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}
      <p>Bitte gebe deine Email-Adresse ein und wir senden dir eine Email mit einem Wiederherstellungslink:</p>
      <div className="form-group">
        <label htmlFor="recoverEmail">Email</label>
        <input type="email" className="form-control" name="email" id="recoverEmail" placeholder="name@adresse.de" required autoFocus />
      </div>
      <p>
        <a href="#" onClick={(e) => { e.preventDefault(); onSwitchTab("signup"); }}>
          Erstelle einen neuen Account
        </a>
      </p>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "..." : "Email senden"}
      </button>
    </form>
  );
}
