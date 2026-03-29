export default function LoginModal() {
  return (
    <div className="modal fade" id="modal--login">
      <div className="modal-dialog modal-sm">
        <form role="form" className="modal-content">
          <div className="modal-header">
            <button type="button" className="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h4 className="modal-title">Login</h4>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="loginUsername">Name</label>
              <input type="text" className="form-control" name="username" id="loginUsername" placeholder="Name" />
            </div>
            <div className="form-group">
              <label htmlFor="loginPassword">Passwort</label>
              <input type="password" className="form-control" name="password" id="loginPassword" placeholder="Passwort" />
            </div>
            <p>
              <a href="#" data-toggle="modal" data-target="#modal--recover">
                Passwort oder Name vergessen?
              </a>
            </p>
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary">Login</button>
          </div>
        </form>
      </div>
    </div>
  );
}
