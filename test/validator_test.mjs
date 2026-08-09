/**
 * Guess validation, and specifically what a guess tells the client about the
 * dictionary.
 *
 * Reporting a missing word means typing it, and typing a word that is not on
 * the current board is the only way to do that without ruining the round you
 * are playing. That path used to give no way to propose anything, because the
 * result said only "not on the board" and never whether the word was known.
 *
 * Usage:
 *   node test/validator_test.mjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-validator-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
for (const k of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) process.env[k] ??= "t";

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { validateGuess } = await vite.ssrLoadModule("./lib/wordValidator.ts");

  const db = getDb();
  const userId = Number(db.prepare("INSERT INTO users (name) VALUES ('Melder')").run().lastInsertRowid);

  // A 4x4 board spelling HAUS along the top row; "haus" and "hut" are known
  // words, "zzz-words" are not.
  const field = "HAUSTXXXXXXXXXXX";
  const words = db.prepare("INSERT OR IGNORE INTO words (word, accepted) VALUES (?, 1)");
  for (const w of ["haus", "hut", "quarkkeulerei"]) words.run(w);
  const validWords = new Set(["haus"]); // what is actually findable on this board

  const guess = (w) => validateGuess(w, 4, userId, 1, field, validWords);

  console.log(`${C.bold}on the board${C.reset}`);
  check("a valid word scores", guess("haus").result === "correct");
  const onFieldUnknown = guess("hau"); // traceable but not in validWords
  check(
    "on the board, unknown to the dictionary",
    onFieldUnknown.result === "not_in_dictionary" && onFieldUnknown.inDictionary === false,
    JSON.stringify(onFieldUnknown),
  );

  console.log(`${C.bold}off the board — the case this is about${C.reset}`);
  const offUnknown = guess("zzzsprosse");
  check("reported as not on the board", offUnknown.result === "not_on_field", JSON.stringify(offUnknown));
  check(
    "and flagged as unknown, so it can be proposed",
    offUnknown.inDictionary === false,
    JSON.stringify(offUnknown),
  );

  const offKnown = guess("quarkkeulerei");
  check("a real word that missed the board is still not_on_field", offKnown.result === "not_on_field");
  check(
    "but flagged as known, so nothing is offered",
    offKnown.inDictionary === true,
    JSON.stringify(offKnown),
  );

  console.log(`${C.bold}unchanged behaviour${C.reset}`);
  check("too short is still too short", guess("ha").result === "too_short");
  db.prepare(
    "INSERT INTO round_guesses (round_id, size, user_id, username, word, result, points) VALUES (1, 4, ?, 'Melder', 'haus', 'correct', 1)",
  ).run(userId);
  check("a repeat is a duplicate", guess("haus").result === "duplicate");
  check("dictionary lookup is case-insensitive", guess("QUARKKEULEREI").inDictionary === true);
} finally {
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
