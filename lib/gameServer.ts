import { EventEmitter } from "events";
import { getDb } from "./db.js";
import { generateField } from "./fieldGenerator.js";
import { computeValidWords } from "./fieldWords.js";
import {
  getRoundPhase,
  getSecondsRemaining,
  buildResults,
  type GuessRow,
  type RoundResults,
} from "./gameState.js";
import { validateGuess } from "./wordValidator.js";
import { SIZES, ROUND_DURATION, GAME_DURATION, type GameSize } from "./gameConfig.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldCache = {
  roundId: number;
  field: string;
  validWords: Set<string>;
};

export type CurrentRoundPayload = {
  id: number;
  size: number;
  field: string;
  seconds_remaining: number;
  state: "ongoing" | "cooldown";
  results: RoundResults;
};

export type LastRoundPayload = {
  id: number;
  size: number;
  field: string;
  results: RoundResults;
};

export type TickPayload = {
  current_round: Omit<CurrentRoundPayload, "results">;
};

export type UpdatePayload = {
  current_round: CurrentRoundPayload;
  last_round: LastRoundPayload | null;
};

export type GuessResponse = {
  word: string;
  result: string;
  points: number;
  player_results: RoundResults;
};

// ---------------------------------------------------------------------------
// Per-size state
// ---------------------------------------------------------------------------

type SizeState = {
  current: FieldCache;
  next: FieldCache | null;
  prevRoundId: number;
  prevPhase: "ongoing" | "cooldown";
  lastRound: LastRoundPayload | null;
  tickTimer: ReturnType<typeof setTimeout> | null;
};

// ---------------------------------------------------------------------------
// GameServer
// ---------------------------------------------------------------------------

export type GameServerOptions = {
  /**
   * Time source. Defaults to `Date.now`.
   * Override in tests to control round/phase transitions deterministically.
   */
  now?: () => number;
  /**
   * Set to false to disable the self-scheduling tick loop.
   * Use `forceTick(size)` to drive ticks manually in tests.
   */
  autoSchedule?: boolean;
};

export class GameServer extends EventEmitter {
  private state = new Map<GameSize, SizeState>();
  private readonly now: () => number;
  private readonly autoSchedule: boolean;

  constructor(opts: GameServerOptions = {}) {
    super();
    // Disable Node.js warning — we expect many subscribers (one per WS connection)
    this.setMaxListeners(0);
    this.now = opts.now ?? (() => Date.now());
    this.autoSchedule = opts.autoSchedule ?? true;
  }

  // Derive round state from the injected clock
  private currentRoundId(): number {
    return Math.floor(this.now() / 1000 / ROUND_DURATION);
  }

  private currentRoundTime(): number {
    return Math.floor(this.now() / 1000) % ROUND_DURATION;
  }

  /** Must be called once before the server starts accepting connections. */
  async init() {
    const roundId = this.currentRoundId();
    const roundTime = this.currentRoundTime();

    for (const size of SIZES) {
      const currentField = generateField(roundId, size);
      const currentValidWords = computeValidWords(currentField, size);

      const nextRoundId = roundId + 1;
      const nextField = generateField(nextRoundId, size);
      const nextValidWords = computeValidWords(nextField, size);

      const phase = getRoundPhase(roundTime);

      this.state.set(size, {
        current: { roundId, field: currentField, validWords: currentValidWords },
        next: { roundId: nextRoundId, field: nextField, validWords: nextValidWords },
        prevRoundId: roundId,
        prevPhase: phase,
        lastRound: null,
        tickTimer: null,
      });
    }

    // Start tick loops
    for (const size of SIZES) {
      this.scheduleTick(size);
    }

    console.log("[GameServer] Initialised. Current round:", roundId);
  }

  // -------------------------------------------------------------------------
  // Tick loop
  // -------------------------------------------------------------------------

  private scheduleTick(size: GameSize) {
    if (!this.autoSchedule) return;
    // Fire ~10ms after the next whole-second boundary to stay aligned
    const ms = 1000 - (this.now() % 1000) + 10;
    const s = this.state.get(size)!;
    s.tickTimer = setTimeout(() => this.tick(size), ms);
  }

  private tick(size: GameSize) {
    const s = this.state.get(size)!;
    const roundId = this.currentRoundId();
    const roundTime = this.currentRoundTime();
    const phase = getRoundPhase(roundTime);

    // ---- Round transition ----
    if (roundId !== s.prevRoundId) {
      const finishedRoundId = s.prevRoundId;
      const finishedField = s.current.field;

      // Promote next → current
      if (s.next && s.next.roundId === roundId) {
        s.current = s.next;
      } else {
        // next wasn't ready (shouldn't normally happen); compute synchronously
        const field = generateField(roundId, size);
        const validWords = computeValidWords(field, size);
        s.current = { roundId, field, validWords };
      }
      s.next = null;

      // Fetch full results for the just-finished round
      const finishedGuesses = this.loadGuesses(finishedRoundId, size);
      s.lastRound = {
        id: finishedRoundId,
        size,
        field: finishedField,
        results: buildResults(finishedGuesses),
      };

      s.prevRoundId = roundId;
      s.prevPhase = phase;

      // Kick off next-round computation in background
      this.computeNext(size, roundId);

      // Emit full update
      const updatePayload = this.buildUpdatePayload(size, undefined);
      this.emit(`update:${size}`, updatePayload);
    }
    // ---- Phase transition: ongoing → cooldown ----
    else if (s.prevPhase === "ongoing" && phase === "cooldown") {
      s.prevPhase = phase;

      // Fetch current round results (full)
      const guesses = this.loadGuesses(roundId, size);

      // Emit update with cooldown state + full results
      const updatePayload = this.buildUpdatePayload(size, undefined);
      // Attach full current round results for the cooldown broadcast
      updatePayload.current_round.results = buildResults(guesses);
      this.emit(`update:${size}`, updatePayload);

      // Kick off next-round computation
      this.computeNext(size, roundId);
    }

    // Always emit tick
    const tickPayload: TickPayload = {
      current_round: {
        id: s.current.roundId,
        size,
        field: s.current.field,
        seconds_remaining: getSecondsRemaining(roundTime),
        state: phase,
      },
    };
    this.emit(`tick:${size}`, tickPayload);

    this.scheduleTick(size);
  }

  /**
   * Manually drive a tick for testing.
   * Only meaningful when `autoSchedule: false`.
   */
  forceTick(size: GameSize) {
    this.tick(size);
  }

  private async computeNext(size: GameSize, currentRoundId: number) {
    const nextRoundId = currentRoundId + 1;
    const field = generateField(nextRoundId, size);
    const validWords = await Promise.resolve(computeValidWords(field, size));
    const s = this.state.get(size)!;
    s.next = { roundId: nextRoundId, field, validWords };
    console.log(
      `[GameServer] Pre-computed round ${nextRoundId} size ${size}: ${validWords.size} valid words`,
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Returns the current state payload for a specific size. Used on WS connect. */
  getInitialPayload(size: GameSize, forUserId?: number): UpdatePayload {
    return this.buildUpdatePayload(size, forUserId);
  }

  /** Handles a guess from a player. Inserts into DB and returns result. */
  guess(
    word: string,
    size: GameSize,
    userId: number,
    username: string,
  ): GuessResponse {
    const s = this.state.get(size)!;
    const roundId = s.current.roundId;
    const roundTime = this.currentRoundTime();
    const phase = getRoundPhase(roundTime);

    // Don't accept guesses during cooldown
    if (phase === "cooldown") {
      return {
        word,
        result: "cooldown",
        points: 0,
        player_results: buildResults(this.loadGuesses(roundId, size), userId),
      };
    }

    const { result, points } = validateGuess(
      word,
      size,
      userId,
      roundId,
      s.current.field,
      s.current.validWords,
    );

    // Persist the guess
    const db = getDb();
    db.prepare(
      `INSERT INTO round_guesses (round_id, size, user_id, username, word, result, points)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(roundId, size, userId, username, word.toLowerCase(), result, points);

    const playerResults = buildResults(
      this.loadGuesses(roundId, size),
      userId,
    );

    return { word, result, points, player_results: playerResults };
  }

  /** Load the full guess history for a round+size from DB. */
  loadGuesses(roundId: number, size: number): GuessRow[] {
    const db = getDb();
    return db
      .prepare(
        `SELECT word, result, points, username, user_id
         FROM round_guesses
         WHERE round_id = ? AND size = ?`,
      )
      .all(roundId, size) as GuessRow[];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildUpdatePayload(
    size: GameSize,
    forUserId: number | undefined,
  ): UpdatePayload {
    const s = this.state.get(size)!;
    const roundTime = this.currentRoundTime();
    const phase = getRoundPhase(roundTime);
    const guesses = this.loadGuesses(s.current.roundId, size);

    return {
      current_round: {
        id: s.current.roundId,
        size,
        field: s.current.field,
        seconds_remaining: getSecondsRemaining(roundTime),
        state: phase,
        results: buildResults(guesses, forUserId),
      },
      last_round: s.lastRound,
    };
  }

  stop() {
    for (const s of this.state.values()) {
      if (s.tickTimer) clearTimeout(s.tickTimer);
    }
  }
}

// Singleton — one game server for the whole process
let _instance: GameServer | null = null;

export function getGameServer(): GameServer {
  if (!_instance) _instance = new GameServer();
  return _instance;
}
