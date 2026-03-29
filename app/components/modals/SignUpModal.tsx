import { useState, type FormEvent } from "react";
import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

export default function SignUpModal() {
  const { closeModal, openModal } = useModalStore();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const body = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/signup", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler bei der Anmeldung.");
      } else {
        window.location.reload();
      }
    } catch {
      setError("Netzwerkfehler. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal id="signup" size="sm">
      <form role="form" className="modal-content" onSubmit={handleSubmit}>
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Anmeldung - Wortopia</h4>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-group">
            <label htmlFor="signupUsername">Name (keine Leerzeichen erlaubt)</label>
            <input type="text" className="form-control" name="username" id="signupUsername" placeholder="Name" required />
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
            <a href="#" onClick={(e) => { e.preventDefault(); openModal("recover"); }}>
              Du hast bereits einen Account, hast aber deine Zugangsdaten vergessen?
            </a>
          </p>
        </div>
        <div className="modal-footer">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "..." : "Anmelden"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
