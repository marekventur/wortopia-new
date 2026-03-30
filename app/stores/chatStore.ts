import { create } from "zustand";
import type { ChatMessage } from "../../lib/chatTypes.js";

type ChatStore = {
  messages: ChatMessage[];
  connected: boolean;
  send: (message: string) => void;
  setConnected: (connected: boolean) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
};

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  connected: false,
  send: () => {},
  setConnected: (connected) => set({ connected }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
}));
