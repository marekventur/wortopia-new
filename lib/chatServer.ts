import { EventEmitter } from "events";
import { getDb } from "./db.js";
import { maskName, maskText } from "./profanity.js";
import type { ChatMessage } from "./chatTypes.js";

const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 500;

/**
 * Masks a message on its way out. Stored rows are left untouched so the filter
 * can be adjusted later without having lost anything.
 */
function present(message: ChatMessage): ChatMessage {
  return {
    ...message,
    username: maskName(message.username),
    // "PROPOSAL:<id>" markers carry no prose and pass through unchanged.
    message: message.message.startsWith("PROPOSAL:")
      ? message.message
      : maskText(message.message),
  };
}

export class ChatServer extends EventEmitter {
  getHistory(size: number): ChatMessage[] {
    const db = getDb();
    return (
      db
        .prepare(
          `SELECT id, user_id as userId, username, message, created_at as createdAt
           FROM chat_messages
           WHERE size = ? AND created_at >= datetime('now', '-60 minutes')
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(size, MAX_MESSAGES) as ChatMessage[]
    )
      .reverse()
      .map(present);
  }

  addMessage(
    userId: number,
    username: string,
    text: string,
    size: number,
  ): ChatMessage | null {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return null;

    const db = getDb();
    const result = db
      .prepare(
        "INSERT INTO chat_messages (user_id, username, message, size) VALUES (?, ?, ?, ?)",
      )
      .run(userId, username, trimmed, size);
    const message = db
      .prepare(
        `SELECT id, user_id as userId, username, message, created_at as createdAt
         FROM chat_messages WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as ChatMessage;

    const shown = present(message);
    this.emit("message", { size, message: shown });
    return shown;
  }
}

let instance: ChatServer | null = null;

export function getChatServer(): ChatServer {
  if (!instance) instance = new ChatServer();
  return instance;
}
