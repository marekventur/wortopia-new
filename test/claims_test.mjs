/**
 * Account-claiming tests.
 * Runs standalone against a throwaway database — no HTTP server needed. Uses
 * Vite's SSR loader for TypeScript (same pattern as game_test.mjs).
 *
 * Usage:
 *   node test/claims_test.mjs
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-claims-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
// lib/secrets.ts refuses to start without these.
for (const key of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) {
  process.env[key] ??= "test-secret-not-used-outside-tests";
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { claimAccount, isClaimable, accountsForEmail, setAccountHidden } =
    await vite.ssrLoadModule("./lib/claims.ts");
  const bcrypt = (await vite.ssrLoadModule("bcryptjs")).default;

  const db = getDb();

  // Two imported accounts with old-style hashes, plus the claimer's own account.
  // Cost 6 to match what actually came across from the old site.
  const oldHash = bcrypt.hashSync("hunter2", 6);
  const seed = db.transaction(() => {
    const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
    const mine = Number(insert.run("NeuerName").lastInsertRowid);
    const old = Number(insert.run("Katzenohren").lastInsertRowid);
    const other = Number(insert.run("Fremdkonto").lastInsertRowid);

    const email = db.prepare("INSERT INTO user_emails (user_id, email) VALUES (?, ?)");
    email.run(mine, "me@example.com");
    email.run(old, "stale@example.com");
    email.run(other, "someone@example.com");

    const claim = db.prepare("INSERT INTO v1_claims (user_id, pw_hash) VALUES (?, ?)");
    claim.run(old, oldHash);
    claim.run(other, oldHash);
    return { mine, old, other };
  });
  const ids = seed();

  console.log(`${C.bold}claimable detection${C.reset}`);
  check("imported account is claimable", isClaimable("Katzenohren") === true);
  check("claimable is case-insensitive", isClaimable("katzenOHREN") === true);
  check("new account is not claimable", isClaimable("NeuerName") === false);
  check("unknown name is not claimable", isClaimable("GibtEsNicht") === false);

  console.log(`${C.bold}wrong password${C.reset}`);
  const wrong = await claimAccount("Katzenohren", "falsch", "me@example.com");
  check("rejected", wrong.ok === false);
  const stillStale = db
    .prepare("SELECT email FROM user_emails WHERE user_id = ?")
    .get(ids.old);
  check("email not rebound", stillStale.email === "stale@example.com");
  check(
    "attempt recorded against the account",
    db.prepare("SELECT attempts FROM v1_claims WHERE user_id = ?").get(ids.old).attempts === 1,
  );

  console.log(`${C.bold}correct password${C.reset}`);
  const good = await claimAccount("Katzenohren", "hunter2", "me@example.com");
  check("accepted", good.ok === true, JSON.stringify(good));
  check(
    "email rebound to the claimer",
    db.prepare("SELECT email FROM user_emails WHERE user_id = ?").get(ids.old).email ===
      "me@example.com",
  );
  check(
    "hash burned (single use)",
    db.prepare("SELECT 1 FROM v1_claims WHERE user_id = ?").get(ids.old) === undefined,
  );
  check("no longer claimable", isClaimable("Katzenohren") === false);
  check(
    "logged",
    db.prepare("SELECT from_email, to_email FROM claim_log WHERE user_id = ?").get(ids.old)
      ?.from_email === "stale@example.com",
  );
  check(
    "round history survived the rebind",
    db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(ids.old).c === 1,
  );

  console.log(`${C.bold}replay after a successful claim${C.reset}`);
  const replay = await claimAccount("Katzenohren", "hunter2", "attacker@example.com");
  check("same password no longer works", replay.ok === false);
  check(
    "account stays with the first claimer",
    db.prepare("SELECT email FROM user_emails WHERE user_id = ?").get(ids.old).email ===
      "me@example.com",
  );

  // The message that sent a player to support for an account they already had:
  // a name moved onto their address by hand has no claim row left, so the form
  // used to answer "no such old account with a password".
  console.log(`${C.bold}a name that is already yours${C.reset}`);
  const attemptsBefore = () =>
    db.prepare("SELECT attempts FROM claim_attempts WHERE email = ?").get("me@example.com")
      ?.attempts ?? 0;
  const beforeOwn = attemptsBefore();
  const own = await claimAccount("NeuerName", "egal", "me@example.com");
  check("still refused", own.ok === false);
  check(
    "but told it is theirs, and where",
    /gehört bereits zu deiner Email-Adresse/.test(own.error) && /in der Liste/.test(own.error),
    JSON.stringify(own.error),
  );
  check(
    "not counted against the claim allowance",
    attemptsBefore() === beforeOwn,
    `${beforeOwn} -> ${attemptsBefore()}`,
  );
  check("matched case-insensitively", /gehört bereits/.test((await claimAccount("neuername", "egal", "me@example.com")).error));

  db.prepare("UPDATE users SET hidden_at = ? WHERE id = ?").run(new Date().toISOString(), ids.mine);
  const ownHidden = await claimAccount("NeuerName", "egal", "me@example.com");
  check(
    "a hidden one points at the toggle instead of the list",
    /ausgeblendet/.test(ownHidden.error) && !/in der Liste/.test(ownHidden.error),
    JSON.stringify(ownHidden.error),
  );
  db.prepare("UPDATE users SET hidden_at = NULL WHERE id = ?").run(ids.mine);

  check(
    "someone else's claimed name still gives nothing away",
    /kein altes Konto mit Passwort/.test(
      (await claimAccount("NeuerName", "egal", "stranger@example.com")).error,
    ),
  );
  db.prepare("DELETE FROM claim_attempts").run();

  console.log(`${C.bold}rate limiting${C.reset}`);
  // Per-account lock: 5 wrong tries against the same nick.
  let lastError = null;
  for (let i = 0; i < 6; i++) {
    lastError = await claimAccount("Fremdkonto", "falsch", "spray@example.com");
  }
  check("account locks after repeated failures", lastError.status === 429, JSON.stringify(lastError));
  const lockedOut = await claimAccount("Fremdkonto", "hunter2", "spray@example.com");
  check("correct password is refused while locked", lockedOut.ok === false);
  check(
    "still not rebound",
    db.prepare("SELECT email FROM user_emails WHERE user_id = ?").get(ids.other).email ===
      "someone@example.com",
  );

  // Per-claimer limit: the same address spraying across many accounts.
  db.prepare("DELETE FROM claim_attempts").run();
  for (let i = 0; i < 11; i++) {
    await claimAccount(`Zufall${i}`, "raten", "sprayer@example.com");
  }
  const sprayed = await claimAccount("Zufall99", "raten", "sprayer@example.com");
  check("claimer is throttled across accounts", sprayed.status === 429, JSON.stringify(sprayed));

  console.log(`${C.bold}hiding${C.reset}`);
  check("hide own account", setAccountHidden(ids.old, "me@example.com", true) === true);
  check(
    "hidden account still listed on the konten page",
    accountsForEmail("me@example.com").some((a) => a.name === "Katzenohren" && a.hidden),
  );
  check(
    "cannot hide someone else's account",
    setAccountHidden(ids.other, "me@example.com", true) === false,
  );
  check("unhide works", setAccountHidden(ids.old, "me@example.com", false) === true);
} finally {
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
