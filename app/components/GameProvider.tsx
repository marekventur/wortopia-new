import { useEffect, useRef } from "react";
import { useGameStore, type GameSize } from "../stores/gameStore";
import { useChatStore } from "../stores/chatStore";
import type { WsIncomingMsg } from "../../lib/gameTypes.js";
import type { Session } from "../../lib/session.js";
import type { UpdatePayload } from "../../lib/gameServer.js";
import type { ChatMessage } from "../../lib/chatTypes.js";

const RECONNECT_DELAY_MS = 3000;

type Props = {
  session: Session;
  size: GameSize;
  initialGameState: UpdatePayload;
  initialChat: ChatMessage[];
  children: React.ReactNode;
};

export default function GameProvider({ session, size, initialGameState, initialChat, children }: Props) {
  // Only read actions — no subscription needed here.
  const { _setConnected, _applyUpdate, _applyTick, _applyGuessResult,
          _setSend, setMyUsername, setMyUserId, setSize } = useGameStore.getState();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const username =
    session.type === "user" ? session.user.name : `Gast ${session.guestId}`;
  const userId =
    session.type === "user" ? session.user.id : -session.guestId;

  // Seed stores synchronously during first render so SSR HTML already has
  // game state and there is no empty-state flash before the WS connects.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    useGameStore.setState({ myUsername: username, myUserId: userId, size });
    _applyUpdate({ type: "update", ...initialGameState });
    useChatStore.getState().setMessages(initialChat);
  }

  useEffect(() => {
    setMyUsername(username);
    setMyUserId(userId);
  }, [username]);

  useEffect(() => {
    // Only reset when navigating to a different size; on initial mount the
    // store was already seeded with the correct size via the useRef guard.
    if (useGameStore.getState().size !== size) {
      setSize(size);
      useChatStore.setState({ messages: [] });
    }
  }, [size]);

  useEffect(() => {
    unmounted.current = false;

    function connect() {
      if (unmounted.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/game/${size}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        _setConnected(true);
        useChatStore.setState({ connected: true });
        const rawSend = (data: string) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        };
        _setSend(rawSend);
        useChatStore.setState({
          send: (text: string) =>
            rawSend(JSON.stringify({ type: "chat_message", message: text })),
        });
      };

      ws.onmessage = (event) => {
        let msg: WsIncomingMsg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "update") _applyUpdate(msg);
        else if (msg.type === "tick") _applyTick(msg);
        else if (msg.type === "guess_result") _applyGuessResult(msg);
        else if (msg.type === "chat_init") useChatStore.getState().setMessages(msg.messages);
        else if (msg.type === "chat_message") useChatStore.getState().addMessage(msg.message);
      };

      ws.onclose = () => {
        _setConnected(false);
        _setSend(null);
        useChatStore.setState({ connected: false, send: () => {} });
        if (!unmounted.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      unmounted.current = false;
    };
  }, [size]);

  return <>{children}</>;
}
