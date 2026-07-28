/**
 * The email_codes migration, run against both shapes that exist in the wild:
 * the live one (code_hash + prev_code_hash) and the original one that predates
 * prev_code_hash. Renaming columns on the table that every login goes through
 * is worth proving rather than reasoning about.
 *
 * getDb() reads DATABASE_PATH once at import, so each shape needs its own
 * process — the parent run spawns one child per shape.
 *
 * Usage:
 *   node test/email_codes_migration_test.mjs
 */

import { createServer } from "vite";
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(HERE));

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m" };

const SHAPES = {
  // What production is running.
  "with-prev": `CREATE TABLE email_codes (
      email      TEXT PRIMARY KEY,
      code_hash  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    , prev_code_hash TEXT)`,
  // What it ran before the prev_code_hash migration.
  "without-prev": `CREATE TABLE email_codes (
      email      TEXT PRIMARY KEY,
      code_hash  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    )`,
};

// ---------------------------------------------------------------- parent run
if (!process.argv[2]) {
  let failedShapes = 0;
  for (const shape of Object.keys(SHAPES)) {
    console.log(`\n${C.bold}=== ${shape} ===${C.reset}`);
    const run = spawnSync(process.execPath, [HERE, shape], { stdio: "inherit" });
    if (run.status !== 0) failedShapes++;
  }
  console.log(
    failedShapes === 0
      ? `\n${C.green}${C.bold}ALL OK${C.reset}`
      : `\n${C.red}${C.bold}${failedShapes} shape(s) FAILED${C.reset}`,
  );
  process.exit(failedShapes === 0 ? 0 : 1);
}

// ----------------------------------------------------------------- child run
const shape = process.argv[2];
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`${C.green}  ok${C.reset} ${name}`);
  } else {
    failed++;
    console.log(`${C.red}  FAIL${C.reset} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-migrate-"));
const dbPath = path.join(tmpDir, "old.db");
process.env.DATABASE_PATH = dbPath;
process.env.NODE_ENV = "test";
for (const key of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) {
  process.env[key] ??= "test-secret-not-used-outside-tests";
}

// A database in the old shape, with a login already in flight.
const old = new Database(dbPath);
old.exec(SHAPES[shape]);
old.prepare("INSERT INTO email_codes (email, code_hash, expires_at) VALUES (?, ?, ?)")
  .run("elisabeth@example.de", "b".repeat(64), "2099-01-01 00:00:00");
old.close();

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const requestRoute = await vite.ssrLoadModule("./app/routes/api.auth.request.ts");
  const verifyRoute = await vite.ssrLoadModule("./app/routes/api.auth.verify.ts");

  const db = getDb(); // opens, applies SCHEMA, then the migrations
  const cols = db.prepare("PRAGMA table_info(email_codes)").all().map((c) => c.name);

  // Compared as a set: a renamed column keeps its old position, so a migrated
  // table lists prev_code last where a freshly created one has it second.
  // Everything reads by name, so only the membership matters.
  check(
    "columns are the new shape",
    JSON.stringify([...cols].sort()) ===
      JSON.stringify(["attempts", "code", "email", "expires_at", "prev_code", "sent_at"]),
    JSON.stringify(cols),
  );
  check(
    "the in-flight hash is gone (it could never be emailed)",
    db.prepare("SELECT COUNT(*) c FROM email_codes").get().c === 0,
  );

  const email = "elisabeth@example.de";
  const post = (route, fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return route.action({ request: new Request("http://test/", { method: "POST", body }) });
  };

  const id = Number(db.prepare("INSERT INTO users (name) VALUES (?)").run("Wortklauberin").lastInsertRowid);
  db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").run(id, email);

  await post(requestRoute, { email });
  const row = db.prepare("SELECT * FROM email_codes WHERE email = ?").get(email);
  check("a code can be issued", /^\d{6}$/.test(row?.code ?? ""), JSON.stringify(row));
  check("sent_at kept its default", typeof row?.sent_at === "string" && row.sent_at.length > 0, String(row?.sent_at));

  // Cross the rate limit the way a real minute would.
  db.prepare("UPDATE email_codes SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-61 seconds') WHERE email = ?").run(email);
  const resent = await post(requestRoute, { email });
  check("resend repeats the same code", resent.data?.resent === true && row.code === db.prepare("SELECT code FROM email_codes WHERE email = ?").get(email).code);

  const ok = await post(verifyRoute, { email, code: row.code });
  check("and it logs in", ok.data?.type === "existing", JSON.stringify(ok.data));
} finally {
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
