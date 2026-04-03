import { getDb } from "./db.js";

const DAY_OPTIONS = [7, 30, 90, 365, 0] as const;
const SIZE_OPTIONS = [0, 4, 5] as const;

export function refreshLeaderboardCache(): void {
  const db = getDb();
  const generatedAt = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO leaderboard_cache (days, size, name, team, games, pct, avg_words, best_round, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const refreshOne = db.transaction((days: number, size: number) => {
    const conditions: string[] = ["max_points > 0"];
    const params: (string | number)[] = [];

    if (size === 4 || size === 5) {
      conditions.push("size = ?");
      params.push(size);
    }
    if (days > 0) {
      conditions.push(`finished >= datetime('now', '-${days} days')`);
    }

    const indexHint = days > 0
      ? "INDEXED BY user_results_by_time"
      : "INDEXED BY user_results_by_user";

    const rows = db.prepare(`
      SELECT u.name, u.team,
             COUNT(*)                                              AS games,
             ROUND(100.0 * SUM(r.points) / SUM(r.max_points), 1) AS pct,
             ROUND(1.0  * SUM(r.words)  / COUNT(*), 1)           AS avg_words,
             MAX(r.points)                                        AS best_round
      FROM user_results r ${indexHint}
      JOIN users u ON u.id = r.user_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY r.user_id
      HAVING games >= 3
      ORDER BY pct DESC
      LIMIT 1000
    `).all(...params) as Array<{
      name: string;
      team: string | null;
      games: number;
      pct: number;
      avg_words: number;
      best_round: number;
    }>;

    db.prepare("DELETE FROM leaderboard_cache WHERE days = ? AND size = ?").run(days, size);

    rows.forEach((row) => {
      insert.run(days, size, row.name, row.team, row.games, row.pct, row.avg_words, row.best_round, generatedAt);
    });

    console.log(`[leaderboard] days=${days} size=${size}: ${rows.length} rows`);
  });

  console.log("[leaderboard] Refreshing cache...");
  for (const days of DAY_OPTIONS) {
    for (const size of SIZE_OPTIONS) {
      refreshOne(days, size);
    }
  }
  console.log("[leaderboard] Cache refresh complete.");
}

function msUntil3am(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleLeaderboardRefresh(): void {
  const db = getDb();
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM leaderboard_cache").get() as { n: number };

  if (n === 0) {
    console.log("[leaderboard] Cache empty — running initial refresh...");
    refreshLeaderboardCache();
  }

  function scheduleNext() {
    const delay = msUntil3am();
    console.log(`[leaderboard] Next refresh at 3am (in ${Math.round(delay / 60000)} min)`);
    setTimeout(() => {
      try {
        refreshLeaderboardCache();
      } catch (err) {
        console.error("[leaderboard] Refresh failed:", err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
