import { create } from "zustand";

type ModalStore = {
  activeModal: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;
};

export const useModalStore = create<ModalStore>((set) => ({
  activeModal: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
}));
