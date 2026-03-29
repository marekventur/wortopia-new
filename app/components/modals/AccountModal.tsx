import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

export default function AccountModal() {
  const { closeModal } = useModalStore();
  return (
    <Modal id="account" size="sm">
      <form role="form" className="modal-content">
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Dein Account</h4>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="accountName">Name (keine Leerzeichen erlaubt)</label>
            <input type="text" className="form-control" name="name" id="accountName" placeholder="Name" />
          </div>
          <div className="form-group">
            <label htmlFor="accountTeam">Teamname (freilassen, wenn du kein Team willst)</label>
            <input type="text" className="form-control" name="team" id="accountTeam" placeholder="Teamname" />
          </div>
          <div className="form-group">
            <label htmlFor="accountEmail">Ändere Email Addresse</label>
            <input type="email" className="form-control" name="email" id="accountEmail" placeholder="name@adresse.de" />
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
          <button type="submit" className="btn btn-primary">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}
