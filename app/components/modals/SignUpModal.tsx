export default function SignUpModal() {
  return (
    <div className="modal fade" id="modal--signup">
      <div className="modal-dialog modal-sm">
        <form role="form" className="modal-content">
          <div className="modal-header">
            <button type="button" className="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h4 className="modal-title">Anmeldung - Wortopia</h4>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="signupUsername">Name (keine Leerzeichen erlaubt)</label>
              <input type="text" className="form-control" name="username" id="signupUsername" placeholder="Name" />
            </div>
            <div className="form-group">
              <label htmlFor="signupEmail">Email</label>
              <input type="email" className="form-control" name="email" id="signupEmail" placeholder="name@adresse.de" />
            </div>
            <div className="form-group">
              <label htmlFor="signupPassword1">Passwort</label>
              <input type="password" className="form-control" name="password1" id="signupPassword1" placeholder="Passwort" />
            </div>
            <div className="form-group">
              <label htmlFor="signupPassword2">Passwort (wiederholen)</label>
              <input type="password" className="form-control" name="password2" id="signupPassword2" placeholder="Passwort" />
            </div>
            <p>
              <a href="#" data-toggle="modal" data-target="#modal--recover">
                Du hast bereits einen Account, hast aber deine Zugangsdaten vergessen?
              </a>
            </p>
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary">Anmelden</button>
          </div>
        </form>
      </div>
    </div>
  );
}
