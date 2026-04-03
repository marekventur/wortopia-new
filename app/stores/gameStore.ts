import { create } from "zustand";
import { SCORES } from "../../lib/gameConfig.js";
import type {
  CurrentRoundInfo,
  LastRoundInfo,
  WsUpdateMsg,
  WsTickMsg,
  WsGuessResultMsg,
} from "../../lib/gameTypes.js";

export type GameSize = 4 | 5;

export type GuessEntry = {
  word: string;
  result: string;
  points: number;
  description: string | null;
};

type GameStore = {
  size: GameSize;
  setSize: (size: GameSize) => void;

  myUsername: string | null;
  setMyUsername: (username: string) => void;

  myUserId: number | null;
  setMyUserId: (userId: number) => void;

  connected: boolean;
  currentRound: CurrentRoundInfo | null;
  lastRound: LastRoundInfo | null;
  /** Guesses made this round — populated from guess_result events, seeded on
   *  connect from current_round.results.words (correct words only). */
  myGuesses: GuessEntry[];
  /** Latest guess result — changes every guess so CurrentField can animate. */
  lastGuessResult: (GuessEntry & { ts: number }) | null;

  // ── Called by GameProvider ──────────────────────────────────────────────────
  _setConnected: (v: boolean) => void;
  _applyUpdate: (msg: WsUpdateMsg) => void;
  _applyTick: (msg: WsTickMsg) => void;
  _applyGuessResult: (msg: WsGuessResultMsg) => void;
  _send: ((data: string) => void) | null;
  _setSend: (fn: ((data: string) => void) | null) => void;

  hoveredUserId: number | null;
  setHoveredUserId: (id: number | null) => void;

  hoveredWordGuessedBy: number[] | null;
  setHoveredWordGuessedBy: (ids: number[] | null) => void;

  // ── Public ──────────────────────────────────────────────────────────────────
  guess: (word: string) => void;
};

export const useGameStore = create<GameStore>((set, get) => ({
  size: 4,
  setSize: (size) =>
    set({ size, connected: false, currentRound: null, lastRound: null, myGuesses: [], lastGuessResult: null }),

  myUsername: null,
  setMyUsername: (myUsername) => set({ myUsername }),

  myUserId: null,
  setMyUserId: (myUserId) => set({ myUserId }),

  connected: false,
  currentRound: null,
  lastRound: null,
  myGuesses: [],
  lastGuessResult: null,
  hoveredUserId: null,
  setHoveredUserId: (hoveredUserId) => set({ hoveredUserId }),
  hoveredWordGuessedBy: null,
  setHoveredWordGuessedBy: (hoveredWordGuessedBy) => set({ hoveredWordGuessedBy }),

  _send: null,
  _setSend: (fn) => set({ _send: fn }),
  _setConnected: (connected) => set({ connected }),

  _applyUpdate: (msg) => {
    const prevRoundId = get().currentRound?.id;
    const isNewRound = prevRoundId == null || msg.current_round.id !== prevRoundId;

    // On a fresh connect or new round, seed myGuesses from the server's
    // record of correct words for this player (incorrect guesses aren't
    // persisted server-side, so we start the list from correct ones only).
    let myGuesses = get().myGuesses;
    if (isNewRound) {
      myGuesses = msg.current_round.results.words.map((w) => ({
        word: w.word.toUpperCase(),
        result: "correct",
        points: SCORES[w.word.length] ?? 0,
        description: null,
      }));
    }

    set({
      currentRound: msg.current_round,
      lastRound: msg.last_round,
      myGuesses,
      ...(isNewRound ? { lastGuessResult: null } : {}),
    });
  },

  _applyTick: (msg) => {
    set((state) => ({
      currentRound: state.currentRound
        ? {
            ...state.currentRound,
            seconds_remaining: msg.current_round.seconds_remaining,
            state: msg.current_round.state,
          }
        : null,
    }));
  },

  _applyGuessResult: (msg) => {
    const entry: GuessEntry = {
      word: msg.word.toUpperCase(),
      result: msg.result,
      points: msg.points,
      description: msg.description,
    };
    set((state) => ({
      myGuesses: [entry, ...state.myGuesses],
      lastGuessResult: { ...entry, ts: Date.now() },
      // Keep leaderboard current — player_results has the updated standings
      currentRound: state.currentRound
        ? { ...state.currentRound, results: msg.player_results }
        : null,
    }));
  },

  guess: (word) => {
    const { _send, currentRound } = get();
    if (!_send || currentRound?.state !== "ongoing") return;
    _send(JSON.stringify({ type: "guess", word }));
  },
}));
