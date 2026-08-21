/**
 * The bridge that hands finalized proposals to spielwoerter.de.
 *
 * It used to POST and ignore the answer, so when the API key was missing from
 * production every call came back 401 for six weeks in silence and ~540
 * proposals were dropped. These checks are about the answer being read: what
 * gets recorded as delivered, what gets shouted about, and that nothing throws
 * into the game loop.
 *
 * fetch is stubbed — no network, no real suggestions sent.
 *
 * Usage:
 *   node test/spielwoerter_bridge_test.mjs
 */

import { createServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Held before the stubs go in: the test reports through these, the code under
// test reports through the stubs.
const say = console.log.bind(console);
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m" };

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    say(`${C.green}  ok${C.reset} ${name}`);
  } else {
    failed++;
    say(`${C.red}  FAIL${C.reset} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-bridge-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "production"; // the bridge only fires in production
process.env.SPIELWOERTER_API_KEY = "test-key";
for (const k of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) process.env[k] ??= "t";

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

const realFetch = globalThis.fetch;
const sent = [];
let respond = () => new Response(JSON.stringify({ results: [{ status: "pending_review" }] }), { status: 200 });
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body), key: init.headers["X-API-Key"] });
  return respond();
};

const logs = { out: [], err: [] };
const realLog = console.log;
const realErr = console.error;
console.log = (...a) => logs.out.push(a.join(" "));
console.error = (...a) => logs.err.push(a.join(" "));

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { getWordProposalServer } = await vite.ssrLoadModule("./lib/wordProposalServer.ts");
  const db = getDb();
  const server = getWordProposalServer();

  const userId = Number(db.prepare("INSERT INTO users (name) VALUES ('Melderin')").run().lastInsertRowid);

  /** Propose, force the window shut, then let the sweep finalize it. */
  const finalize = async (word) => {
    const p = server.propose(userId, "Melderin", word, "add", "eine Beschreibung", null, 4);
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals(); // triggers finalizeExpired
    await new Promise((r) => setTimeout(r, 30)); // let the async send settle
    return db.prepare("SELECT status, synced_to_spielwoerter_at FROM word_proposals WHERE id = ?").get(p.id);
  };

  const delivered = () => logs.out.filter((l) => l.includes("accepted"));
  const complaints = () => logs.err.filter((l) => l.includes("WordProposalServer"));

  say(`${C.bold}accepted for review${C.reset}`);
  const okRow = await finalize("erstwort");
  check("the request carried the key", sent[0]?.key === "test-key", JSON.stringify(sent[0]?.key));
  check("and the word and author", sent[0]?.body.suggestions[0].word === "erstwort"
    && sent[0]?.body.suggestions[0].author_email === `user-${userId}@wortopia.de`);
  check("recorded as delivered", typeof okRow.synced_to_spielwoerter_at === "string", JSON.stringify(okRow));
  check("and logged as accepted", delivered().length === 1, JSON.stringify(delivered()));

  say(`${C.bold}votes travel with the suggestion${C.reset}`);
  sent.length = 0;
  const voters = [];
  for (let i = 0; i < 3; i++) {
    voters.push(Number(db.prepare("INSERT INTO users (name) VALUES (?)").run(`Waehler${i}`).lastInsertRowid));
  }
  {
    const p = server.propose(userId, "Melderin", "sechstwort", "add", "beschreibung", null, 4);
    const vote = db.prepare("INSERT INTO word_proposal_votes (proposal_id, user_id, vote) VALUES (?, ?, ?)");
    vote.run(p.id, voters[0], "support");
    vote.run(p.id, voters[1], "support");
    vote.run(p.id, voters[2], "oppose");
    // A stray self-vote: the API rejects the whole item if the author appears.
    vote.run(p.id, userId, "support");
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
  }
  const item = sent[0]?.body.suggestions[0];
  check("supporters are sent", JSON.stringify(item?.supporters) === JSON.stringify([`user-${voters[0]}@wortopia.de`, `user-${voters[1]}@wortopia.de`]),
    JSON.stringify(item?.supporters));
  check("opposers are sent", JSON.stringify(item?.opposers) === JSON.stringify([`user-${voters[2]}@wortopia.de`]),
    JSON.stringify(item?.opposers));
  check("the author is never listed as a voter",
    ![...(item?.supporters ?? []), ...(item?.opposers ?? [])].includes(`user-${userId}@wortopia.de`),
    JSON.stringify(item));

  say(`${C.bold}no votes at all${C.reset}`);
  sent.length = 0;
  await finalize("siebtwort");
  const bare = sent[0]?.body.suggestions[0];
  check("the fields are omitted rather than sent empty",
    !("supporters" in (bare ?? {})) && !("opposers" in (bare ?? {})), JSON.stringify(bare));

  say(`${C.bold}more voters than the API accepts${C.reset}`);
  sent.length = 0;
  {
    const p = server.propose(userId, "Melderin", "achtwort", "add", "beschreibung", null, 4);
    const vote = db.prepare("INSERT INTO word_proposal_votes (proposal_id, user_id, vote) VALUES (?, ?, ?)");
    for (let i = 0; i < 60; i++) {
      const id = Number(db.prepare("INSERT INTO users (name) VALUES (?)").run(`Menge${i}`).lastInsertRowid);
      vote.run(p.id, id, "support");
    }
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
  }
  check("capped at 50", sent[0]?.body.suggestions[0].supporters.length === 50,
    String(sent[0]?.body.suggestions[0].supporters?.length));

  say(`${C.bold}the word is listed under a spelling the board cannot hold${C.reset}`);
  sent.length = 0;
  {
    // As a sync would leave it: the game plays "oeffnen", the list holds "öffnen".
    db.prepare("INSERT INTO words (word, accepted, description) VALUES ('oeffnen', 1, NULL)").run();
    db.prepare("INSERT INTO word_spellings (word, spelling) VALUES ('oeffnen', 'öffnen')").run();
    const p = server.propose(userId, "Melderin", "oeffnen", "remove", null, null, 4, false, "gibt es nicht");
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
  }
  check("the umlaut spelling is what travels", sent[0]?.body.suggestions[0].word === "öffnen",
    JSON.stringify(sent[0]?.body.suggestions));
  check("and only that one", sent[0]?.body.suggestions.length === 1, String(sent[0]?.body.suggestions.length));

  say(`${C.bold}listed twice over${C.reset}`);
  sent.length = 0;
  respond = () => new Response(JSON.stringify({ results: [{ status: "pending_review" }, { status: "pending_review" }] }), { status: 200 });
  {
    db.prepare("INSERT INTO words (word, accepted, description) VALUES ('abbeisse', 1, NULL)").run();
    for (const spelling of ["abbeisse", "abbeiße"]) {
      db.prepare("INSERT INTO word_spellings (word, spelling) VALUES ('abbeisse', ?)").run(spelling);
    }
    const p = server.propose(userId, "Melderin", "abbeisse", "remove", null, null, 4, false, "gibt es nicht");
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
    var bothRow = db.prepare("SELECT synced_to_spielwoerter_at FROM word_proposals WHERE id = ?").get(p.id);
  }
  check("both spellings are named", JSON.stringify(sent[0]?.body.suggestions.map((x) => x.word)) === JSON.stringify(["abbeisse", "abbeiße"]),
    JSON.stringify(sent[0]?.body.suggestions.map((x) => x.word)));
  check("and that counts as delivered", typeof bothRow.synced_to_spielwoerter_at === "string", JSON.stringify(bothRow));

  say(`${C.bold}only half of a double listing gets through${C.reset}`);
  sent.length = 0;
  respond = () => new Response(JSON.stringify({ results: [{ status: "pending_review" }, { status: "skipped", reason: "conflict" }] }), { status: 200 });
  {
    db.prepare("INSERT INTO words (word, accepted, description) VALUES ('abfliesse', 1, NULL)").run();
    for (const spelling of ["abfliesse", "abfließe"]) {
      db.prepare("INSERT INTO word_spellings (word, spelling) VALUES ('abfliesse', ?)").run(spelling);
    }
    const p = server.propose(userId, "Melderin", "abfliesse", "remove", null, null, 4, false, "gibt es nicht");
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
    var halfRow = db.prepare("SELECT synced_to_spielwoerter_at FROM word_proposals WHERE id = ?").get(p.id);
  }
  check("not delivered while one listing survives", halfRow.synced_to_spielwoerter_at === null, JSON.stringify(halfRow));
  check("and the half that failed is named", complaints().some((l) => l.includes("abfließe") && l.includes("conflict")),
    JSON.stringify(complaints().slice(-1)));

  say(`${C.bold}a word the list does not have${C.reset}`);
  sent.length = 0;
  respond = () => new Response(JSON.stringify({ results: [{ status: "pending_review" }] }), { status: 200 });
  {
    const p = server.propose(userId, "Melderin", "möhre", "add", "eine Beschreibung", null, 4);
    db.prepare("UPDATE word_proposals SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(p.id);
    server.getProposals();
    await new Promise((r) => setTimeout(r, 30));
  }
  check("travels exactly as the player wrote it", sent[0]?.body.suggestions[0].word === "möhre",
    JSON.stringify(sent[0]?.body.suggestions[0]?.word));

  say(`${C.bold}silently skipped — the case that used to vanish${C.reset}`);
  respond = () => new Response(JSON.stringify({ results: [{ status: "skipped", reason: "blocked" }] }), { status: 200 });
  const skippedRow = await finalize("zweitwort");
  check("not recorded as delivered", skippedRow.synced_to_spielwoerter_at === null, JSON.stringify(skippedRow));
  check("and the reason is in the log", complaints().some((l) => l.includes("blocked")), JSON.stringify(complaints()));

  say(`${C.bold}rejected by the API${C.reset}`);
  logs.err.length = 0;
  respond = () => new Response("unauthorized", { status: 401 });
  const unauthRow = await finalize("drittwort");
  check("not recorded as delivered", unauthRow.synced_to_spielwoerter_at === null);
  check("401 is shouted about", complaints().some((l) => l.includes("401")), JSON.stringify(complaints()));

  say(`${C.bold}the network is down${C.reset}`);
  logs.err.length = 0;
  respond = () => { throw new Error("ECONNREFUSED"); };
  const downRow = await finalize("viertwort");
  check("the proposal is still finalized locally", downRow.status === "sent_for_approval", JSON.stringify(downRow));
  check("not marked delivered", downRow.synced_to_spielwoerter_at === null);
  check("and it is logged rather than thrown", complaints().some((l) => l.includes("could not be sent")));

  say(`${C.bold}no key configured${C.reset}`);
  logs.err.length = 0;
  sent.length = 0;
  delete process.env.SPIELWOERTER_API_KEY;
  const noKeyRow = await finalize("fuenftwort");
  check("nothing is sent at all", sent.length === 0);
  check("and it says why", complaints().some((l) => l.includes("SPIELWOERTER_API_KEY is not set")), JSON.stringify(complaints()));
  check("still not marked delivered", noKeyRow.synced_to_spielwoerter_at === null);
} finally {
  console.log = realLog;
  console.error = realErr;
  globalThis.fetch = realFetch;
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

say(
  `\n${passed} passed, ${failed} failed` +
    (failed === 0 ? ` ${C.green}${C.bold}ALL OK${C.reset}` : ` ${C.red}${C.bold}FAILURES${C.reset}`),
);
process.exit(failed === 0 ? 0 : 1);
