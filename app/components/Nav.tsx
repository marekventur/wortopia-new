export default function Nav() {
  return (
    <div className="navbar navbar-default navbar-fixed-top navbar-inverse" role="navigation">
      <div className="container-fluid">
      <div className="navbar-header">
        <button type="button" className="navbar-toggle" data-toggle="collapse" data-target=".navbar-collapse">
          <span className="sr-only">Menü</span>
          <span className="icon-bar"></span>
          <span className="icon-bar"></span>
          <span className="icon-bar"></span>
        </button>
        <a className="navbar-brand" href="/">Wortopia</a>
      </div>
      <div className="navbar-collapse collapse">
        <ul className="nav navbar-nav navbar-right">
          <li>
            <p className="navbar-text playing-as">Name "Gast 2598887"</p>
          </li>
          <li className="btn-group pull-right">
            <button type="button" className="btn btn-default navbar-btn" data-toggle="modal" data-target="#modal--login">Login</button>
            <button type="button" className="btn btn-default navbar-btn" data-toggle="modal" data-target="#modal--signup">Registrieren</button>
          </li>
        </ul>
        <ul className="nav navbar-nav">
          <li className="active"><a href="/4">4x4 <span className="badge">69</span></a></li>
          <li><a href="/5">5x5</a></li>
          <li><a href="#/rules" data-toggle="modal" data-target="#modal--rules">Regeln</a></li>
          <li><a href="#/highscore" data-toggle="modal" data-target="#modal--highscore">Rangliste</a></li>
          <li><a href="#/options" data-toggle="modal" data-target="#modal--options">Einstellungen</a></li>
        </ul>
      </div>
      </div>
    </div>
  );
}
