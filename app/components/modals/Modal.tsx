import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalStore } from "../../stores/modalStore";

type Props = {
  id: string;
  size?: "sm" | "lg";
  children: ReactNode;
};

export default function Modal({ id, size, children }: Props) {
  const { activeModal, closeModal } = useModalStore();
  const isOpen = activeModal === id;

  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add("modal-open");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, closeModal]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="modal fade in"
        style={{ display: "block" }}
        role="dialog"
        onClick={closeModal}
      >
        <div
          className={`modal-dialog${size ? ` modal-${size}` : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
      <div className="modal-backdrop fade in" />
    </>,
    document.body
  );
}
