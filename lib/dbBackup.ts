import os from "os";
import path from "path";
import { getDb } from "./db.js";
import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.GCS_BACKUP_BUCKET ?? "general-backup-marekventur";
const OBJECT = process.env.GCS_BACKUP_OBJECT ?? "wortopia.db";

// Only the production instance may write the backup. server.js schedules this on
// both the development and production paths, and the defaults above point at the
// live object — so any dev instance that happens to have GCS_BACKUP_CREDENTIALS
// in its .env would overwrite production's backup with its own database once a
// day. Guard on NODE_ENV rather than on the credential being absent, so the
// protection does not depend on how a particular machine's .env is arranged.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function msUntil3am(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runBackup(): Promise<void> {
  if (!process.env.GCS_BACKUP_CREDENTIALS) {
    console.warn("[backup] GCS_BACKUP_CREDENTIALS not set — skipping");
    return;
  }

  const credentials = JSON.parse(process.env.GCS_BACKUP_CREDENTIALS);
  const db = getDb();
  const tmp = path.join(os.tmpdir(), `wortopia-backup-${Date.now()}.db`);

  console.log("[backup] Starting DB backup...");
  await db.backup(tmp);

  const storage = new Storage({ credentials });
  await storage.bucket(BUCKET).upload(tmp, { destination: OBJECT });

  const { unlinkSync } = await import("fs");
  unlinkSync(tmp);

  console.log(`[backup] Uploaded to gs://${BUCKET}/${OBJECT}`);
}

export function scheduleDbBackup(): void {
  if (!IS_PRODUCTION) {
    console.log("[backup] Skipped (not production).");
    return;
  }

  function scheduleNext() {
    const delay = msUntil3am();
    console.log(`[backup] Next backup at 3am (in ${Math.round(delay / 60000)} min)`);
    setTimeout(async () => {
      try {
        await runBackup();
      } catch (err) {
        console.error("[backup] Backup failed:", err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
