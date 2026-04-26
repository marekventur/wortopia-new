import { EventEmitter } from "events";
import crypto from "crypto";
import { getDb } from "./db.js";
import { getChatServer } from "./chatServer.js";
import type { Proposal, ProposalAction, ProposalMap, ProposalStatus } from "./proposalTypes.js";

const VOTE_WINDOW_MINUTES = 30;
const HISTORY_WINDOW_MINUTES = 60;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// const SPIELWOERTER_API_URL = "https://spielwoerter.de/api/partner/suggestions";

type ProposalRow = {
  id: string;
  user_id: number;
  username: string;
  word: string;
  action: string;
  description: string | null;
  base: string | null;
  status: string;
  created_at: string;
  closes_at: string;
  supporter_count: number;
  opposer_count: number;
};

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    word: row.word,
    action: row.action as ProposalAction,
    description: row.description,
    base: row.base,
    proposer: row.user_id,
    proposerUsername: row.username,
    supporterCount: row.supporter_count,
    opposerCount: row.opposer_count,
    status: row.status as ProposalStatus,
    createdAt: row.created_at,
    closesAt: row.closes_at,
  };
}

export class WordProposalServer extends EventEmitter {
  constructor() {
    super();
    this.startFinalizationSweep();
  }

  propose(
    userId: number,
    username: string,
    word: string,
    action: ProposalAction,
    description: string | null,
    base: string | null,
    size: number,
  ): Proposal | null {
    if (userId < 0) return null; // guests cannot propose

    const db = getDb();
    const chatServer = getChatServer();
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO word_proposals (id, user_id, username, word, action, description, base, closes_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${VOTE_WINDOW_MINUTES} minutes'))`,
    ).run(id, userId, username, word, action, description, base);

    // Post magic-string chat message — broadcasts via chatServer's existing event system.
    // The client renders "PROPOSAL:<uuid>" entries differently in the chat timeline.
    chatServer.addMessage(userId, username, `PROPOSAL:${id}`, size);

    const proposals = this.buildProposalMap();
    this.emit("proposals_update", { proposals });
    return proposals[id] ?? null;
  }

  vote(
    userId: number,
    proposalId: string,
    vote: "support" | "oppose" | null,
  ): void {
    if (userId < 0) return; // guests cannot vote

    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, user_id, status, closes_at FROM word_proposals WHERE id = ?`,
      )
      .get(proposalId) as
      | { id: string; user_id: number; status: string; closes_at: string }
      | undefined;

    if (!row) return;
    if (row.status !== "open") return;
    if (row.closes_at < new Date().toISOString()) return; // voting period ended
    if (row.user_id === userId) return; // proposer cannot vote on own proposal

    if (vote === null) {
      db.prepare(
        `DELETE FROM word_proposal_votes WHERE proposal_id = ? AND user_id = ?`,
      ).run(proposalId, userId);
    } else {
      db.prepare(
        `INSERT INTO word_proposal_votes (proposal_id, user_id, vote)
         VALUES (?, ?, ?)
         ON CONFLICT (proposal_id, user_id) DO UPDATE SET vote = excluded.vote`,
      ).run(proposalId, userId, vote);
    }

    const proposals = this.buildProposalMap();
    this.emit("proposals_update", { proposals });
  }

  /** Returns all proposals from the last 60 minutes. Lazily finalizes expired ones. */
  getProposals(): ProposalMap {
    this.finalizeExpired();
    return this.buildProposalMap();
  }

  private buildProposalMap(): ProposalMap {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.id, p.user_id, p.username, p.word, p.action, p.description, p.base,
                p.status, p.created_at, p.closes_at,
                COALESCE(SUM(CASE WHEN v.vote = 'support' THEN 1 ELSE 0 END), 0) AS supporter_count,
                COALESCE(SUM(CASE WHEN v.vote = 'oppose' THEN 1 ELSE 0 END), 0) AS opposer_count
         FROM word_proposals p
         LEFT JOIN word_proposal_votes v ON v.proposal_id = p.id
         WHERE p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${HISTORY_WINDOW_MINUTES} minutes')
         GROUP BY p.id
         ORDER BY p.created_at ASC`,
      )
      .all() as ProposalRow[];

    const map: ProposalMap = {};
    for (const row of rows) {
      map[row.id] = rowToProposal(row);
    }
    return map;
  }

  /**
   * Finalizes any proposals whose voting window has closed.
   * Returns true if at least one proposal was finalized.
   */
  private finalizeExpired(): boolean {
    const db = getDb();
    const expired = db
      .prepare(
        `SELECT p.id, p.user_id, p.word, p.action, p.description, p.base, p.username,
                COALESCE(SUM(CASE WHEN v.vote = 'support' THEN 1 ELSE 0 END), 0) AS supporter_count,
                COALESCE(SUM(CASE WHEN v.vote = 'oppose' THEN 1 ELSE 0 END), 0) AS opposer_count
         FROM word_proposals p
         LEFT JOIN word_proposal_votes v ON v.proposal_id = p.id
         WHERE p.status = 'open'
           AND p.closes_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         GROUP BY p.id`,
      )
      .all() as (ProposalRow & { supporter_count: number; opposer_count: number })[];

    if (expired.length === 0) return false;

    const updateStatus = db.prepare(
      `UPDATE word_proposals SET status = ? WHERE id = ?`,
    );

    for (const row of expired) {
      const net = row.supporter_count - row.opposer_count;
      let status: ProposalStatus;
      if (net >= 2) {
        status = "approved";
      } else if (net >= 0) {
        status = "sent_for_approval";
      } else {
        status = "rejected";
      }

      updateStatus.run(status, row.id);

      if (status !== "rejected") {
        // TODO: submit to Spielwoerter.de partner API
        // const key = process.env.SPIELWOERTER_API_KEY ?? "";
        // const spielwoerterAction = row.action === "remove" ? "remove" : "upsert";
        // void fetch(SPIELWOERTER_API_URL, {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json", "X-API-Key": key },
        //   body: JSON.stringify({
        //     suggestions: [
        //       {
        //         word: row.word,
        //         action: spielwoerterAction,
        //         author_email: `user-${row.user_id}@wortopia.de`,
        //         ...(spielwoerterAction === "upsert" && {
        //           payload: {
        //             ...(row.description && { description: row.description }),
        //             ...(row.base && { base: row.base }),
        //           },
        //         }),
        //       },
        //     ],
        //   }),
        // });
      }
    }

    return true;
  }

  private startFinalizationSweep(): void {
    setInterval(() => {
      const changed = this.finalizeExpired();
      if (changed) {
        const proposals = this.buildProposalMap();
        this.emit("proposals_update", { proposals });
        console.log(`[WordProposalServer] Finalized expired proposals, broadcasting update`);
      }
    }, SWEEP_INTERVAL_MS);
  }
}

let instance: WordProposalServer | null = null;

export function getWordProposalServer(): WordProposalServer {
  if (!instance) instance = new WordProposalServer();
  return instance;
}
