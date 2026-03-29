import { useState, type FormEvent } from "react";
import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";
import type { SessionUser } from "../../../lib/session.js";

type Props = {
  user: SessionUser | null;
};

export default function AccountModal({ user }: Props) {
  const { closeModal } = useModalStore();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const body = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/account", { method: "POST", body });
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
    <Modal id="account" size="sm">
      <form role="form" className="modal-content" onSubmit={handleSubmit}>
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Dein Account</h4>
        </div>
        <div className="modal-body">
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
            <label htmlFor="accountEmail">Ändere Email Addresse</label>
            <input type="email" className="form-control" name="email" id="accountEmail" placeholder="name@adresse.de" defaultValue={user?.email ?? ""} />
          </div>
          <div className="form-group">
            <label htmlFor="accountPassword1">Ändere Passwort</label>
            <input type="password" className="form-control" name="password1" id="accountPassword1" placeholder="Passwort" />
          </div>
          <div className="form-group">
            <label htmlFor="accountPassword2">Passwort (wiederholen)</label>
            <input type="password" className="form-control" name="password2" id="accountPassword2" placeholder="Passwort" />
          </div>
        </div>
        <div className="modal-footer">
          <button type="submit" className="btn btn-primary" disabled={loading || success}>
            {loading ? "..." : "Speichern"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
