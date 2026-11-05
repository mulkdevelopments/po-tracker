import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TipPos = { top: number; left: number; above: boolean };

/** Instant hover tip (unlike native title, which waits ~1s). Fixed portal avoids overflow clipping. */
export default function FastTip({
  text,
  children,
  className,
}: {
  text?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<TipPos | null>(null);
  const tip = text?.trim() ? text.trim() : "";

  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos]);

  const show = () => {
    if (!tip || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const above = r.top > 44;
    setPos({
      top: above ? r.top - 6 : r.bottom + 6,
      left: Math.min(Math.max(8, r.left), window.innerWidth - 240),
      above,
    });
  };

  return (
    <span
      ref={wrapRef}
      className={`inline-flex max-w-full ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && tip
        ? createPortal(
            <span
              role="tooltip"
              className={`fast-tip-bubble${pos.above ? " fast-tip-above" : ""}`}
              style={{ top: pos.top, left: pos.left }}
            >
              {tip}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
