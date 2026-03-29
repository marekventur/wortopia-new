import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { getDb } from "./db.js";
import { getSession, sessionCookie } from "./session.js";

const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 500;

export type ChatMessage = {
  id: number;
  userId: number;
  username: string;
  message: string;
  createdAt: string;
};

type IncomingFrame = { type: "message"; message: string };
type OutgoingFrame =
  | { type: "init"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage };

function send(ws: WebSocket, frame: OutgoingFrame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function loadRecentMessages(): ChatMessage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, user_id as userId, username, message, created_at as createdAt
       FROM chat_messages
       WHERE created_at >= datetime('now', '-60 minutes')
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(MAX_MESSAGES) as ChatMessage[];
}

function saveMessage(userId: number, username: string, message: string): ChatMessage {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)")
    .run(userId, username, message);
  const row = db
    .prepare(
      "SELECT id, user_id as userId, username, message, created_at as createdAt FROM chat_messages WHERE id = ?"
    )
    .get(result.lastInsertRowid) as ChatMessage;
  return row;
}

export function createChatServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/chat" });

  wss.on("connection", async (ws, req) => {
    // Identify the connecting user from their session cookie
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

    // Send chat history
    const history = loadRecentMessages();
    send(ws, { type: "init", messages: history.reverse() });

    // Handle incoming messages
    ws.on("message", (data) => {
      let frame: IncomingFrame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (frame.type !== "message") return;

      const text = String(frame.message ?? "").trim();
      if (!text || text.length > MAX_MESSAGE_LENGTH) return;

      const saved = saveMessage(userId, username, text);

      // Broadcast to all connected clients
      const outgoing: OutgoingFrame = { type: "message", message: saved };
      for (const client of wss.clients) {
        send(client, outgoing);
      }
    });
  });

  return wss;
}
