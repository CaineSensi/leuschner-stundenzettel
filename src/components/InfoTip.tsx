import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────────────────────────────────────────────────────
   InfoTip · kleines „?"-Icon mit Hover-/Tap-Tooltip.
   Tooltip-Box rendert im document.body-Portal, damit overflow-hidden /
   z-index der Eltern-Card sie nicht abschneidet. Hover (Maus) + Click
   (Touch) öffnen, Mouseleave/Click-outside schließt.
   ──────────────────────────────────────────────────────────────────────── */

type Placement = "bottom" | "top" | "right" | "left";

export default function InfoTip({
  text,
  placement = "bottom",
  size = 14,
  tone = "neutral",
}: {
  text: string;
  placement?: Placement;
  size?: number;
  tone?: "neutral" | "light" | "copper";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Position berechnen sobald offen
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const off = 8;
    let top = 0, left = 0;
    switch (placement) {
      case "top":    top = r.top - off;     left = r.left + r.width / 2; break;
      case "right":  top = r.top + r.height / 2; left = r.right + off; break;
      case "left":   top = r.top + r.height / 2; left = r.left - off; break;
      default:       top = r.bottom + off;  left = r.left + r.width / 2;
    }
    setPos({ top, left });
  }, [open, placement]);

  // Klick außerhalb schließt (Touch-tauglich)
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const iconStyle =
    tone === "light"  ? "bg-white/15 text-white/80 hover:bg-copper-bright/30 hover:text-copper-bright" :
    tone === "copper" ? "bg-copper/15 text-copper hover:bg-copper hover:text-white" :
                        "bg-ink/15 text-ink-2 hover:bg-copper/30 hover:text-copper";

  // Transform-Klasse für die Tooltip-Box je nach Placement
  const transform =
    placement === "top"    ? "translate(-50%, -100%)" :
    placement === "right"  ? "translate(0, -50%)" :
    placement === "left"   ? "translate(-100%, -50%)" :
                             "translate(-50%, 0)";

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center align-middle ml-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="Hilfe anzeigen"
        className={`rounded-[3px] flex items-center justify-center cursor-help leading-none transition-colors ${iconStyle}`}
        style={{ width: size + 2, height: size + 2, padding: 1 }}
      >
        {/* Frage-Quadrat · kantig, passt zur Stahl-&-Beton-Sprache (Variante 16
            aus dem 21.05.2026 Mockup). Quadrat-Container + Fragezeichen innen,
            currentColor erbt die iconStyle-Textfarbe. */}
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-2.5 3" />
          <line x1="12" y1="16" x2="12" y2="16.01" strokeWidth="2.6" />
        </svg>
      </span>

      {open && pos && createPortal(
        <div
          role="tooltip"
          className="fixed z-[2147483000] pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform }}
        >
          <div className="bg-ink text-white text-[11.5px] font-sans leading-snug px-3 py-2 rounded-md shadow-xl max-w-[280px] w-max">
            {text}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
