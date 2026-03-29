import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChatStore } from "../stores/chatStore";
import type { Session } from "../../lib/session.js";

type Props = {
  session: Session;
};

export default function Chat({ session }: Props) {
  const { messages, send } = useChatStore();
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const displayName =
    session.type === "user" ? session.user.name : `Gast ${session.guestId}`;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const text = input.trim();
    if (!text) return;
    send(text);
    setInput("");
  }

  return (
    <>
      <div className="visible-xs-block visible-sm-block hidden-md hidden-lg">
        <h2 className="pause-timer">Bitte warten - 1:29</h2>
      </div>

      <div className="chat panel panel-default hidden-xs hidden-sm">
        <div className="panel-body chat-content" ref={bodyRef}>
          {messages.map((msg) => (
            <div key={msg.id}>
              <strong>{msg.username}</strong>: {msg.message}
            </div>
          ))}
        </div>
        <div className="panel-footer">
          <div className="input-group input-group-sm">
            <span className="input-group-addon">{displayName}</span>
            <input
              type="text"
              className="form-control chat-input"
              id="chat-input"
              placeholder="Chat"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <label htmlFor="chat-input">1:29</label>
          </div>
        </div>
      </div>

      <span id="translation-guest-prefix" style={{ display: "none" }}>Gast </span>
    </>
  );
}
