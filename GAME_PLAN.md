# Game Loop Plan

## 1. Config file — `lib/gameConfig.ts`

Holds letter distribution, scoring table, and game constants. No env vars needed — baked in.

```ts
ROUND_DURATION = 210       // seconds per round (180 gameplay + 30 cooldown)
GAME_DURATION  = 180       // seconds of active gameplay
COOLDOWN       = 30        // seconds of cooldown
SIZES          = [4, 5]    // always two games running
MIN_WORD_LENGTH = { 4: 3, 5: 4 }
// Q has 0 distribution weight so it never appears on the field — no QU logic needed

DISTRIBUTION: { A: 21, B: 6, C: 12, D: 18, E: 48, ... }  // from config.sample.json
SCORES: { 3: 1, 4: 1, 5: 2, 6: 3, 7: 5, 8: 11, 9: 17, 10: 25, ... }
```

---

## 2. Seeded field generation — `lib/fieldGenerator.ts`

**No external dependency.** A simple LCG (Linear Congruential Generator) is 3 lines and
sufficient for non-cryptographic shuffling. Numerical Recipes constants:

```ts
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}
```
 write a test for the shuffling logic!

**Seed**: `roundId * 10 + size` — ensures 4x4 and 5x5 get different fields for the same round.

**Algorithm**:
1. Build a weighted letter pool from DISTRIBUTION (21 A's, 6 B's, etc.)
2. Run seeded Fisher-Yates shuffle on the pool
3. Take the first `size²` letters

**Output**: uppercase string of `size²` letters, e.g. `"ABCDEFGHIJKLMNOP"`.

**Determinism**: Same `roundId` → same field every time, restart-resistant.

---

## 3. Database additions — `lib/db.ts`

### New column + index on `words`

SQLite expression indexes exist but the planner often skips them for `IN (...)` queries.
Instead, add a `GENERATED` column (SQLite 3.31+, always available in modern better-sqlite3)
and index that directly:

```sql
-- Add to words table definition in db.ts:
first_two TEXT GENERATED ALWAYS AS (substr(word, 1, 2)) STORED

-- Index:
CREATE INDEX IF NOT EXISTS words_first_two ON words (first_two);
```

No changes needed to the word sync code — SQLite populates generated columns automatically.

### New table: `round_guesses`

```sql
CREATE TABLE IF NOT EXISTS round_guesses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,   -- negative for guests
  username    TEXT    NOT NULL,
  word        TEXT    NOT NULL,  -- uppercase
  result      TEXT    NOT NULL,   -- 'correct' | 'not_on_field' | 'not_in_dictionary' | 'duplicate' | 'too_short'
  points      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS round_guesses_lookup
  ON round_guesses (round_id, size, user_id);
```

---

## 4. Valid word pre-computation — `lib/fieldWords.ts`

This is the performance-critical path, closely following the original's three-stage pipeline:

### Stage 1 — DB query with two-letter prefix index

Generate all two-character starting combinations from the field (e.g. `['JE', 'EE', 'EI', ...]`
— one per cell). Then:

```sql
SELECT word FROM words
WHERE first_two IN (?, ?, ...)
  AND length(word) >= ?
```

This uses the index to cut the dictionary down to ~2% of its size.

### Stage 2 — Letter-set filter (JS)

Filter out any word containing a letter not present in the field. Since SQLite has no
regex operator, this is done in JS: `word.split('').every(c => fieldLetterSet.has(c))`.
Another large reduction, cheap to run.

### Stage 3 — `fieldContains` path check (JS)

Apply the recursive backtracking check (same algorithm as `CurrentField.tsx` — port to
`lib/fieldContains.ts` and import from both client and server). This is the expensive step
but runs on an already tiny candidate list.

### Caching strategy

Following the original: pre-compute the **next** round's valid words during cooldown so
they're ready the moment the round starts. The game server holds:

```ts
type FieldCache = { field: string; validWords: Set<string> };
cache: { [size: number]: { current: FieldCache; next: FieldCache | null } }
```

- **On startup**: compute current and next fields synchronously before accepting connections.
- **When cooldown starts**: immediately kick off async computation of `next` in the background.
- **When new round starts**: promote `next → current`, start computing new `next`.

---

## 5. Game state helpers — `lib/gameState.ts`

Pure functions, no DB access:

```ts
getRoundId(): number                         // Math.floor(Date.now() / 1000 / 210)
getRoundPhase(roundTime): 'ongoing'|'cooldown'  // roundTime < 180 → ongoing
getSecondsRemaining(roundTime): number       // ongoing: 180 - t; cooldown: 210 - t
buildResults(guesses, full): ResultsMap      // full=false → only current player's data
```

---

## 6. Word validation — `lib/wordValidator.ts`

```ts
validateGuess(word, size, userId, roundId, validWords: Set<string>): GuessResult
```

Check order (matches UX expectations):
1. `word.length < MIN_WORD_LENGTH[size]` → `too_short`
2. Already in `round_guesses` for this (roundId, size, userId) with result=`correct` → `duplicate`
3. Not in `validWords` set (pre-computed, already confirms both on-field AND in-dictionary):
   - Run `fieldContains(word, field, size)` → if false → `not_on_field`
   - Otherwise → `not_in_dictionary`
4. → `correct`, compute points from SCORES

The `validWords` set avoids a DB call for the happy path.

---

## 7. Game server — `lib/gameServer.ts`

A `GameServer extends EventEmitter`. Owns all game logic — no WebSocket knowledge. Make sure to disable memory leak warnings, there will be more than 10 subscribers!

**On startup**: initialise field cache for both sizes, start per-size tick intervals.

**Tick loop** (self-scheduling `setTimeout`, one per size — avoids interval drift and stays
aligned to real second boundaries):

```ts
function scheduleTick() {
  const ms = 1000 - (Date.now() % 1000) + 10; // 10ms after next second boundary
  setTimeout(tick, ms);
}
// tick() does its work then calls scheduleTick() again
```
```
roundId    = getRoundId()
roundTime  = Math.floor(Date.now()/1000) % 210
state      = roundTime < 180 ? 'ongoing' : 'cooldown'

if roundId changed:
  promote next→current cache
  kick off next-field computation (async, background)
  fetch full results for the just-finished round from DB
  emit(`update:${size}`, { current_round, last_round })
else if state just flipped ongoing→cooldown:
  fetch current round full results from DB
  emit(`update:${size}`, { current_round (cooldown), last_round })
  kick off next-field computation (async, background)

emit(`tick:${size}`, { current_round: { id, size, field, seconds_remaining, state } })
```

State transition tracking: keep `prevRoundId` and `prevState` per size.

**Guess handling** — called by the WS server when a client sends a guess:
```ts
gameServer.guess(word, size, userId, username): GuessResponse
```
1. `validateGuess(word, size, userId, roundId, validWords)`
2. Insert into `round_guesses`
3. Return `{ word, result, player_results }`

---

## 8. WebSocket server — `lib/gameWsServer.ts`

Transport layer only. Subscribes to `GameServer` events and manages connections.

One `WebSocketServer` per size (`/ws/game/4`, `/ws/game/5`).

**On connect**:
1. Parse session cookie → userId / username (guests allowed)
2. Load this player's guesses for current round + last round results from DB
3. Send initial `{ type: "update", current_round: {..., results: playerOnly}, last_round: {...} }`
4. Subscribe this socket to the game server's events:
```ts
const onTick   = (p) => send(ws, { type: 'tick',   ...p });
const onUpdate = (p) => send(ws, { type: 'update', ...p });
gameServer.on(`tick:${size}`,   onTick);
gameServer.on(`update:${size}`, onUpdate);
ws.on('close', () => {
  gameServer.off(`tick:${size}`,   onTick);
  gameServer.off(`update:${size}`, onUpdate);
});
```

Each socket is its own subscriber — fanout happens naturally via the EventEmitter.
No broadcast loop, no client iteration.

**On message** — only one incoming message type:
```ts
{ type: "guess", word: "HAUS" }
```
→ `gameServer.guess(word, size, userId, username)` → send result back to this socket:
```ts
{ type: "guess_result", word, result, player_results }
```

**TODO (chat)**: Chat is currently a single global room (`/ws/chat`). It should be
size-scoped too (`/ws/chat/4`, `/ws/chat/5`). Same fix: create one `WebSocketServer` per
size in `lib/chatServer.ts`.

---

## 10. Files to create / modify

| File | Action |
|------|--------|
| `lib/gameConfig.ts` | New — letter distribution + scoring |
| `lib/fieldGenerator.ts` | New — LCG + seeded Fisher-Yates shuffle |
| `lib/fieldContains.ts` | New — extracted from CurrentField.tsx, shared client+server |
| `lib/fieldWords.ts` | New — three-stage valid word finder + cache |
| `lib/gameState.ts` | New — round timing helpers + results builder |
| `lib/wordValidator.ts` | New — guess validation |
| `lib/gameServer.ts` | New — EventEmitter game server (state, timing, guesses) |
| `lib/gameWsServer.ts` | New — WebSocket transport, subscribes to game server events |
| `lib/db.ts` | Modify — add `round_guesses` table + `words_first_two` index |
| `app/components/CurrentField.tsx` | Modify — import `fieldContains` from shared lib |
| `server.js` | Modify — mount game WebSocket server |

---

## 11. Out of scope for this plan

- Client-side game WebSocket integration (connect, tick handler, update handler)
- Leaderboard/highscore queries
- Admin tools
