/**
 * Word proposals: how long they stay visible.
 *
 * A proposal is rendered from a "PROPOSAL:<id>" line in the chat, and the chat
 * skips any such line whose proposal the server did not send — so a report that
 * falls out of the broadcast does not go grey or show an outcome, it vanishes
 * from the conversation entirely. Players read that as their reports being
 * thrown away. The window is therefore tied to the chat history, not a clock.
 *
 * Runs standalone against a throwaway database; NODE_ENV is not production, so
 * finalization never calls spielwoerter.de.
 *
 * Usage:
 *   node test/proposals_test.mjs
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-proposals-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
for (const key of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) {
  process.env[key] ??= "test-secret-not-used-outside-tests";
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { getWordProposalServer } = await vite.ssrLoadModule("./lib/wordProposalServer.ts");

  const db = getDb();
  const userId = Number(db.prepare("INSERT INTO users (name) VALUES ('Melderin')").run().lastInsertRowid);
  const server = getWordProposalServer();

  /** Pretends the voting window closed, without waiting half an hour. */
  const closeVoting = (id) =>
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

  const chatLines = (size) =>
    db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE size = ?").get(size).c;

  console.log(`${C.bold}a fresh proposal${C.reset}`);
  const proposal = server.propose(userId, "Melderin", "erd", "add", null, null, 4);
  check("is returned", proposal !== null && proposal.word === "erd", JSON.stringify(proposal));
  check("is open", server.getProposals()[proposal.id]?.status === "open");
  check("announced itself in the chat", chatLines(4) === 1);

  console.log(`${C.bold}after the voting window closes${C.reset}`);
  closeVoting(proposal.id);
  const afterClose = server.getProposals()[proposal.id];
  check("still sent to clients", afterClose !== undefined);
  check(
    "and now carries its outcome",
    afterClose && afterClose.status !== "open",
    JSON.stringify(afterClose?.status),
  );

  console.log(`${C.bold}an hour later — the old cutoff${C.reset}`);
  db.prepare("UPDATE word_proposals SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours') WHERE id = ?")
    .run(proposal.id);
  db.prepare("UPDATE chat_messages SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours')").run();
  check(
    "age alone no longer hides it",
    server.getProposals()[proposal.id] !== undefined,
    "this is the report that 'disappeared' after a few hours",
  );

  console.log(`${C.bold}once the chat has scrolled past it${C.reset}`);
  const insertChat = db.prepare(
    "INSERT INTO chat_messages (user_id, username, message, size) VALUES (?, 'Melderin', ?, 4)",
  );
  for (let i = 0; i < 100; i++) insertChat.run(userId, `plausch ${i}`);
  check("drops out with the chat line", server.getProposals()[proposal.id] === undefined);
  check("the payload stays bounded", Object.keys(server.getProposals()).length < 100);

  console.log(`${C.bold}the other board's chat does not push it out${C.reset}`);
  const second = server.propose(userId, "Melderin", "aes", "add", null, null, 5);
  closeVoting(second.id);
  const insertChat5 = db.prepare(
    "INSERT INTO chat_messages (user_id, username, message, size) VALUES (?, 'Melderin', ?, 4)",
  );
  for (let i = 0; i < 100; i++) insertChat5.run(userId, `mehr plausch ${i}`);
  check(
    "a 5x5 proposal survives a busy 4x4 chat",
    server.getProposals()[second.id] !== undefined,
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
