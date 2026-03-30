import { create } from "zustand";

type LayoutStore = {
  mainRect: { left: number; width: number } | null;
  setMainRect: (rect: { left: number; width: number }) => void;
};

export const useLayoutStore = create<LayoutStore>((set) => ({
  mainRect: null,
  setMainRect: (mainRect) => set({ mainRect }),
}));
