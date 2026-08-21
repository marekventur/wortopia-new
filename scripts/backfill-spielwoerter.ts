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
import { listedSpellings } from "../lib/wordSpellings.js";

const SUGGESTIONS_URL = "https://spielwoerter.de/api/partner/suggestions";
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
  /** How spielwoerter.de spells it — more than one when it lists the word twice. */
  words: string[];
  action: "upsert" | "remove";
  author: number;
  description: string | null;
  base: string | null;
  supporters: string[];
  opposers: string[];
};

const db = getDb();

// ── The live list, to drop everything that would change nothing ──────────────
// It is the game's own copy, kept within minutes of spielwoerter.de by the
// sync, and it now records the spelling each word is listed under — so the
// question "would this change anything" is answered without guessing which
// ae/oe/ue was meant to be an umlaut.
const { words: listedCount } = db.prepare("SELECT COUNT(*) AS words FROM words").get() as {
  words: number;
};
if (listedCount === 0) {
  console.error("The word list is empty — a sync has to run before this can judge anything.");
  process.exit(1);
}
console.log(`the word list holds ${listedCount} words`);

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
    words: [],
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
const skipped = { addListed: 0, removeGone: 0 };
let queue: Item[] = [];
let doubleListed = 0;

for (const item of merged.values()) {
  const spellings = listedSpellings(item.word);

  if (item.action === "remove") {
    // Nothing to remove: either it was never there or someone got there first.
    if (spellings.length === 0) { skipped.removeGone++; continue; }
    // Both "abbeisse" and "abbeiße" listed: the game plays the word until both
    // are gone, so the removal has to name both.
    if (spellings.length > 1) doubleListed++;
    item.words = spellings;
  } else {
    // Listed under any spelling means the word is in the game already — which
    // is what the player was asking for.
    if (spellings.length > 0) { skipped.addListed++; continue; }
    item.words = [item.word];
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
console.log(`  removals naming two spellings at once: ${doubleListed}`);
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
let cursor = 0;

/** As many items as fit, counting spellings — a two-spelling removal is two. */
function nextBatch(): Item[] {
  const batch: Item[] = [];
  let size = 0;
  while (cursor < queue.length && size + queue[cursor].words.length <= BATCH_SIZE) {
    size += queue[cursor].words.length;
    batch.push(queue[cursor++]);
  }
  return batch;
}

while (cursor < queue.length) {
  if (batchNo >= maxBatches) {
    console.log(`\nStopping after ${batchNo} batch(es) as asked. ${queue.length - cursor} item(s) left.`);
    break;
  }
  const batch = nextBatch();
  const suggestions = batch.flatMap((i) =>
    i.words.map((word) => ({
      word,
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
  );
  batchNo++;
  console.log(`\n── batch ${batchNo}: ${batch.length} item(s), ${suggestions.length} suggestion(s) ──`);

  const res = await fetch(SUGGESTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({ suggestions }),
  });

  if (!res.ok) {
    console.error(`  HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.error("  Stopping — nothing in this batch was marked as delivered.");
    break;
  }

  const json = (await res.json()) as { results?: { status?: string; reason?: string }[] };
  const results = json.results ?? [];
  const accepted = (r?: { status?: string }) =>
    r?.status === "moderator_approved" || r?.status === "pending_review";

  let offset = 0;
  let acceptedItems = 0;
  for (const item of batch) {
    const mine = results.slice(offset, offset + item.words.length);
    offset += item.words.length;

    item.words.forEach((word, i) => {
      const status = mine[i]?.status ?? "no result";
      tally[status] = (tally[status] ?? 0) + 1;
      if (!accepted(mine[i])) {
        console.log(`  ${word} (${item.action}): ${status}${mine[i]?.reason ? ` — ${mine[i].reason}` : ""}`);
      }
    });

    // Every spelling or none: a word listed twice is still playable while one
    // listing survives, so half a removal is not a delivery. Left unmarked on
    // purpose — a skip is a decision worth seeing again rather than something
    // to quietly file as done.
    if (item.words.every((_, i) => accepted(mine[i]))) {
      acceptedItems++;
      const now = new Date().toISOString();
      for (const id of item.ids) markDelivered.run(now, id);
    }
  }
  console.log(`  accepted ${acceptedItems}/${batch.length}`);
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
