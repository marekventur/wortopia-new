/**
 * Shared proposal types — no Node.js imports, safe for client and server.
 */

export type ProposalAction = "add" | "update" | "remove";
export type ProposalStatus = "open" | "approved" | "rejected" | "sent_for_approval";

/** Wire-safe type sent to clients. Voter identity is never exposed. */
export type Proposal = {
  id: string;
  word: string;
  action: ProposalAction;
  /** Present for "update" action; null for "remove". */
  description: string | null;
  /** Base/lemma form — optional even for "update". */
  base: string | null;
  proposer: number;
  proposerUsername: string;
  supporterCount: number;
  opposerCount: number;
  status: ProposalStatus;
  createdAt: string;
  /** Voting closes 30 minutes after creation. */
  closesAt: string;
};

export type ProposalMap = Record<string, Proposal>;
