export default function RecoverModal() {
  return (
    <div className="modal fade" id="modal--recover">
      <div className="modal-dialog modal-sm">
        <form role="form" className="modal-content">
          <div className="modal-header">
            <button type="button" className="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h4 className="modal-title">Passwort oder Name vergessen</h4>
          </div>
          <div className="modal-body">
            <div>
              <p>Bitte gebe deine Email Adresse ein und wir senden dir eine Email mit einem Wiederherstellungslink:</p>
              <div className="form-group">
                <label htmlFor="recoverEmail">Email</label>
                <input type="text" className="form-control" name="email" id="recoverEmail" placeholder="name@adresse.de" />
              </div>
              <p>
                <a href="#" data-toggle="modal" data-target="#modal--signup">
                  Erstelle einen neuen Account
                </a>
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary">Sende Email</button>
          </div>
        </form>
      </div>
    </div>
  );
}
