/**
 * Pulling the word list from spielwoerter.de.
 *
 * Two things are being checked here. First, that the spelling the list uses is
 * kept: the board can only hold OEFFNEN, but a report about that word has to
 * travel back as "öffnen", and a word listed as both "abbeisse" and "abbeiße"
 * is only really gone when both are. Second, that the six megabytes are pulled
 * when the list has actually moved rather than once a night — an approved word
 * used to wait up to 24 hours to become playable, which players read as their
 * reports being ignored.
 *
 * fetch is stubbed — no network.
 *
 * Usage:
 *   node test/wordsync_test.mjs
 */

import { createServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wortopia-sync-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
for (const k of ["COOKIE_SECRET", "GUEST_TOKEN_SECRET", "VERIFY_TOKEN_SECRET"]) process.env[k] ??= "t";

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom" });

// A list big enough to clear the truncation guard, which refuses anything under
// a thousand words once the database holds some.
const filler = Array.from({ length: 1200 }, (_, i) => `wort${i},,Beschreibung ${i}`);
let listCsv = [
  "word,base,description",
  "öffnen,,aufmachen",
  "abbeisse,,ein Stück abbeissen",
  "abbeiße,,ein Stück abbeißen",
  ...filler,
].join("\n");

let version = "1-aaa";
const fetched = { csv: 0, version: 0 };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("latest-update")) {
    fetched.version++;
    return new Response(JSON.stringify({ version }), { status: 200 });
  }
  fetched.csv++;
  return new Response(listCsv, { status: 200 });
};

const logs = [];
const realLog = console.log;
const realErr = console.error;
console.log = (...a) => logs.push(a.join(" "));
console.error = (...a) => logs.push(a.join(" "));

try {
  const { getDb } = await vite.ssrLoadModule("./lib/db.ts");
  const { pollForChanges } = await vite.ssrLoadModule("./lib/wordSync.ts");
  const { listedSpellings } = await vite.ssrLoadModule("./lib/wordSpellings.ts");
  const db = getDb();

  const spellingsOf = (word) =>
    db.prepare("SELECT spelling FROM word_spellings WHERE word = ? ORDER BY spelling").all(word)
      .map((r) => r.spelling);
  const lastLog = () =>
    db.prepare("SELECT word_count, version FROM word_sync_log ORDER BY id DESC LIMIT 1").get();
  const syncCount = () =>
    db.prepare("SELECT COUNT(*) AS c FROM word_sync_log").get().c;

  say(`${C.bold}the first pull${C.reset}`);
  await pollForChanges();
  check("the board's spelling is what the game plays",
    db.prepare("SELECT 1 FROM words WHERE word = 'oeffnen'").get() !== undefined);
  check("the list's spelling is kept alongside it",
    JSON.stringify(spellingsOf("oeffnen")) === JSON.stringify(["öffnen"]),
    JSON.stringify(spellingsOf("oeffnen")));
  check("a word listed twice keeps both spellings",
    JSON.stringify(spellingsOf("abbeisse")) === JSON.stringify(["abbeisse", "abbeiße"]),
    JSON.stringify(spellingsOf("abbeisse")));
  check("but is only playable once",
    db.prepare("SELECT COUNT(*) AS c FROM words WHERE word = 'abbeisse'").get().c === 1);
  check("and the version is recorded", lastLog().version === "1-aaa", JSON.stringify(lastLog()));

  say(`${C.bold}either spelling finds the entry${C.reset}`);
  check("asking with the umlaut", JSON.stringify(listedSpellings("öffnen")) === JSON.stringify(["öffnen"]),
    JSON.stringify(listedSpellings("öffnen")));
  check("asking as the board spells it", JSON.stringify(listedSpellings("oeffnen")) === JSON.stringify(["öffnen"]),
    JSON.stringify(listedSpellings("oeffnen")));
  check("a word that is not listed at all", listedSpellings("gibtesnicht").length === 0);

  say(`${C.bold}nothing has changed${C.reset}`);
  const before = fetched.csv;
  await pollForChanges();
  await pollForChanges();
  check("the list is not pulled again", fetched.csv === before, `${fetched.csv} vs ${before}`);
  check("but it was asked about", fetched.version > 1, String(fetched.version));

  say(`${C.bold}the list moves${C.reset}`);
  version = "2-bbb";
  await pollForChanges();
  check("the new version is pulled", fetched.csv === before + 1, String(fetched.csv));
  check("and recorded", lastLog().version === "2-bbb", JSON.stringify(lastLog()));

  say(`${C.bold}what the list drops, the game drops${C.reset}`);
  // Deletions were the complaint that started all this: a word removed from the
  // list in May was still playable in August. The sync writes differences now,
  // so "only ever adds" is exactly the bug worth guarding against.
  listCsv = [
    "word,base,description",
    "abbeisse,,ein Stück abbeissen",
    "neuwort,,frisch dazugekommen",
    ...filler.slice(0, 1199),
    "wort1199,,jetzt anders beschrieben",
  ].join("\n");
  version = "3-ccc";
  await pollForChanges();
  check("a word gone from the list stops being playable",
    db.prepare("SELECT 1 FROM words WHERE word = 'oeffnen'").get() === undefined);
  check("and its spelling goes with it", spellingsOf("oeffnen").length === 0,
    JSON.stringify(spellingsOf("oeffnen")));
  check("a spelling that was dropped stops counting",
    JSON.stringify(spellingsOf("abbeisse")) === JSON.stringify(["abbeisse"]),
    JSON.stringify(spellingsOf("abbeisse")));
  check("a new word arrives", db.prepare("SELECT 1 FROM words WHERE word = 'neuwort'").get() !== undefined);
  check("a changed description is written",
    db.prepare("SELECT description FROM words WHERE word = 'wort1199'").get().description === "jetzt anders beschrieben",
    JSON.stringify(db.prepare("SELECT description FROM words WHERE word = 'wort1199'").get()));
  check("and the count is what the list said", lastLog().word_count === 1202, JSON.stringify(lastLog()));

  say(`${C.bold}a truncated feed${C.reset}`);
  listCsv = ["word,base,description", "abbeisse,,ein Stück abbeissen"].join("\n");
  version = "4-ddd";
  const kept = db.prepare("SELECT COUNT(*) AS c FROM words").get().c;
  await pollForChanges();
  check("is refused rather than applied",
    db.prepare("SELECT COUNT(*) AS c FROM words").get().c === kept, String(kept));
  check("and says so", logs.some((l) => l.includes("Refusing to sync")));

  say(`${C.bold}a version string that stops moving${C.reset}`);
  // Back to a list worth having: the previous check left a truncated one, which
  // is refused and would make this look like a scheduling failure.
  listCsv = ["word,base,description", "abbeisse,,ein Stück abbeissen", ...filler].join("\n");
  db.prepare("UPDATE word_sync_log SET synced_at = '2020-01-01T00:00:00.000Z'").run();
  const syncs = syncCount();
  await pollForChanges();
  check("is pulled anyway once it is a day old", syncCount() === syncs + 1);

  say(`${C.bold}the list cannot be asked${C.reset}`);
  const stubborn = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes("latest-update")
      ? new Response("nope", { status: 500 })
      : stubborn(url);
  const pulls = fetched.csv;
  await pollForChanges();
  check("a failed question is not taken as 'unchanged'", logs.some((l) => l.includes("Could not read the list version")));
  check("and nothing is pulled on a guess", fetched.csv === pulls, String(fetched.csv));
} finally {
  console.log = realLog;
  console.error = realErr;
  await vite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

say("");
say(`${passed} passed, ${failed} failed ${failed === 0 ? `${C.green}${C.bold}ALL OK` : `${C.red}${C.bold}FAILED`}${C.reset}`);
process.exit(failed === 0 ? 0 : 1);
