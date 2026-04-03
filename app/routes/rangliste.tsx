import type { Route } from "./+types/rangliste";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";
import { getDb } from "../../lib/db.js";

type LeaderboardRow = {
  rank: number;
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

// Whitelisted sort expressions — secondary sort keeps ranking stable
const SORT_OPTIONS = {
  pct:        "pct DESC, games DESC",
  games:      "games DESC, pct DESC",
  avg_words:  "avg_words DESC, pct DESC",
  best_round: "best_round DESC, pct DESC",
} as const;

type SortKey = keyof typeof SORT_OPTIONS;

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);

  const url = new URL(request.url);
  const days   = parseInt(url.searchParams.get("days") ?? "30", 10);
  const size   = parseInt(url.searchParams.get("size") ?? "0", 10); // 0 = both
  const sortBy = (url.searchParams.get("sortBy") ?? "pct") as SortKey;
  const orderExpr = SORT_OPTIONS[sortBy] ?? SORT_OPTIONS.pct;

  const db = getDb();

  // Global leaderboard: rank from cache at query time so sort order can change
  // without a cache rebuild. Include logged-in user even if outside top 100.
  const loggedInName = session.type === "user" ? session.user.name : null;

  const leaderboard = db.prepare(`
    WITH ranked AS (
      SELECT name, team, games, pct, avg_words, best_round, generated_at,
             ROW_NUMBER() OVER (ORDER BY ${orderExpr}) AS rank
      FROM leaderboard_cache
      WHERE days = ? AND size = ?
    )
    SELECT rank, name, team, games, pct, avg_words, best_round, generated_at
    FROM ranked
    WHERE rank <= 100 OR name = ?
    ORDER BY rank ASC
  `).all(days, size, loggedInName) as (LeaderboardRow & { generated_at: string })[];

  const generatedAt = leaderboard[0]?.generated_at ?? null;

  // Personal stats: live query, fast because it filters by user_id first
  let personal: PersonalRow | null = null;
  if (session.type === "user") {
    const conditions: string[] = ["user_id = ?", "max_points > 0"];
    const params: (string | number)[] = [session.user.id];

    if (size === 4 || size === 5) {
      conditions.push("size = ?");
      params.push(size);
    }
    if (days > 0) {
      conditions.push(`finished >= datetime('now', '-${days} days')`);
    }

    personal = db.prepare(`
      SELECT COUNT(*)                                              AS games,
             ROUND(100.0 * SUM(points) / SUM(max_points), 1)     AS pct,
             ROUND(1.0  * SUM(words)  / COUNT(*), 1)             AS avg_words,
             MAX(points)                                          AS best_round
      FROM user_results
      WHERE ${conditions.join(" AND ")}
    `).get(...params) as PersonalRow | null;
  }

  const headers = cookieHeader ? { "Set-Cookie": cookieHeader } : undefined;
  const payload = { session, days, size, sortBy, leaderboard, personal, generatedAt, loggedInName };
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

const SORT_LABELS: Record<string, string> = {
  pct:        "Ergebnis",
  games:      "Runden",
  avg_words:  "Wörter/Runde",
  best_round: "Beste Runde",
};

export default function Rangliste({ loaderData }: Route.ComponentProps) {
  const { session, days, size, sortBy, leaderboard, personal, generatedAt, loggedInName } = loaderData;

  function filterLink(newDays: number, newSize: number, newSort: string) {
    return `/rangliste?days=${newDays}&size=${newSize}&sortBy=${newSort}`;
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
                href={filterLink(opt.value, size, sortBy)}
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
                href={filterLink(days, opt.value, sortBy)}
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
                {(["games", "pct", "avg_words", "best_round"] as const).map(key => (
                  <th key={key}>
                    <a href={filterLink(days, size, key)} style={{ color: "inherit", textDecoration: sortBy === key ? "underline" : "none" }}>
                      {SORT_LABELS[key]}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <>
                  {row.rank > 100 && i > 0 && (
                    <tr key={`gap-${row.rank}`}>
                      <td colSpan={6} style={{ textAlign: "center", color: "#aaa", padding: "4px 0", borderTop: "1px dashed #ddd" }}>…</td>
                    </tr>
                  )}
                  <tr key={row.name} style={row.name === loggedInName ? { fontWeight: "bold" } : undefined}>
                    <td>{row.rank}</td>
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
                </>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: "#888", fontSize: "0.9em" }}>
          Top 100 · geordnet nach {SORT_LABELS[sortBy] ?? "Ergebnis"}
          {generatedAt && (
            <> · Stand: {new Date(generatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</>
          )}
        </p>
      </div>
    </>
  );
}
