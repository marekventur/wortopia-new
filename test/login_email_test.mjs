/**
 * Login: what happens when a player name is typed into the email field.
 * Runs standalone against a throwaway database — no HTTP server needed. Uses
 * Vite's SSR loader for TypeScript (same pattern as claims_test.mjs).
 *
 * Usage:
 *   node test/login_email_test.mjs
 */

import { createServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m" };

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

// A scratch database, so a stray run can never touch the real one.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-login-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
// lib/secrets.ts refuses to start without these.
for (const key of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) {
  process.env[key] ??= "test-secret-not-used-outside-tests";
}

/** Calls the route action the way the login form does. */
function post(action, email) {
  const body = new FormData();
  body.set("email", email);
  return action({ request: new Request("http://test/api/auth/request", { method: "POST", body }) });
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

// The username branch returns before any mail is sent, so nothing here reaches
// Mailgun — but capture the log lines, since being able to see these attempts
// is the whole point of the change.
const logLines = [];
const realLog = console.log;

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { action } = await vite.ssrLoadModule("./app/routes/api.auth.request.ts");

  const db = getDb();
  const seed = db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO users (name) VALUES (?)").run("asteramie").lastInsertRowid);
    db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").run(id, "c.schwedes@example.de");
  });
  seed();

  const capture = async (email) => {
    logLines.length = 0;
    console.log = (...args) => logLines.push(args.join(" "));
    try {
      return await post(action, email);
    } finally {
      console.log = realLog;
    }
  };

  console.log(`${C.bold}player name instead of an email address${C.reset}`);
  const known = await capture("asteramie");
  check("rejected with 400", known.init?.status === 400, JSON.stringify(known.init));
  check(
    "told to use the email address",
    /Email-Adresse, nicht deinen Spielernamen/.test(known.data?.error ?? ""),
    JSON.stringify(known.data),
  );
  check("no code issued", db.prepare("SELECT COUNT(*) c FROM email_codes").get().c === 0);
  check(
    "logged with the name and the address on file",
    logLines.some((l) => l.includes('"asteramie"') && l.includes("c.****es@example.de")),
    JSON.stringify(logLines),
  );

  console.log(`${C.bold}name is matched case-insensitively${C.reset}`);
  const cased = await capture("Asteramie");
  check("still identified", logLines.some((l) => l.includes('"asteramie"')), JSON.stringify(logLines));
  check("same 400", cased.init?.status === 400);

  console.log(`${C.bold}unknown text${C.reset}`);
  const unknown = await capture("hunter2");
  check("rejected with 400", unknown.init?.status === 400);
  check(
    "same message, so the response does not reveal which names exist",
    unknown.data?.error === known.data?.error,
    JSON.stringify(unknown.data),
  );
  check(
    "the text itself is not written to the log",
    logLines.length === 1 && !logLines[0].includes("hunter2"),
    JSON.stringify(logLines),
  );

  console.log(`${C.bold}an actual address still gets a code${C.reset}`);
  // Mailgun is unconfigured here; the route logs the failure and carries on, so
  // the row in email_codes is what proves it got that far.
  const ok = await capture("c.schwedes@example.de");
  check("accepted", ok.data?.ok === true, JSON.stringify(ok.data));
  check(
    "code stored for that address",
    db.prepare("SELECT COUNT(*) c FROM email_codes WHERE email = ?").get("c.schwedes@example.de").c === 1,
  );

  console.log(`${C.bold}empty input${C.reset}`);
  const empty = await post(action, "   ");
  check("rejected with 400", empty.init?.status === 400);
  check(
    "keeps the plain message rather than blaming a player name",
    /gültige Email-Adresse/.test(empty.data?.error ?? ""),
    JSON.stringify(empty.data),
  );
} finally {
  console.log = realLog;
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
