import type { Route } from "./+types/rangliste";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

type LeaderboardRow = {
  name: string;
  team: string | null;
  games: number;
  pct: number;
  avg_words: number;
  best_round: number;
};

type PersonalRow = {
  games: number;
  pct: number | null;
  avg_words: number | null;
  best_round: number | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10);
  const size = parseInt(url.searchParams.get("size") ?? "0", 10); // 0 = both

  const db = getDb();

  // Build WHERE clauses
  const conditions: string[] = ["max_points > 0"];
  const params: (string | number)[] = [];

  if (size === 4 || size === 5) {
    conditions.push("size = ?");
    params.push(size);
  }
  if (days > 0) {
    conditions.push(`finished >= datetime('now', '-${days} days')`);
  }

  const where = conditions.join(" AND ");

  const leaderboard = db.prepare(`
    SELECT u.name, u.team,
           COUNT(*)                                              AS games,
           ROUND(100.0 * SUM(r.points) / SUM(r.max_points), 1) AS pct,
           ROUND(1.0  * SUM(r.words)  / COUNT(*), 1)           AS avg_words,
           MAX(r.points)                                        AS best_round
    FROM user_results r
    JOIN users u ON u.id = r.user_id
    WHERE ${where}
    GROUP BY r.user_id
    HAVING games >= 3
    ORDER BY pct DESC
    LIMIT 100
  `).all(...params) as LeaderboardRow[];

  let personal: PersonalRow | null = null;
  if (session.type === "user") {
    const personalConditions = [...conditions, "user_id = ?"];
    const personalParams = [...params, session.user.id];
    personal = db.prepare(`
      SELECT COUNT(*)                                              AS games,
             ROUND(100.0 * SUM(points) / SUM(max_points), 1)     AS pct,
             ROUND(1.0  * SUM(words)  / COUNT(*), 1)             AS avg_words,
             MAX(points)                                          AS best_round
      FROM user_results
      WHERE ${personalConditions.join(" AND ")}
    `).get(...personalParams) as PersonalRow | null;
  }

  const headers = cookieHeader ? { "Set-Cookie": cookieHeader } : undefined;
  const payload = { session, days, size, leaderboard, personal };
  return headers ? Response.json(payload, { headers }) : payload;
}

const DAY_OPTIONS = [
  { label: "7 Tage", value: 7 },
  { label: "30 Tage", value: 30 },
  { label: "90 Tage", value: 90 },
  { label: "1 Jahr", value: 365 },
  { label: "Gesamt", value: 0 },
];

const SIZE_OPTIONS = [
  { label: "Beide", value: 0 },
  { label: "4×4", value: 4 },
  { label: "5×5", value: 5 },
];

export default function Rangliste({ loaderData }: Route.ComponentProps) {
  const { session, days, size, leaderboard, personal } = loaderData;
  const loggedInName = session.type === "user" ? session.user.name : null;

  function filterLink(newDays: number, newSize: number) {
    return `/rangliste?days=${newDays}&size=${newSize}`;
  }

  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 800 }}>
        <h2>Rangliste</h2>

        {/* Filter bar */}
        <div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className="btn-group">
            {DAY_OPTIONS.map(opt => (
              <a
                key={opt.value}
                href={filterLink(opt.value, size)}
                className={`btn btn-default btn-sm${days === opt.value ? " active" : ""}`}
              >
                {opt.label}
              </a>
            ))}
          </div>
          <div className="btn-group">
            {SIZE_OPTIONS.map(opt => (
              <a
                key={opt.value}
                href={filterLink(days, opt.value)}
                className={`btn btn-default btn-sm${size === opt.value ? " active" : ""}`}
              >
                {opt.label}
              </a>
            ))}
          </div>
        </div>

        {/* Personal stats */}
        {personal && (
          <div className="panel panel-default" style={{ marginBottom: 20 }}>
            <div className="panel-heading"><strong>Deine Statistiken</strong></div>
            <div className="panel-body">
              {personal.games === 0 ? (
                <p style={{ color: "#888", margin: 0 }}>Keine Runden im gewählten Zeitraum.</p>
              ) : (
                <table className="table table-condensed" style={{ marginBottom: 0 }}>
                  <thead>
                    <tr>
                      <th>Runden</th>
                      <th>Ergebnis</th>
                      <th>Wörter/Runde</th>
                      <th>Beste Runde</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{personal.games}</td>
                      <td>{personal.pct !== null ? `${personal.pct}%` : "—"}</td>
                      <td>{personal.avg_words !== null ? personal.avg_words.toFixed(1) : "—"}</td>
                      <td>{personal.best_round ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Global leaderboard */}
        {leaderboard.length === 0 ? (
          <p style={{ color: "#888" }}>Keine Daten für diesen Zeitraum.</p>
        ) : (
          <table className="table table-condensed table-hover">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Runden</th>
                <th>Ergebnis</th>
                <th>Wörter/Runde</th>
                <th>Beste Runde</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.name} style={row.name === loggedInName ? { fontWeight: "bold" } : undefined}>
                  <td>{i + 1}</td>
                  <td>
                    {row.name}
                    {row.team && (
                      <span className="label label-default" style={{ marginLeft: 6, fontWeight: "normal" }}>
                        {row.team}
                      </span>
                    )}
                  </td>
                  <td>{row.games}</td>
                  <td>{row.pct}%</td>
                  <td>{row.avg_words.toFixed(1)}</td>
                  <td>{row.best_round}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: "#888", fontSize: "0.9em" }}>
          Top 100 · mindestens 3 Runden · geordnet nach Ergebnis
        </p>
      </div>
    </>
  );
}
