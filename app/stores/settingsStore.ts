import { create } from "zustand";

export type WordListSort = "default" | "alpha" | "points";

export type Settings = {
  showRotate: boolean;
  wordListSort: WordListSort;
  highContrast: boolean;
};

type SettingsStore = Settings & {
  setSettings: (s: Partial<Settings>) => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  showRotate: true,
  wordListSort: "default",
  highContrast: false,
  setSettings: (s) => set((prev) => ({ ...prev, ...s })),
}));
