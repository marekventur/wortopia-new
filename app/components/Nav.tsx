import { useModalStore } from "../stores/modalStore";
import type { Session } from "../../lib/session.js";
import type { GameSize } from "../stores/gameStore";

type Props = {
  session: Session;
  size?: GameSize;
};

export default function Nav({ session, size }: Props) {
  const { openModal } = useModalStore(); // still needed for account/login/signup modals
  const displayName = session.type === "user" ? session.user.name : `Gast ${session.guestId}`;

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
              <p className="navbar-text playing-as">Name &quot;{displayName}&quot;</p>
            </li>
            <li className="btn-group pull-right">
              {session.type === "user" ? (
                <>
                  <button type="button" className="btn btn-default navbar-btn" onClick={() => openModal("account")}>Account</button>
                  <form method="post" action="/api/logout" style={{ display: "inline" }}>
                    <button type="submit" className="btn btn-default navbar-btn">Logout</button>
                  </form>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-default navbar-btn" onClick={() => openModal("login")}>Login</button>
                  <button type="button" className="btn btn-default navbar-btn" onClick={() => openModal("signup")}>Registrieren</button>
                </>
              )}
            </li>
          </ul>
          <ul className="nav navbar-nav">
            <li className={size === 4 ? "active" : ""}><a href="/4">4x4</a></li>
            <li className={size === 5 ? "active" : ""}><a href="/5">5x5</a></li>
            <li><a href="/regeln">Regeln</a></li>
            <li><a href="/rangliste">Rangliste</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
