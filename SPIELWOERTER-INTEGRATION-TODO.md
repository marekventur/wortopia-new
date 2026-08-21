# Spielwoerter integration: verify the fix, then backfill

Handoff from the spielwoerter-website side, 2026-08-09. Context: the partner-API
bridge to spielwoerter.de has been silently broken since launch — root cause
found and the config half already fixed. This doc covers what remains on the
wortopia side.

## What happened (already diagnosed, config already fixed)

- `lib/wordProposalServer.ts` POSTs finalized proposals (status `approved` or
  `sent_for_approval`) to `https://spielwoerter.de/api/partner/suggestions`, and
  `lib/gameWsServer.ts` proxies `GET /api/partner/enrich/:word` for in-game word
  descriptions. Both authenticate with `process.env.SPIELWOERTER_API_KEY`.
- That variable was **never set in production** (`.env.production.local`), so
  every request went out with an empty key → 401. Because the POST is
  `void fetch(...)` with no error handling, nothing was ever logged. The
  spielwoerter side counted ~1,151 rejected requests; exactly one suggestion
  (a manual test on 2026-05-01) ever arrived.
- **Already fixed (2026-08-09):** the key is now in
  `/var/www/wortopia-new/.env.production.local` on the server AND in the GitHub
  Actions variable `ENV_FILE` on `marekventur/wortopia-new` (deploys rewrite the
  env file from that variable — keep the key in both in sync). The app was
  restarted and the key verified against the enrich endpoint (200).
- API reference: https://github.com/marekventur/spielwoerter-website/blob/main/docs/partner-api.md
  (the repo is public now).

## 1. Make failures visible (do this first)

In `finalizeExpired()` (`lib/wordProposalServer.ts` ~line 288): the POST is
fire-and-forget. Change it to await the response, check `res.ok`, parse the
per-item `results` array, and log anything that is not `moderator_approved` /
`pending_review` (word + status + reason). A six-week outage went unnoticed
purely because of this. Consider recording delivery on the proposal row
(e.g. a `synced_to_spielwoerter_at` column) so undelivered proposals stay
queryable — that also makes the backfill in §4 idempotent.

## 2. Send the votes (currently the bridge never auto-approves)

The POST body omits `supporters`/`opposers`, so spielwoerter computes
`net_support = 0` and **every** submission lands in the human moderation queue.
The votes exist in `word_proposal_votes` (`proposal_id`, `user_id`,
`vote` = 'support' | 'oppose'). Map them to emails with the same synthetic
scheme the author already uses: `user-<user_id>@wortopia.de`.

Spielwoerter's validation (per-item error if violated): author must not appear
in either list, no email in both lists, max 50 per list. `net_support >= 2`
auto-approves; the word is then published on spielwoerter's next hourly sync.

## 3. Test end-to-end

- The bridge only fires when `NODE_ENV === "production"`, so test on the VPS.
  For a direct check without waiting for a vote window:
  `curl -H "X-API-Key: $SPIELWOERTER_API_KEY" -H "Content-Type: application/json" -d '{...}' https://spielwoerter.de/api/partner/suggestions`
  with a single real pending word. Avoid junk words — real submissions land in
  a human moderation queue. (A previous "testtest" had to be hand-rejected.)
- Marek can confirm arrivals on the spielwoerter side:
  `SELECT word, action, status, created_at FROM suggestions WHERE partner_key_label IS NOT NULL ORDER BY created_at DESC`
  (key label `pk-0ab86`, DB at `/var/www/spielwoerter.de/data/app.db`).
- Expect and handle these per-item result statuses: `skipped/blocked`
  (word/action was previously rejected — resubmission via API is not possible,
  only via the website with a justification), `skipped/conflict` (an in-flight
  suggestion exists and net support < 2), and the new
  `umlaut-substituted spelling of '<word>'` (spielwoerter now refuses ae/oe/ue/ss
  spellings whose umlaut sibling is already listed — submit the umlaut spelling
  instead; relevant because the game alphabet may produce ae-forms).

## 4. Backfill the ~530 dropped proposals

Everything finalized since 2026-07-27 was lost to the 401s but is still in the
wortopia DB. As of 2026-08-09: **15 `approved` + 516 `sent_for_approval`** rows
in `word_proposals`.

Script sketch (run once, on the server, against `DATABASE_PATH`):

1. Select `word_proposals` with `status IN ('approved','sent_for_approval')`
   and no delivery marker.
2. Join votes per proposal; build items exactly as §2 (word, action
   `remove`→`remove` else `upsert`, author, supporters/opposers, payload with
   `description`/`base` when present).
3. Dedup within the run: same word+action from several proposals → keep the
   newest, merge voter lists.
4. POST in batches of ≤100 (API max), log every per-item result, mark delivered
   rows.
5. Expect a meaningful share of `skipped` results — some words changed state
   since July (already added, already blocked, in review). That's fine; log and
   move on. Note: `upsert` for a word that meanwhile exists becomes a
   description change and then **requires** `description` or `base` in the
   payload, else it errors.

**Coordinate timing with Marek before running:** items with net support < 2
land in the spielwoerter moderation queue, and this could drop several hundred
items on the volunteer moderators at once. Options: spread batches over days,
or prefilter against the current wordlist (`/api/words.csv`) and only submit
words whose state would actually change.

## 5. While you're in there: faster wordlist sync

New public endpoint (no auth): `GET https://spielwoerter.de/api/latest-update`
→ `{"version": "<opaque string>"}`, cacheable 60 s. Poll it every few minutes
and re-pull `/api/words.csv` only when `version` differs from the last seen
value. This replaces the fixed 03:00 daily pull and kills the "my approved word
still doesn't work in the game" complaints (players read the up-to-24 h lag as
their reports being ignored).

Related, worth a look during the same pass: players report deletions not taking
effect in the game (e.g. "Buessi", removed from the list on 16.05, still
playable in August) — check that the import actually removes words that
disappeared from the CSV rather than only adding new ones.
