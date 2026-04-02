/**
 * Shared types for the game WebSocket protocol.
 * No Node.js imports — safe to use from both client and server.
 */
import type { ChatMessage } from "./chatTypes.js";

export type RoundPhase = "ongoing" | "cooldown";

export type PlayerResult = {
  userId: number;
  username: string;
  words: number;
  points: number;
};

export type RoundResults = {
  players: PlayerResult[];
  /** For current_round: only the requesting player's correct words.
   *  For last_round: every correct word from anyone, with username. */
  words: { word: string; username: string }[];
};

export type CurrentRoundInfo = {
  id: number;
  size: number;
  field: string;
  seconds_remaining: number;
  state: RoundPhase;
  results: RoundResults;
};

export type LastRoundInfo = {
  id: number;
  size: number;
  field: string;
  results: RoundResults;
};

// ── Incoming WS message shapes ────────────────────────────────────────────────

export type WsUpdateMsg = {
  type: "update";
  current_round: CurrentRoundInfo;
  last_round: LastRoundInfo | null;
};

export type WsTickMsg = {
  type: "tick";
  current_round: Omit<CurrentRoundInfo, "results">;
};

export type WsGuessResultMsg = {
  type: "guess_result";
  word: string;
  result: string;
  points: number;
  player_results: RoundResults;
};

export type WsChatInitMsg = { type: "chat_init"; messages: ChatMessage[] };
export type WsChatMessageMsg = { type: "chat_message"; message: ChatMessage };

export type WsIncomingMsg = WsUpdateMsg | WsTickMsg | WsGuessResultMsg | WsChatInitMsg | WsChatMessageMsg;

export type { ChatMessage };
