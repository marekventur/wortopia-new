import { getDb } from "./db.js";

const DAY_OPTIONS = [1, 7, 30, 90, 365, 0] as const;
const SIZE_OPTIONS = [0, 4, 5] as const;

// Minimum games to appear in leaderboard: ~0.5 games/day on average.
// days=0 (all-time) shares the 1-year threshold.
const MIN_GAMES: Record<number, number> = {
  1:   1,
  7:   3,
  30:  15,
  90:  45,
  365: 183,
  0:   183,
};

export type LeaderboardEntry = {
  name: string;
  team: string | null;
  games: number;
  pct: number;
  avg_words: number;
  best_round: number;
};

/**
 * The leaderboard for one window, computed from user_results.
 *
 * The one definition of what a leaderboard *is*. The nightly cache fills its
 * table from this, and the 24-hour board runs it per request — if the two ever
 * drifted apart, the same player would be ranked differently depending on which
 * tab they clicked.
 *
 * Cheap only because user_results has an index leading with `finished`
 * (see migrateLeaderboardFinishedIndex in db.ts): a day is ~1,300 rows out of
 * 3.9 million, so it seeks instead of scanning. Without that index this is a
 * ~370ms full scan whatever the window.
 */
export function computeLeaderboard(days: number, size: number): LeaderboardEntry[] {
  const conditions: string[] = ["max_points > 0"];
  const params: (string | number)[] = [];

  if (size === 4 || size === 5) {
    conditions.push("size = ?");
    params.push(size);
  }
  if (days > 0) {
    conditions.push(`finished >= datetime('now', '-${days} days')`);
  }

  return getDb().prepare(`
    SELECT u.name, u.team,
           COUNT(*)                                              AS games,
           -- Average of each round's percentage, NOT total points over total
           -- available. Rounds differ enormously in how much there is to find
           -- (4x4 averages 159 points available, 5x5 averages 397), and you
           -- find a smaller share of a big board, so summing first lets the
           -- biggest rounds dominate and drags everyone down by a different
           -- amount. This is also what the old site did.
           ROUND(100.0 * AVG(1.0 * r.points / r.max_points), 1) AS pct,
           ROUND(1.0  * SUM(r.words)  / COUNT(*), 1)           AS avg_words,
           MAX(r.points)                                        AS best_round
    FROM user_results r
    JOIN users u ON u.id = r.user_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY r.user_id
    HAVING games >= ${MIN_GAMES[days]}
    ORDER BY pct DESC
    LIMIT 1000
  `).all(...params) as LeaderboardEntry[];
}

/**
 * Rebuilds the cached leaderboards. Pass `periods` to rebuild only some of them.
 *
 * The whole set is 18 tables (6 windows x 3 board sizes) and takes long enough
 * that it runs overnight. The 24-hour board cannot wait that long: refreshed
 * only at 3am it shows the day that ended at 3am, so nothing played today
 * appears at all, which is exactly the "Live-Rangliste" players say they miss.
 */
export function refreshLeaderboardCache(periods: readonly number[] = DAY_OPTIONS): void {
  const db = getDb();
  const generatedAt = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO leaderboard_cache (days, size, rank, name, team, games, pct, avg_words, best_round, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const refreshOne = db.transaction((days: number, size: number) => {
    const rows = computeLeaderboard(days, size);

    db.prepare("DELETE FROM leaderboard_cache WHERE days = ? AND size = ?").run(days, size);

    rows.forEach((row, i) => {
      insert.run(days, size, i + 1, row.name, row.team, row.games, row.pct, row.avg_words, row.best_round, generatedAt);
    });

    console.log(`[leaderboard] days=${days} size=${size}: ${rows.length} rows`);
  });

  console.log(`[leaderboard] Refreshing cache (${periods.join(", ")} day windows)...`);
  for (const days of periods) {
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
    console.log(`[leaderboard] Next full refresh at 3am (in ${Math.round(delay / 60000)} min)`);
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

  // No hourly job for the 24-hour board any more: rangliste.tsx computes that
  // one per request (~1ms with user_results_finished), so a cached copy could
  // only ever be staler than what the page shows.
}
