import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Link, useSubmit } from "react-router";
import type { Session } from "../../lib/session.js";
import type { GameSize } from "../stores/gameStore";

type Props = {
  session: Session;
  size?: GameSize;
};

const dropdownLinkStyle: CSSProperties ={ display: "block", padding: "3px 20px", color: "#333", textDecoration: "none", fontWeight: "normal" };

export default function Nav({ session, size }: Props) {
  const submit = useSubmit();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLLIElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const displayName = session.type === "user" ? session.user.name : `Gast ${session.guestId}`;

  return (
    <div className="navbar navbar-default navbar-fixed-top navbar-inverse px-4" role="navigation">
      <div className="container-fluid">
        <div className="navbar-header">
          <button type="button" className="navbar-toggle" data-toggle="collapse" data-target=".navbar-collapse">
            <span className="sr-only">Menü</span>
            <span className="icon-bar"></span>
            <span className="icon-bar"></span>
            <span className="icon-bar"></span>
          </button>
          <a className="navbar-brand font-bold" href="/">Wortopia</a>
        </div>
        <div className="navbar-collapse collapse">
          <ul className="nav navbar-nav navbar-right">
            {session.type === "user" ? (
              <li ref={dropdownRef} className={`dropdown${dropdownOpen ? " open" : ""}`}>
                <a
                  href="#"
                  className="dropdown-toggle"
                  onClick={(e) => { e.preventDefault(); setDropdownOpen((o) => !o); }}
                >
                  {displayName} <span className="caret" />
                </a>
                <ul className="dropdown-menu dropdown-menu-right">
                  <li>
                    <Link to="/account" style={dropdownLinkStyle}>Account</Link>
                  </li>
                  <li role="separator" className="divider" />
                  <li>
                    <Link to="#" style={dropdownLinkStyle} onClick={(e) => { e.preventDefault(); submit(null, { method: "post", action: "/api/logout" }); }}>Logout</Link>
                  </li>
                </ul>
              </li>
            ) : (
              <>
                <li className="navbar-text-item">
                  <span className="navbar-text">{displayName}</span>
                </li>
                <li>
                  <button type="button" className="btn btn-default navbar-btn btn-sm" style={{ marginRight: 8 }} onClick={() => { window.location.href = "/login"; }}>Anmelden</button>
                </li>
              </>
            )}
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
