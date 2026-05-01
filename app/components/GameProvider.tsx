import { useEffect, useRef } from "react";
import { useGameStore, type GameSize } from "../stores/gameStore";
import { useChatStore } from "../stores/chatStore";
import { useProposalStore } from "../stores/proposalStore";
import type { WsIncomingMsg, WsEnrichResultMsg } from "../../lib/gameTypes.js";
import type { Session } from "../../lib/session.js";

const RECONNECT_DELAY_MS = 3000;

type Props = {
  session: Session;
  size: GameSize;
  children: React.ReactNode;
};

export default function GameProvider({ session, size, children }: Props) {
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

  useEffect(() => {
    setMyUsername(username);
    setMyUserId(userId);
  }, [username]);

  useEffect(() => {
    setSize(size);
    // Clear stale chat messages for the old size immediately on size change
    useChatStore.setState({ messages: [] });
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
        else if (msg.type === "proposals") useProposalStore.getState().mergeProposals(msg.proposals);
        else if (msg.type === "proposed_words") useGameStore.getState().setProposedWords(msg.words);
        else if (msg.type === "enrich_result") useGameStore.getState().setEnrichResult(msg as WsEnrichResultMsg);
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
