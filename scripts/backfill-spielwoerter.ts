/**
 * Sends the proposals that never reached spielwoerter.de.
 *
 * The bridge POSTed with an empty API key from launch until 2026-08-09 and
 * never looked at the answer, so about 540 finalized proposals were dropped in
 * silence — six weeks of players reporting missing and wrong words, and of
 * moderators cleaning up, with nothing at the far end. They are all still in
 * word_proposals. This walks them.
 *
 * Safe to run repeatedly: anything accepted is stamped with
 * synced_to_spielwoerter_at and skipped next time.
 *
 * Most of the backlog would change nothing, so it is filtered against the live
 * word list first — sending a word that is already there, or removing one that
 * has already gone, spends a volunteer's attention to achieve nothing. Only
 * items with net support >= 2 are applied automatically; everything else lands
 * in a human queue, which is why the batch size and --batches exist: send a
 * hundred, look at what it did to the queue, decide whether to continue.
 *
 *   node --import tsx/esm scripts/backfill-spielwoerter.ts             # dry run
 *   node --import tsx/esm scripts/backfill-spielwoerter.ts --write
 *   node --import tsx/esm scripts/backfill-spielwoerter.ts --write --batches 1
 *   … --only remove | --only add
 *
 * Needs SPIELWOERTER_API_KEY and DATABASE_PATH (as the server has them).
 */

import { getDb } from "../lib/db.js";
import { partnerEmail } from "../lib/wordProposalServer.js";

const SUGGESTIONS_URL = "https://spielwoerter.de/api/partner/suggestions";
const WORDLIST_URL = "https://spielwoerter.de/api/words.csv";
const BATCH_SIZE = 100; // the API's documented maximum
const MAX_VOTERS_PER_SIDE = 50;

const args = process.argv.slice(2);
const write = args.includes("--write");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const maxBatches = args.includes("--batches")
  ? Number(args[args.indexOf("--batches") + 1])
  : Infinity;

type Row = {
  id: string;
  word: string;
  action: string;
  description: string | null;
  base: string | null;
  user_id: number;
  created_at: string;
};

type Item = {
  ids: string[];
  word: string;
  action: "upsert" | "remove";
  author: number;
  description: string | null;
  base: string | null;
  supporters: string[];
  opposers: string[];
};

const db = getDb();

// ── The live list, to drop everything that would change nothing ──────────────
process.stdout.write("fetching the current word list… ");
const csv = await (await fetch(WORDLIST_URL)).text();
const listed = new Set(
  csv
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0]?.trim().toLowerCase())
    .filter(Boolean),
);
console.log(`${listed.size} words`);

/**
 * spielwoerter refuses an ae/oe/ue/ss spelling when the umlaut sibling is
 * listed, so those are dropped here rather than spent on a round trip.
 */
function umlautSiblingListed(word: string): string | null {
  const found: string[] = [];
  const walk = (i: number, acc: string) => {
    if (i >= word.length) { found.push(acc); return; }
    const pair = word.slice(i, i + 2);
    if (pair === "ae") walk(i + 2, acc + "ä");
    if (pair === "oe") walk(i + 2, acc + "ö");
    if (pair === "ue" && word[i - 1] !== "q") walk(i + 2, acc + "ü");
    if (pair === "ss") walk(i + 2, acc + "ß");
    walk(i + 1, acc + word[i]);
  };
  walk(0, "");
  return found.find((c) => c !== word && listed.has(c)) ?? null;
}

// ── Everything still undelivered ─────────────────────────────────────────────
const rows = db
  .prepare(
    `SELECT id, word, action, description, base, user_id, created_at
     FROM word_proposals
     WHERE status IN ('approved','sent_for_approval')
       AND synced_to_spielwoerter_at IS NULL
     ORDER BY created_at`,
  )
  .all() as Row[];

const votesFor = db.prepare(
  "SELECT user_id, vote FROM word_proposal_votes WHERE proposal_id = ?",
);

// Several proposals can exist for one word: keep the newest wording, but pool
// every vote cast on any of them — they were all votes about this word.
const merged = new Map<string, Item>();
for (const row of rows) {
  const action = row.action === "remove" ? "remove" : "upsert";
  const key = `${row.word.toLowerCase()}|${action}`;
  const existing = merged.get(key);

  const item: Item = existing ?? {
    ids: [],
    word: row.word.toLowerCase(),
    action,
    author: row.user_id,
    description: row.description,
    base: row.base,
    supporters: [],
    opposers: [],
  };

  item.ids.push(row.id);
  // Rows arrive oldest first, so the last one seen is the newest wording.
  item.author = row.user_id;
  item.description = row.description;
  item.base = row.base;

  for (const v of votesFor.all(row.id) as { user_id: number; vote: string }[]) {
    if (v.user_id <= 0) continue;
    const side = v.vote === "support" ? item.supporters : item.opposers;
    const email = partnerEmail(v.user_id);
    if (!side.includes(email)) side.push(email);
  }

  merged.set(key, item);
}

// ── Drop what cannot achieve anything ────────────────────────────────────────
const skipped = { addListed: 0, removeGone: 0, umlaut: 0, removeUmlaut: 0 };
let queue: Item[] = [];

for (const item of merged.values()) {
  if (item.action === "remove") {
    if (!listed.has(item.word)) {
      // The game spells words without umlauts, so a report against "saehle"
      // cannot remove the listed "sähle" — and asking for the ae form to go
      // achieves nothing, since the sibling is what feeds the game. These are
      // counted rather than sent; they need reporting against the umlaut
      // spelling, which is a question for the player, not for this script.
      if (umlautSiblingListed(item.word)) skipped.removeUmlaut++;
      else skipped.removeGone++;
      continue;
    }
  } else {
    if (listed.has(item.word)) { skipped.addListed++; continue; }
    const sibling = umlautSiblingListed(item.word);
    if (sibling) { skipped.umlaut++; continue; }
  }

  // The API rejects the whole item if the author votes on it, or if a side is
  // over fifty.
  const author = partnerEmail(item.author);
  item.supporters = item.supporters.filter((e) => e !== author).slice(0, MAX_VOTERS_PER_SIDE);
  item.opposers = item.opposers.filter((e) => e !== author).slice(0, MAX_VOTERS_PER_SIDE);
  queue.push(item);
}

// Removals first: they are the moderators' own clean-up and the highest
// confidence part of the backlog. Additions follow, where players are waiting.
queue.sort((a, b) => (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1));
if (only === "add") queue = queue.filter((i) => i.action === "upsert");
if (only === "remove") queue = queue.filter((i) => i.action === "remove");

const autoApprove = queue.filter((i) => i.supporters.length - i.opposers.length >= 2);

console.log(`\nundelivered proposals      ${rows.length}`);
console.log(`unique word+action         ${merged.size}`);
console.log(`  dropped, already listed  ${skipped.addListed}`);
console.log(`  dropped, already gone    ${skipped.removeGone}`);
console.log(`  dropped, umlaut sibling  ${skipped.umlaut}`);
console.log(`  removals of an ae form whose umlaut sibling is the listed one: ${skipped.removeUmlaut}`);
console.log(`to send                    ${queue.length}` +
  ` (${queue.filter((i) => i.action === "remove").length} remove, ${queue.filter((i) => i.action === "upsert").length} add)`);
console.log(`  of those, auto-approved  ${autoApprove.length} — the rest go to human review`);
if (autoApprove.length > 0) {
  console.log(`  ${autoApprove.map((i) => `${i.word} (${i.action})`).join(", ")}`);
}

if (!write) {
  console.log(`\nDry run. Add --write to send, --batches N to stop after N batches of ${BATCH_SIZE}.`);
  process.exit(0);
}

const key = process.env.SPIELWOERTER_API_KEY ?? "";
if (!key) {
  console.error("\nSPIELWOERTER_API_KEY is not set — refusing to send.");
  process.exit(1);
}

const markDelivered = db.prepare(
  "UPDATE word_proposals SET synced_to_spielwoerter_at = ? WHERE id = ?",
);

const tally: Record<string, number> = {};
let batchNo = 0;

for (let start = 0; start < queue.length; start += BATCH_SIZE) {
  if (batchNo >= maxBatches) {
    console.log(`\nStopping after ${batchNo} batch(es) as asked. ${queue.length - start} item(s) left.`);
    break;
  }
  const batch = queue.slice(start, start + BATCH_SIZE);
  batchNo++;
  console.log(`\n── batch ${batchNo}: ${batch.length} item(s) ──`);

  const res = await fetch(SUGGESTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({
      suggestions: batch.map((i) => ({
        word: i.word,
        action: i.action,
        author_email: partnerEmail(i.author),
        ...(i.action === "upsert" && {
          payload: {
            ...(i.description && { description: i.description }),
            ...(i.base && { base: i.base }),
          },
        }),
        ...(i.supporters.length > 0 && { supporters: i.supporters }),
        ...(i.opposers.length > 0 && { opposers: i.opposers }),
      })),
    }),
  });

  if (!res.ok) {
    console.error(`  HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.error("  Stopping — nothing in this batch was marked as delivered.");
    break;
  }

  const json = (await res.json()) as { results?: { status?: string; reason?: string }[] };
  const results = json.results ?? [];

  results.forEach((result, i) => {
    const item = batch[i];
    const status = result.status ?? "no result";
    tally[status] = (tally[status] ?? 0) + 1;

    if (status === "moderator_approved" || status === "pending_review") {
      const now = new Date().toISOString();
      for (const id of item.ids) markDelivered.run(now, id);
    } else {
      // Left unmarked on purpose: a skip is a decision worth seeing again
      // rather than something to quietly file as done.
      console.log(`  ${item.word} (${item.action}): ${status}${result.reason ? ` — ${result.reason}` : ""}`);
    }
  });

  const accepted = results.filter(
    (r) => r.status === "moderator_approved" || r.status === "pending_review",
  ).length;
  console.log(`  accepted ${accepted}/${batch.length}`);
}

console.log("\n── totals ──");
for (const [status, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(20)} ${n}`);
}
const left = db
  .prepare(
    `SELECT COUNT(*) c FROM word_proposals
     WHERE status IN ('approved','sent_for_approval') AND synced_to_spielwoerter_at IS NULL`,
  )
  .get() as { c: number };
console.log(`\nstill unmarked in the database: ${left.c}`);
