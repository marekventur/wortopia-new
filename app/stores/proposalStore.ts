import { create } from "zustand";
import type { ProposalMap } from "../../lib/proposalTypes.js";

type ProposalStore = {
  proposals: ProposalMap;
  /**
   * Merges incoming proposals into the store without removing old entries.
   * Old proposals remain visible in the chat even after the server stops sending them.
   */
  mergeProposals: (incoming: ProposalMap) => void;
  /**
   * Applies an optimistic vote change locally.
   * Will be overridden by the next server push.
   */
  applyOptimisticVote: (
    id: string,
    newVote: "support" | "oppose" | null,
    prevVote: "support" | "oppose" | null,
  ) => void;
};

export const useProposalStore = create<ProposalStore>((set) => ({
  proposals: {},

  mergeProposals: (incoming) =>
    set((state) => ({ proposals: { ...state.proposals, ...incoming } })),

  applyOptimisticVote: (id, newVote, prevVote) =>
    set((state) => {
      const proposal = state.proposals[id];
      if (!proposal) return state;
      let { supporterCount, opposerCount } = proposal;
      if (prevVote === "support") supporterCount--;
      if (prevVote === "oppose") opposerCount--;
      if (newVote === "support") supporterCount++;
      if (newVote === "oppose") opposerCount++;
      return {
        proposals: {
          ...state.proposals,
          [id]: { ...proposal, supporterCount, opposerCount },
        },
      };
    }),
}));
