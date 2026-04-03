import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChatStore } from "../stores/chatStore";
import { useGameStore } from "../stores/gameStore";
import { fieldContains, fieldToGrid } from "../../lib/fieldContains.js";
import type { Session } from "../../lib/session.js";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Props = {
  session: Session;
};

export default function Chat({ session }: Props) {
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const connected = useChatStore((s) => s.connected);
  const currentRound = useGameStore((s) => s.currentRound);
  const size = useGameStore((s) => s.size);
  const guess = useGameStore((s) => s.guess);
  const isCooldown = currentRound?.state === 'cooldown';
  const secondsRemaining = currentRound?.seconds_remaining ?? 0;
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName =
    session.type === "user" ? session.user.name : `Gast ${session.guestId}`;

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const text = input.trim();
    if (!text || !connected) return;

    // Single word that can be formed on the current field → send as a game guess
    if (!text.includes(" ") && currentRound?.field) {
      const grid = fieldToGrid(currentRound.field, size);
      if (fieldContains(grid, text)) {
        guess(text);
        setInput("");
        inputRef.current?.focus();
        return;
      }
    }

    send(text);
    setInput("");
  }

  return (
    <>
      <div className="chat panel panel-default hidden-xs hidden-sm">
        <div className="panel-body chat-content" ref={bodyRef}>
          {messages.map((msg) => (
            <div key={msg.id}>
              <span style={{ color: "#aaa", marginRight: 6 }}>
                {new Date(msg.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <strong>{msg.username}</strong> {msg.message}
            </div>
          ))}
        </div>
        <div className="panel-footer">
          <div className="input-group input-group-sm">
            <span className="input-group-addon">{displayName}</span>
            <input
              ref={inputRef}
              type="text"
              className="form-control chat-input"
              id="chat-input"
              placeholder={connected ? "Chat" : "Verbinde…"}
              value={input}
              disabled={!connected}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {isCooldown && (
              <span className="input-group-addon">{formatTime(secondsRemaining)}</span>
            )}
          </div>
        </div>
      </div>

      <span id="translation-guest-prefix" style={{ display: "none" }}>Gast </span>
    </>
  );
}
