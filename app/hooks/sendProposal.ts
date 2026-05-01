import { useGameStore } from "../stores/gameStore.js";
import type { ProposalAction } from "../../lib/proposalTypes.js";

export function sendProposal(
  action: ProposalAction,
  word: string,
  description?: string,
  base?: string,
): void {
  useGameStore.getState()._send?.(
    JSON.stringify({ type: "propose_word", action, word: word.toLowerCase(), description, base }),
  );
}
