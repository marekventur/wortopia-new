import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import type { ChatMessage } from "../../lib/chatTypes.js";

const RECONNECT_DELAY_MS = 3000;

type IncomingFrame =
  | { type: "init"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage };

export default function ChatProvider({ children }: { children: React.ReactNode }) {
  const { setMessages, addMessage, setConnected } = useChatStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;

    function connect() {
      if (unmounted.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        let frame: IncomingFrame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        if (frame.type === "init") {
          setMessages(frame.messages);
        } else if (frame.type === "message") {
          addMessage(frame.message);
        }
      };

      ws.onclose = () => {
        setConnected(false);
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
    };
  }, []);

  // Expose send via store — attach it once ws is available
  // We use a module-level ref trick: expose send as a function on the store
  useEffect(() => {
    useChatStore.setState({
      send: (message: string) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "message", message }));
        }
      },
    });
  }, []);

  return <>{children}</>;
}
