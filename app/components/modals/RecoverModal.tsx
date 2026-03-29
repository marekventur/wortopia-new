import { useState, type FormEvent } from "react";
import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

export default function RecoverModal() {
  const { closeModal, openModal } = useModalStore();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const body = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/recover", { method: "POST", body });
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

  return (
    <Modal id="recover" size="sm">
      <form role="form" className="modal-content" onSubmit={handleSubmit}>
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Passwort oder Name vergessen</h4>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          {success ? (
            <div className="alert alert-success">
              Falls diese Email-Adresse bei uns registriert ist, haben wir dir eine Email gesendet.
            </div>
          ) : (
            <div>
              <p>Bitte gebe deine Email Adresse ein und wir senden dir eine Email mit einem Wiederherstellungslink:</p>
              <div className="form-group">
                <label htmlFor="recoverEmail">Email</label>
                <input type="text" className="form-control" name="email" id="recoverEmail" placeholder="name@adresse.de" required />
              </div>
              <p>
                <a href="#" onClick={(e) => { e.preventDefault(); openModal("signup"); }}>
                  Erstelle einen neuen Account
                </a>
              </p>
            </div>
          )}
        </div>
        {!success && (
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "..." : "Sende Email"}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
