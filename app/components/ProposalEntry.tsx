import { useState } from "react";
import { useProposalStore } from "../stores/proposalStore.js";
import { useGameStore } from "../stores/gameStore.js";
import type { Proposal } from "../../lib/proposalTypes.js";
import type { Session } from "../../lib/session.js";

type Props = {
  proposal: Proposal;
  session: Session;
};

const ACTION_LABELS: Record<string, string> = {
  add: "Neues Wort",
  update: "Beschreibung",
  remove: "Entfernen",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Angenommen",
  rejected: "Abgelehnt",
  sent_for_approval: "In Prüfung",
};

const STATUS_CLASSES: Record<string, string> = {
  approved: "proposal-entry__status--approved",
  rejected: "proposal-entry__status--rejected",
  sent_for_approval: "proposal-entry__status--pending",
};

const TYPE_CLASSES: Record<string, string> = {
  add: "proposal-entry__type--add",
  update: "proposal-entry__type--update",
  remove: "proposal-entry__type--remove",
};
export default function ProposalEntry({ proposal, session }: Props) {
  const applyOptimisticVote = useProposalStore((s) => s.applyOptimisticVote);
  const [myVote, setMyVote] = useState<"support" | "oppose" | null>(null);

  const isLoggedIn = session.type === "user";
  const isClosed =
    proposal.status !== "open" ||
    new Date() > new Date(proposal.closesAt);
  const isOwnProposal =
    isLoggedIn && session.user.id === proposal.proposer;
  const canVote = isLoggedIn && !isClosed && !isOwnProposal;

  const handleVote = (vote: "support" | "oppose") => {
    if (!canVote) return;
    const newVote = myVote === vote ? null : vote;
    applyOptimisticVote(proposal.id, newVote, myVote);
    useGameStore.getState()._send?.(
      JSON.stringify({ type: "vote_for_proposal", id: proposal.id, vote: newVote }),
    );
    setMyVote(newVote);
  };

  const time = new Date(proposal.createdAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`proposal-entry ${TYPE_CLASSES[proposal.action] ?? ""}`}>
      <div className="proposal-entry__left">
      <span className="proposal-entry__time">{time}</span>
      {" "}
      <span className="proposal-entry__proposer-username">{proposal.proposerUsername}</span>
      <span className="proposal-entry__action-badge">
        {ACTION_LABELS[proposal.action] ?? proposal.action}
      </span>
      {" "}
      <span className="proposal-entry__word">{proposal.word.toUpperCase()}</span>
      {proposal.description && (
        <div className="proposal-entry__description">{proposal.description}</div>
      )}
      </div>
      {proposal.status === "open" && (
      <div className="proposal-entry__votes">
        <button
          className={`proposal-entry__vote-btn proposal-entry__vote-btn--support ${myVote === "support" ? " proposal-entry__vote-btn--active" : ""} `}
          disabled={!canVote}
          onClick={() => handleVote("support")}
          title={
            !isLoggedIn
              ? "Einloggen um abzustimmen"
              : isOwnProposal
                ? "Eigener Vorschlag"
                : isClosed
                  ? "Stimme zurueck nehmen"
                  : undefined
          }
        >
          <span className="glyphicon glyphicon-thumbs-up" aria-hidden />{" "}
          {proposal.supporterCount}
        </button>
        <button
          className={`proposal-entry__vote-btn proposal-entry__vote-btn--oppose ${myVote === "oppose" ? " proposal-entry__vote-btn--active" : ""}`}
          disabled={!canVote}
          onClick={() => handleVote("oppose")}
          title={
            !isLoggedIn
              ? "Einloggen um abzustimmen"
              : isOwnProposal
                ? "Eigener Vorschlag"
                : isClosed
                  ? "Abstimmung beendet"
                  : undefined
          }
        >
          <span className="glyphicon glyphicon-thumbs-down" aria-hidden />{" "}
          {proposal.opposerCount}
        </button>
      </div>)}
      {proposal.status !== "open" && (
        <div
          className={`proposal-entry__status ${STATUS_CLASSES[proposal.status] ?? ""}`}
        >
          {STATUS_LABELS[proposal.status] ?? proposal.status}
        </div>
      )}
    </div>
  );
}
