import { WebSocketServer, WebSocket } from "ws";
import { getSession } from "./session.js";
import { getGameServer } from "./gameServer.js";
import type {
  TickPayload,
  UpdatePayload,
} from "./gameServer.js";
import { SIZES, type GameSize } from "./gameConfig.js";

type IncomingFrame = { type: "guess"; word: string };

type OutgoingFrame =
  | { type: "update"; current_round: UpdatePayload["current_round"]; last_round: UpdatePayload["last_round"] }
  | { type: "tick"; current_round: TickPayload["current_round"] }
  | { type: "guess_result"; word: string; result: string; points: number; player_results: UpdatePayload["current_round"]["results"] };

function send(ws: WebSocket, frame: OutgoingFrame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

/**
 * Returns a map of WebSocket servers keyed by path (e.g. "/ws/game/4").
 * The caller is responsible for routing upgrade events to the right server —
 * see the central upgrade router in server.js.
 */
export function createGameWsServer(): Map<string, WebSocketServer> {
  const gameServer = getGameServer();
  const servers = new Map<string, WebSocketServer>();

  for (const size of SIZES) {
    const wss = new WebSocketServer({ noServer: true });
    servers.set(`/ws/game/${size}`, wss);

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

      // Send initial state (player's own guesses only)
      const initial = gameServer.getInitialPayload(size as GameSize, userId);
      send(ws, {
        type: "update",
        current_round: initial.current_round,
        last_round: initial.last_round,
      });

      // Subscribe to game server events
      const onTick = (payload: TickPayload) => {
        send(ws, { type: "tick", current_round: payload.current_round });
      };
      const onUpdate = (payload: UpdatePayload) => {
        // Fan-out: send each socket its own player-filtered view
        const filtered = gameServer.getInitialPayload(size as GameSize, userId);
        send(ws, {
          type: "update",
          current_round: filtered.current_round,
          last_round: filtered.last_round,
        });
      };

      gameServer.on(`tick:${size}`, onTick);
      gameServer.on(`update:${size}`, onUpdate);

      ws.on("close", () => {
        gameServer.off(`tick:${size}`, onTick);
        gameServer.off(`update:${size}`, onUpdate);
      });

      // Handle incoming messages
      ws.on("message", (data) => {
        let frame: IncomingFrame;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (frame.type !== "guess") return;

        const word = String(frame.word ?? "").trim().toUpperCase();
        if (!word) return;

        const response = gameServer.guess(word, size as GameSize, userId, username);
        send(ws, {
          type: "guess_result",
          word: response.word,
          result: response.result,
          points: response.points,
          player_results: response.player_results,
        });
      });
    });

    console.log(`[GameWsServer] Ready for /ws/game/${size}`);
  }

  return servers;
}
