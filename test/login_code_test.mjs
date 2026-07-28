/**
 * Login codes: requesting, resending, verifying.
 *
 * The case that matters is the one that kept a player out for three days —
 * pressing "Code erneut senden" while the first email was still in flight, then
 * typing the code from it. Runs standalone against a throwaway database, driving
 * the route actions directly (same pattern as claims_test.mjs).
 *
 * Usage:
 *   node test/login_code_test.mjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-code-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
for (const key of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) {
  process.env[key] ??= "test-secret-not-used-outside-tests";
}

const EMAIL = "wortklauberin@example.de";

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const requestRoute = await vite.ssrLoadModule("./app/routes/api.auth.request.ts");
  const verifyRoute = await vite.ssrLoadModule("./app/routes/api.auth.verify.ts");

  const db = getDb();
  const id = Number(db.prepare("INSERT INTO users (name) VALUES (?)").run("Wortklauberin").lastInsertRowid);
  db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)").run(id, EMAIL);

  const post = (route, fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return route.action({ request: new Request("http://test/", { method: "POST", body }) });
  };

  const requestCode = () => post(requestRoute, { email: EMAIL });
  const verify = (code) => post(verifyRoute, { email: EMAIL, code });
  const row = () => db.prepare("SELECT * FROM email_codes WHERE email = ?").get(EMAIL);
  /** Pretends the last send was `seconds` ago, so the 60s limit can be crossed. */
  const rewindSend = (seconds) =>
    db
      .prepare(
        `UPDATE email_codes
         SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         WHERE email = ?`
      )
      .run(`-${seconds} seconds`, EMAIL);

  console.log(`${C.bold}first request${C.reset}`);
  const first = await requestCode();
  check("accepted", first.data?.ok === true, JSON.stringify(first.data));
  check("not flagged as a resend", first.data?.resent === false);
  const code = row().code;
  check("a six-digit code is stored", /^\d{6}$/.test(code ?? ""), String(code));

  console.log(`${C.bold}pressing resend inside the minute${C.reset}`);
  const tooSoon = await requestCode();
  check("rate-limited", tooSoon.init?.status === 429, JSON.stringify(tooSoon.init));
  check("code untouched", row().code === code);

  console.log(`${C.bold}pressing resend after the minute${C.reset}`);
  const expiryBefore = row().expires_at;
  rewindSend(61);
  const resent = await requestCode();
  check("accepted", resent.data?.ok === true);
  check("reported as a resend", resent.data?.resent === true, JSON.stringify(resent.data));
  check("same code as the first email", row().code === code);
  check("nothing kept as a superseded code", row().prev_code === null);
  check("stays alive: expiry pushed out", row().expires_at >= expiryBefore, row().expires_at);

  console.log(`${C.bold}the code from the first email still works${C.reset}`);
  const ok = await verify(code);
  check("logged in", ok.data?.type === "existing", JSON.stringify(ok.data));
  check("only one account, so no picker", ok.data?.multiple === false);
  check("session created", db.prepare("SELECT COUNT(*) c FROM user_sessions").get().c === 1);
  check("code consumed", row() === undefined);

  console.log(`${C.bold}wrong code${C.reset}`);
  await requestCode();
  const live = row().code;
  const wrong = await verify(live === "000000" ? "111111" : "000000");
  check("rejected", wrong.init?.status === 400);
  check("attempt counted", row().attempts === 1);
  check("code not consumed", row().code === live);

  console.log(`${C.bold}an expired code is replaced, not resent${C.reset}`);
  db.prepare("UPDATE email_codes SET expires_at = '2020-01-01 00:00:00' WHERE email = ?").run(EMAIL);
  rewindSend(61);
  const afterExpiry = await requestCode();
  check("not a resend", afterExpiry.data?.resent === false, JSON.stringify(afterExpiry.data));
  check("a different code", row().code !== live);
  check("the expired one is remembered", row().prev_code === live);
  check("attempts reset with the new code", row().attempts === 0);

  console.log(`${C.bold}typing the expired code${C.reset}`);
  const stale = await verify(live);
  check("rejected", stale.init?.status === 400);
  check(
    "told to use the newest email",
    /neuesten Email/.test(stale.data?.error ?? ""),
    JSON.stringify(stale.data),
  );
} finally {
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
