import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLayoutStore } from "../stores/layoutStore";

type Props = {
  children: ReactNode;
};

export default function MainAreaPositioner({ children }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { mainRect, setMainRect } = useLayoutStore();

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setMainRect({ left: rect.left, width: rect.width });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <>
      {/* Invisible anchor — Bootstrap positions this, we just read its coords */}
      <div
        ref={anchorRef}
        className="col-md-6 col-md-push-3 hidden-xs hidden-sm"
        style={{ visibility: "hidden", pointerEvents: "none" }}
      />

      {/* Fixed content — md+ only */}
      {mainRect && mainRect.width > 0 && (
        <div
          className="main-area hidden-xs hidden-sm"
          style={{
            position: "fixed",
            left: mainRect.left,
            width: mainRect.width,
            top: 70,
            height: "calc(100vh - 70px)",
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}
