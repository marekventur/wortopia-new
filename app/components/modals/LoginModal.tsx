import { useState, type FormEvent } from "react";
import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

export default function LoginModal() {
  const { closeModal, openModal } = useModalStore();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const body = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/login", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Login.");
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
    <Modal id="login" size="sm">
      <form role="form" className="modal-content" onSubmit={handleSubmit}>
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Login</h4>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-group">
            <label htmlFor="loginUsername">Name</label>
            <input type="text" className="form-control" name="username" id="loginUsername" placeholder="Name" required />
          </div>
          <div className="form-group">
            <label htmlFor="loginPassword">Passwort</label>
            <input type="password" className="form-control" name="password" id="loginPassword" placeholder="Passwort" required />
          </div>
          <p>
            <a href="#" onClick={(e) => { e.preventDefault(); openModal("recover"); }}>
              Passwort oder Name vergessen?
            </a>
          </p>
        </div>
        <div className="modal-footer">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "..." : "Login"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
