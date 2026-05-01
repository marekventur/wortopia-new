/**
 * Shared types for the game WebSocket protocol.
 * No Node.js imports — safe to use from both client and server.
 */
import type { ChatMessage } from "./chatTypes.js";
import type { ProposalMap } from "./proposalTypes.js";

export type { ProposalMap };

export type RoundPhase = "ongoing" | "cooldown";

export type PlayerResult = {
  userId: number;
  username: string;
  team: string | null;
  words: number;
  points: number;
};

export type RoundResults = {
  players: PlayerResult[];
  /** Current round only: the requesting player's own correct words. */
  words: { word: string; username: string }[];
};

/** One entry in the all-words list sent with last_round. */
export type WordDetail = {
  word: string;
  description: string | null;
  points: number;
  /** User IDs of every player who guessed this word correctly. Empty if no-one did. */
  guessedBy: number[];
};

export type LastRoundResults = {
  players: PlayerResult[];
  /** ALL valid words for the field, sorted most-guessed → least-guessed. */
  words: WordDetail[];
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
  results: LastRoundResults;
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
  description: string | null;
  player_results: RoundResults;
};

export type WsChatInitMsg = { type: "chat_init"; messages: ChatMessage[] };
export type WsChatMessageMsg = { type: "chat_message"; message: ChatMessage };

export type WsProposalsMsg = { type: "proposals"; proposals: ProposalMap };

export type WsEnrichResultMsg = {
  type: "enrich_result";
  word: string;
  description: string | null;
  base: string | null;
};

export type WsProposedWordsMsg = { type: "proposed_words"; words: string[] };

export type WsIncomingMsg = WsUpdateMsg | WsTickMsg | WsGuessResultMsg | WsChatInitMsg | WsChatMessageMsg | WsProposalsMsg | WsEnrichResultMsg | WsProposedWordsMsg;

export type { ChatMessage };
