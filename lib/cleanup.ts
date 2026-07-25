import { getDb } from "./db.js";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Removes rows that are no longer usable:
 *  - OTP codes past their 10-minute expiry (they are single-use and deleted on
 *    success, so anything left over is an abandoned or failed login attempt)
 *  - session rows past valid_until (sessions are rolling, so an expired row
 *    means genuinely inactive for SESSION_TTL_DAYS)
 *
 * Neither table is large today, but both only ever grew.
 */
export function runCleanup(): void {
  const db = getDb();

  const codes = db
    .prepare("DELETE FROM email_codes WHERE expires_at < datetime('now')")
    .run().changes;

  const sessions = db
    .prepare("DELETE FROM user_sessions WHERE valid_until < datetime('now')")
    .run().changes;

  if (codes > 0 || sessions > 0) {
    console.log(
      `[cleanup] Removed ${codes} expired email code(s), ${sessions} expired session(s)`,
    );
  }
}

export function scheduleCleanup(): void {
  runCleanup();
  const timer = setInterval(() => {
    try {
      runCleanup();
    } catch (err) {
      console.error("[cleanup] Failed:", err);
    }
  }, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
