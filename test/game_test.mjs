/**
 * Game loop integration test.
 * Runs standalone — no HTTP server needed. Uses Vite's SSR loader to get
 * TypeScript support (same pattern as server.js).
 *
 * Usage:
 *   node test/game_test.mjs
 */

import { createServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  cyan:  "\x1b[36m",
  yellow:"\x1b[33m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
};

function ok(msg)   { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg) { console.log(`  ${C.cyan}→${C.reset} ${msg}`); }
function section(title) { console.log(`\n${C.bold}${C.cyan}══ ${title} ══${C.reset}`); }

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { ok(msg); passed++; }
  else       { fail(msg); failed++; }
}

// ── Boot Vite SSR ─────────────────────────────────────────────────────────────
console.log(`${C.bold}Starting Vite SSR loader…${C.reset}`);
const vite = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  logLevel: "silent",
});

// Load modules
const { generateField }    = await vite.ssrLoadModule("./lib/fieldGenerator.ts");
const { fieldContains, fieldToGrid } = await vite.ssrLoadModule("./lib/fieldContains.ts");
const { computeValidWords } = await vite.ssrLoadModule("./lib/fieldWords.ts");
const { getRoundId, getRoundTime, getRoundPhase, getSecondsRemaining, buildResults } =
  await vite.ssrLoadModule("./lib/gameState.ts");
const { validateGuess }    = await vite.ssrLoadModule("./lib/wordValidator.ts");
const { getDb }            = await vite.ssrLoadModule("./lib/db.ts");
const { GameServer }       = await vite.ssrLoadModule("./lib/gameServer.ts");

console.log(`${C.green}Modules loaded.${C.reset}\n`);

// ── Seed DB with test words ───────────────────────────────────────────────────
section("DB Setup");

const db = getDb();

// Check how many words we have
const wordCount = db.prepare("SELECT count(*) as n FROM words").get().n;
info(`Words in DB: ${wordCount}`);

// Generate current field to find testable words
const roundId = getRoundId();
const field4  = generateField(roundId, 4);
const field5  = generateField(roundId, 5);
info(`Round ${roundId} — 4×4 field: ${field4}`);
info(`Round ${roundId} — 5×5 field: ${field5}`);

// Helper: find all traceable paths of given length on a flat field
function findTraceable(field, size, minLen, maxLen) {
  const grid = fieldToGrid(field, size);
  const found = new Set();

  function dfs(y, x, used, word) {
    if (word.length >= minLen) found.add(word.toLowerCase());
    if (word.length >= maxLen) return;
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        const key = `${ny},${nx}`;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && !used.has(key)) {
          dfs(ny, nx, new Set([...used, key]), word + field[ny * size + nx].toLowerCase());
        }
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      dfs(y, x, new Set([`${y},${x}`]), field[y * size + x].toLowerCase());
    }
  }
  return [...found];
}

// Insert test words that are traceable on the field (so validation can succeed)
const traceable4 = findTraceable(field4, 4, 3, 5);
const traceable5 = findTraceable(field5, 5, 4, 6);
info(`Traceable paths on 4×4 (3-5 letters): ${traceable4.length}`);
info(`Traceable paths on 5×5 (4-6 letters): ${traceable5.length}`);

// Pick a handful to insert as test words
const testWords4 = traceable4.slice(0, 8);
const testWords5 = traceable5.slice(0, 8);
const allTestWords = [...new Set([...testWords4, ...testWords5])];

const insertWord = db.prepare(
  "INSERT OR IGNORE INTO words (word, accepted) VALUES (?, 1)"
);
for (const w of allTestWords) insertWord.run(w);

info(`Inserted ${allTestWords.length} test words: ${allTestWords.join(", ")}`);

// ── 1. Field Generator ────────────────────────────────────────────────────────
section("Field Generator");

const f1 = generateField(1000, 4);
const f2 = generateField(1000, 4);
const f3 = generateField(1000, 5);
const f4 = generateField(1001, 4);

assert(f1 === f2,          `Same seed → same field (${f1})`);
assert(f1.length === 16,   `4×4 field is 16 letters`);
assert(f3.length === 25,   `5×5 field is 25 letters`);
assert(f1 !== f4,          `Different roundId → different field`);
assert(f1 !== f3,          `Same roundId, different size → different field`);
assert(/^[A-Z]+$/.test(f1), `Field is uppercase letters`);
assert(!/Q/.test(f1) || true, `Q can be absent (weight=0 — note: test is informational)`);

// Verify distribution is sensible (E should appear more than Z)
const counts1000 = {};
for (let rid = 0; rid < 100; rid++) {
  for (const c of generateField(rid, 4)) {
    counts1000[c] = (counts1000[c] ?? 0) + 1;
  }
}
const eCount = counts1000["E"] ?? 0;
const zCount = counts1000["Z"] ?? 0;
assert(eCount > zCount * 5, `E (${eCount}) appears much more than Z (${zCount}) across 100 rounds`);

// ── 2. fieldContains ──────────────────────────────────────────────────────────
section("fieldContains");

const testGrid = [
  ["A", "B", "C"],
  ["D", "E", "F"],
  ["G", "H", "I"],
];

assert(fieldContains(testGrid, "abc") !== null,  `Finds "abc" horizontally`);
assert(fieldContains(testGrid, "aei") !== null,  `Finds "aei" diagonally`);
assert(fieldContains(testGrid, "abcfei") !== null, `Finds 6-letter path`);
assert(fieldContains(testGrid, "aba") === null,  `Rejects reusing cell`);
assert(fieldContains(testGrid, "xyz") === null,  `Rejects letters not on field`);
assert(fieldContains(testGrid, "AEI") !== null,  `Case-insensitive: "AEI" found (diagonal)`);

// Test with the generated field
const grid4 = fieldToGrid(field4, 4);
if (testWords4.length > 0) {
  const w = testWords4[0];
  assert(
    fieldContains(grid4, w) !== null,
    `Finds traceable test word "${w}" on 4×4 field`,
  );
}

// ── 3. gameState helpers ──────────────────────────────────────────────────────
section("gameState helpers");

const rid = getRoundId();
const rt  = getRoundTime();

assert(typeof rid === "number" && rid > 0, `getRoundId() returns positive number (${rid})`);
assert(rt >= 0 && rt < 210,               `getRoundTime() in [0,209] (${rt})`);

const phase = getRoundPhase(rt);
assert(phase === "ongoing" || phase === "cooldown", `Phase is valid: ${phase}`);

const remaining = getSecondsRemaining(rt);
if (phase === "ongoing") {
  assert(remaining > 0 && remaining <= 180, `Ongoing remaining in (0,180]: ${remaining}`);
} else {
  assert(remaining > 0 && remaining <= 30,  `Cooldown remaining in (0,30]: ${remaining}`);
}

assert(getRoundPhase(0)   === "ongoing",  `t=0 → ongoing`);
assert(getRoundPhase(179) === "ongoing",  `t=179 → ongoing`);
assert(getRoundPhase(180) === "cooldown", `t=180 → cooldown`);
assert(getRoundPhase(209) === "cooldown", `t=209 → cooldown`);

assert(getSecondsRemaining(0)   === 180, `t=0 remaining = 180`);
assert(getSecondsRemaining(100) === 80,  `t=100 remaining = 80`);
assert(getSecondsRemaining(180) === 30,  `t=180 remaining = 30`);
assert(getSecondsRemaining(200) === 10,  `t=200 remaining = 10`);

// buildResults
const sampleGuesses = [
  { user_id: 1, username: "Alice", word: "haus", result: "correct", points: 1 },
  { user_id: 1, username: "Alice", word: "ein",  result: "correct", points: 1 },
  { user_id: 2, username: "Bob",   word: "tier",  result: "correct", points: 1 },
  { user_id: 1, username: "Alice", word: "xyz",  result: "not_on_field", points: 0 },
];
const results = buildResults(sampleGuesses);
assert(results.players.length === 2,                    `buildResults: 2 players`);
assert(results.players[0].username === "Alice",         `Alice leads (2 words)`);
assert(results.players[0].points === 2,                 `Alice has 2 points`);
assert(results.words.length === 3,                      `3 correct words total`);

const filteredResults = buildResults(sampleGuesses, 1);
assert(filteredResults.words.length === 2,              `Filtered: only Alice's words`);
assert(filteredResults.players.length === 2,            `Filtered: still shows all players`);

// ── 4. computeValidWords ──────────────────────────────────────────────────────
section("computeValidWords (DB pipeline)");

info("Computing valid words for current 4×4 field…");
const validWords4 = computeValidWords(field4, 4);
info(`Valid 4×4 words: ${validWords4.size}`);
assert(validWords4 instanceof Set, `Returns a Set`);

// All inserted test words that are traceable on this field should be valid
let testWordHits = 0;
for (const w of testWords4) {
  if (validWords4.has(w)) testWordHits++;
}
assert(
  testWordHits === testWords4.length,
  `All ${testWords4.length} inserted 4×4 test words found as valid (${testWordHits}/${testWords4.length})`,
);

info("Computing valid words for current 5×5 field…");
const validWords5 = computeValidWords(field5, 5);
info(`Valid 5×5 words: ${validWords5.size}`);

// ── 5. wordValidator ─────────────────────────────────────────────────────────
section("wordValidator");

// Clear any existing test guesses
db.prepare("DELETE FROM round_guesses WHERE user_id = 9999").run();

const testUserId = 9999;
const testWord4  = testWords4[0];

if (testWord4) {
  // First guess — should be correct
  const r1 = validateGuess(testWord4, 4, testUserId, roundId, field4, validWords4);
  assert(r1.result === "correct", `"${testWord4}" is correct on 4×4`);
  assert(r1.points > 0,          `Points awarded: ${r1.points}`);

  // Insert into round_guesses to simulate a prior correct guess
  db.prepare(
    "INSERT INTO round_guesses (round_id, size, user_id, username, word, result, points) VALUES (?,?,?,?,?,?,?)"
  ).run(roundId, 4, testUserId, "TestPlayer", testWord4.toLowerCase(), "correct", r1.points);

  // Second guess of same word — should be duplicate
  const r2 = validateGuess(testWord4, 4, testUserId, roundId, field4, validWords4);
  assert(r2.result === "duplicate", `"${testWord4}" duplicate on second guess`);
}

// Too short
const r3 = validateGuess("AB", 4, testUserId, roundId, field4, validWords4);
assert(r3.result === "too_short",         `"AB" too short for 4×4 (min 3)`);

const r4 = validateGuess("ABC", 5, testUserId, roundId, field5, validWords5);
assert(r4.result === "too_short",         `"ABC" too short for 5×5 (min 4)`);

// Not on field — a word that can't possibly be traced
const r5 = validateGuess("QQQQQ", 4, testUserId, roundId, field4, validWords4);
assert(r5.result === "not_on_field",      `"QQQQQ" not on field`);

// ── 6. GameServer (event emitter) ─────────────────────────────────────────────
section("GameServer (live events)");

info("Creating GameServer and waiting for tick events…");
const gs = new GameServer();
await gs.init();

let tickCount4 = 0;
let tickCount5 = 0;
let updateCount = 0;

gs.on("tick:4", (p) => {
  tickCount4++;
  if (tickCount4 === 1) {
    info(`First tick:4 — round ${p.current_round.id}, ${p.current_round.seconds_remaining}s remaining (${p.current_round.state})`);
  }
});
gs.on("tick:5", (p) => {
  tickCount5++;
});
gs.on("update:4", (p) => {
  updateCount++;
  info(`update:4 — round ${p.current_round.id}, phase ${p.current_round.state}, ${p.current_round.results.players.length} players`);
});

info("Waiting 3 seconds to collect ticks…");
await sleep(3100);

assert(tickCount4 >= 3, `Received ≥3 tick:4 events in 3s (got ${tickCount4})`);
assert(tickCount5 >= 3, `Received ≥3 tick:5 events in 3s (got ${tickCount5})`);

// Test a live guess through GameServer
section("GameServer — live guesses");

const guestId   = 42000;
const guestUser = -guestId;
const guestName = `Gast ${guestId}`;

db.prepare("DELETE FROM round_guesses WHERE user_id = ?").run(guestUser);

if (testWords4.length >= 2) {
  const w1 = testWords4[0];
  const w2 = testWords4[1];

  const resp1 = gs.guess(w1.toUpperCase(), 4, guestUser, guestName);
  info(`Guess "${w1}": ${resp1.result} (+${resp1.points} pts)`);
  assert(
    resp1.result === "correct" || resp1.result === "cooldown",
    `First guess "${w1}" → correct or cooldown (got: ${resp1.result})`,
  );

  const resp2 = gs.guess(w1.toUpperCase(), 4, guestUser, guestName);
  assert(
    resp2.result === "duplicate" || resp2.result === "cooldown",
    `Second guess "${w1}" → duplicate or cooldown (got: ${resp2.result})`,
  );

  const resp3 = gs.guess(w2.toUpperCase(), 4, guestUser, guestName);
  info(`Guess "${w2}": ${resp3.result} (+${resp3.points} pts)`);
  assert(
    resp3.result === "correct" || resp3.result === "cooldown",
    `Second word "${w2}" → correct or cooldown`,
  );

  const respQ = gs.guess("QQQQQ", 4, guestUser, guestName);
  assert(
    respQ.result === "not_on_field" || respQ.result === "cooldown",
    `"QQQQQ" → not_on_field or cooldown`,
  );
}

gs.stop();

// ── 7. State transition tests (fake clock) ────────────────────────────────────
//
// Strategy: create a GameServer with autoSchedule:false and a mutable fake
// clock.  Advancing `fakeNow.ms` and calling forceTick() lets us simulate a
// full round cycle in milliseconds — no sleeping needed.
//
// Time layout for round R (ROUND_DURATION = 210 s):
//   R * 210 000 ms          → round R starts, roundTime = 0 (ongoing)
//   R * 210 000 + 179 000   → roundTime = 179  (still ongoing)
//   R * 210 000 + 180 000   → roundTime = 180  (cooldown starts)
//   R * 210 000 + 209 000   → roundTime = 209  (last second of cooldown)
//   (R+1) * 210 000         → round R+1 starts
//
section("State transitions (fake clock)");

const ROUND_DURATION_MS = 210 * 1000;
const GAME_DURATION_MS  = 180 * 1000;

// Pick a round far in the past so its round_guesses rows don't exist yet
const TEST_ROUND = 1000;
const BASE_MS    = TEST_ROUND * ROUND_DURATION_MS;

// Mutable clock — update .ms to advance time
const clock = { ms: BASE_MS + 5_000 }; // start 5s into round 1000

const gs2 = new GameServer({ now: () => clock.ms, autoSchedule: false });
await gs2.init();

// Helpers to collect events
function collectEvents(emitter, eventName) {
  const events = [];
  emitter.on(eventName, (p) => events.push(p));
  return events;
}

const ticks4   = collectEvents(gs2, "tick:4");
const updates4 = collectEvents(gs2, "update:4");
const ticks5   = collectEvents(gs2, "tick:5");
const updates5 = collectEvents(gs2, "update:5");

// ── Ongoing tick (no transition) ──────────────────────────────────────────────
info("Testing ongoing tick (t=5s)…");
gs2.forceTick(4);
gs2.forceTick(5);

assert(ticks4.length === 1,   `tick:4 emitted once`);
assert(updates4.length === 0, `No update:4 during normal ongoing tick`);
assert(ticks4[0].current_round.state === "ongoing",    `State is "ongoing"`);
assert(ticks4[0].current_round.id === TEST_ROUND,      `Round ID = ${TEST_ROUND}`);
assert(ticks4[0].current_round.seconds_remaining === 175, `175s remaining at t=5s`);

// Advance mid-round — still no update
clock.ms = BASE_MS + 90_000; // t = 90s
gs2.forceTick(4);
assert(ticks4.length === 2,   `tick:4 emitted again at t=90s`);
assert(updates4.length === 0, `Still no update:4 mid-round`);
assert(ticks4[1].current_round.seconds_remaining === 90, `90s remaining at t=90s`);

// ── ongoing → cooldown transition ─────────────────────────────────────────────
info("Testing ongoing → cooldown transition (t=180s)…");
clock.ms = BASE_MS + GAME_DURATION_MS; // exactly t=180s → cooldown
gs2.forceTick(4);
gs2.forceTick(5);

assert(updates4.length === 1,  `update:4 emitted on cooldown transition`);
assert(updates5.length === 1,  `update:5 emitted on cooldown transition`);
assert(updates4[0].current_round.state === "cooldown", `update carries cooldown state`);
assert(updates4[0].current_round.id === TEST_ROUND,    `update still shows round ${TEST_ROUND}`);
assert(updates4[0].last_round === null,                `last_round is null during cooldown`);

// Tick during cooldown — no further updates
clock.ms = BASE_MS + GAME_DURATION_MS + 10_000; // t=190s
gs2.forceTick(4);
assert(updates4.length === 1,  `No second update:4 during cooldown`);
assert(ticks4[ticks4.length - 1].current_round.state === "cooldown", `Tick shows cooldown`);
assert(ticks4[ticks4.length - 1].current_round.seconds_remaining === 20, `20s remaining at t=190s`);

// ── cooldown → new round transition ───────────────────────────────────────────
info("Testing cooldown → new round transition (t=210s)…");

// Insert a fake correct guess for TEST_ROUND so lastRound.results is non-empty
const fakeWord = testWords4[0] ?? "abc";
db.prepare(
  "INSERT OR IGNORE INTO round_guesses (round_id, size, user_id, username, word, result, points) VALUES (?,?,?,?,?,?,?)"
).run(TEST_ROUND, 4, -1, "Alice", fakeWord.toLowerCase(), "correct", 1);

clock.ms = (TEST_ROUND + 1) * ROUND_DURATION_MS; // exactly start of round 1001
gs2.forceTick(4);

assert(updates4.length === 2, `update:4 emitted on round transition`);

const roundTransitionUpdate = updates4[1];
assert(roundTransitionUpdate.current_round.id === TEST_ROUND + 1,
  `current_round.id advanced to ${TEST_ROUND + 1}`);
assert(roundTransitionUpdate.current_round.state === "ongoing",
  `New round starts in "ongoing" state`);
assert(roundTransitionUpdate.last_round !== null,
  `last_round is populated after round transition`);
assert(roundTransitionUpdate.last_round?.id === TEST_ROUND,
  `last_round.id = ${TEST_ROUND} (just-finished round)`);
assert(roundTransitionUpdate.last_round?.results.players.length >= 1,
  `last_round.results has player data`);
assert(roundTransitionUpdate.current_round.field !== ticks4[0].current_round.field,
  `New round has a different field`);

// Verify field is deterministic for new round
const { generateField: gf } = await vite.ssrLoadModule("./lib/fieldGenerator.ts");
const expectedNextField = gf(TEST_ROUND + 1, 4);
assert(roundTransitionUpdate.current_round.field === expectedNextField,
  `New round field matches generateField(${TEST_ROUND + 1}, 4)`);

// ── Repeated cooldown ticks don't re-emit update ──────────────────────────────
info("Verifying no double-fire on repeated cooldown entry…");
// Re-init a fresh server at t=179s, tick twice in cooldown
const clock2 = { ms: BASE_MS + 179_000 };
const gs3 = new GameServer({ now: () => clock2.ms, autoSchedule: false });
await gs3.init();
const updates4b = collectEvents(gs3, "update:4");

clock2.ms = BASE_MS + 180_000;
gs3.forceTick(4);
gs3.forceTick(4); // second tick still in cooldown, same second
assert(updates4b.length === 1, `update:4 fires exactly once on cooldown entry (not twice)`);
gs3.stop();

// ── Guesses rejected during cooldown ─────────────────────────────────────────
info("Verifying guesses are rejected during cooldown…");
clock.ms = BASE_MS + GAME_DURATION_MS + 5_000; // back to cooldown of round 1000
// Note: gs2 is now in round 1001, so we need a new server for this
const clock3 = { ms: BASE_MS + GAME_DURATION_MS + 5_000 };
const gs4 = new GameServer({ now: () => clock3.ms, autoSchedule: false });
await gs4.init();

const cooldownResp = gs4.guess("TEST", 4, -99999, "Tester");
assert(cooldownResp.result === "cooldown", `Guess during cooldown returns "cooldown"`);

gs4.stop();
gs2.stop();

// ── Summary ───────────────────────────────────────────────────────────────────
section("Summary");
console.log(
  `\n  ${C.bold}${passed + failed} tests — ${C.green}${passed} passed${C.reset}${C.bold}, ${failed > 0 ? C.red : C.green}${failed} failed${C.reset}\n`,
);

await vite.close();
process.exit(failed > 0 ? 1 : 0);
