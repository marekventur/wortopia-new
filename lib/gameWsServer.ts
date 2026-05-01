import { WebSocketServer, WebSocket } from "ws";
import { getSession } from "./session.js";
import { getGameServer } from "./gameServer.js";
import { getChatServer } from "./chatServer.js";
import { getWordProposalServer } from "./wordProposalServer.js";
import type { TickPayload, UpdatePayload } from "./gameServer.js";
import type { ChatMessage } from "./chatTypes.js";
import type { ProposalMap } from "./proposalTypes.js";
import { SIZES, type GameSize } from "./gameConfig.js";

const SPIELWOERTER_ENRICH_URL = "https://spielwoerter.de/api/partner/enrich";

type IncomingFrame =
  | { type: "guess"; word: string }
  | { type: "chat_message"; message: string }
  | { type: "propose_word"; action: "add" | "update" | "remove"; word: string; description?: string; base?: string }
  | { type: "vote_for_proposal"; id: string; vote: "support" | "oppose" | null }
  | { type: "enrich_word"; word: string };

type OutgoingFrame =
  | { type: "update"; current_round: UpdatePayload["current_round"]; last_round: UpdatePayload["last_round"] }
  | { type: "tick"; current_round: TickPayload["current_round"] }
  | { type: "guess_result"; word: string; result: string; points: number; description: string | null; player_results: UpdatePayload["current_round"]["results"] }
  | { type: "chat_init"; messages: ChatMessage[] }
  | { type: "chat_message"; message: ChatMessage }
  | { type: "proposals"; proposals: ProposalMap }
  | { type: "proposed_words"; words: string[] }
  | { type: "enrich_result"; word: string; description: string | null; base: string | null };

function send(ws: WebSocket, frame: OutgoingFrame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

/**
 * Returns a map of WebSocket servers keyed by path (e.g. "/ws/game/4").
 * Each path carries both game events and size-namespaced chat.
 */
export function createGameWsServer(): Map<string, WebSocketServer> {
  const gameServer = getGameServer();
  const chatServer = getChatServer();
  const wordProposalServer = getWordProposalServer();
  const servers = new Map<string, WebSocketServer>();

  for (const size of SIZES) {
    const wss = new WebSocketServer({ noServer: true });
    servers.set(`/ws/game/${size}`, wss);

    // Size-level: release held proposals when the round transitions to cooldown.
    // gameServer emits update:{size} on the ongoing→cooldown transition with state="cooldown".
    const onSizeUpdate = (payload: UpdatePayload) => {
      if (payload.current_round?.state === "cooldown") {
        wordProposalServer.releaseHeld(size);
      }
    };
    gameServer.on(`update:${size}`, onSizeUpdate);

    wss.on("connection", async (ws, req) => {
      // Identify connecting user
      const cookieHeader = req.headers.cookie ?? "";
      const mockRequest = new Request("http://localhost", {
        headers: { cookie: cookieHeader },
      });
      const session = await getSession(mockRequest);

      let userId: number;
      let username: string;

      if (session?.type === "user") {
        userId = session.user.id;
        username = session.user.name;
      } else if (session?.type === "guest") {
        userId = -session.guestId;
        username = `Gast ${session.guestId}`;
      } else {
        ws.close(1008, "Unauthorized");
        return;
      }

      // Send initial game state
      const initial = gameServer.getInitialPayload(size as GameSize, userId);
      send(ws, {
        type: "update",
        current_round: initial.current_round,
        last_round: initial.last_round,
      });

      // Send chat history for this size
      send(ws, { type: "chat_init", messages: chatServer.getHistory(size) });

      // Send current proposals (all sizes, last 60 min) so the chat backlog can render them
      send(ws, { type: "proposals", proposals: wordProposalServer.getProposals() });
      send(ws, { type: "proposed_words", words: wordProposalServer.getProposedWords() });

      // ── Game event subscriptions ──────────────────────────────────────────────

      const onTick = (payload: TickPayload) => {
        send(ws, { type: "tick", current_round: payload.current_round });
      };
      const onUpdate = (_payload: UpdatePayload) => {
        const filtered = gameServer.getInitialPayload(size as GameSize, userId);
        send(ws, {
          type: "update",
          current_round: filtered.current_round,
          last_round: filtered.last_round,
        });
      };

      gameServer.on(`tick:${size}`, onTick);
      gameServer.on(`update:${size}`, onUpdate);

      // ── Chat event subscription ───────────────────────────────────────────────

      const onChatMessage = ({ size: msgSize, message }: { size: number; message: ChatMessage }) => {
        if (msgSize === size) send(ws, { type: "chat_message", message });
      };
      chatServer.on("message", onChatMessage);

      // ── Proposal event subscription ───────────────────────────────────────────

      const onProposalsUpdate = ({ proposals }: { proposals: ProposalMap }) => {
        send(ws, { type: "proposals", proposals });
      };
      wordProposalServer.on("proposals_update", onProposalsUpdate);

      const onProposedWordsUpdate = ({ words }: { words: string[] }) => {
        send(ws, { type: "proposed_words", words });
      };
      wordProposalServer.on("proposed_words_update", onProposedWordsUpdate);

      // ── Cleanup on disconnect ─────────────────────────────────────────────────

      ws.on("close", () => {
        gameServer.off(`tick:${size}`, onTick);
        gameServer.off(`update:${size}`, onUpdate);
        chatServer.off("message", onChatMessage);
        wordProposalServer.off("proposals_update", onProposalsUpdate);
        wordProposalServer.off("proposed_words_update", onProposedWordsUpdate);
      });

      // ── Incoming messages ─────────────────────────────────────────────────────

      ws.on("message", async (data) => {
        let frame: IncomingFrame;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (frame.type === "guess") {
          const word = String(frame.word ?? "").trim().toUpperCase();
          if (!word) return;
          const response = gameServer.guess(word, size as GameSize, userId, username);
          send(ws, {
            type: "guess_result",
            word: response.word,
            result: response.result,
            points: response.points,
            description: response.description,
            player_results: response.player_results,
          });
          return;
        }

        if (frame.type === "chat_message") {
          const text = String(frame.message ?? "").trim();
          if (text) chatServer.addMessage(userId, username, text, size);
          return;
        }

        if (frame.type === "propose_word") {
          const word = String(frame.word ?? "").trim().toLowerCase();
          if (!word) return;
          try {
            const phase = gameServer.getInitialPayload(size as GameSize, userId).current_round?.state;
            const held = phase === "ongoing";
            wordProposalServer.propose(
              userId,
              username,
              word,
              frame.action,
              frame.description ?? null,
              frame.base ?? null,
              size,
              held,
            );
          } catch (err) {
            console.error("[GameWsServer] propose_word failed:", err);
          }
          return;
        }

        if (frame.type === "enrich_word") {
          const word = String(frame.word ?? "").trim().toLowerCase();
          if (!word) return;
          const apiKey = process.env.SPIELWOERTER_API_KEY ?? "";
          try {
            const resp = await fetch(`${SPIELWOERTER_ENRICH_URL}/${encodeURIComponent(word)}`, {
              headers: { "X-API-Key": apiKey },
            });
            if (resp.ok) {
              const data = await resp.json() as { description: string | null; base: string | null };
              send(ws, { type: "enrich_result", word, description: data.description, base: data.base });
            } else {
              send(ws, { type: "enrich_result", word, description: null, base: null });
            }
          } catch {
            send(ws, { type: "enrich_result", word, description: null, base: null });
          }
          return;
        }

        if (frame.type === "vote_for_proposal") {
          try {
            wordProposalServer.vote(userId, String(frame.id ?? ""), frame.vote ?? null);
          } catch (err) {
            console.error("[GameWsServer] vote_for_proposal failed:", err);
          }
          return;
        }
      });
    });

    console.log(`[GameWsServer] Ready for /ws/game/${size} (game + chat)`);
  }

  return servers;
}
