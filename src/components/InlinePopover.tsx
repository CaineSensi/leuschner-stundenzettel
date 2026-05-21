import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────────────────────────────────────────────────────
   InlinePopover · klickbarer Trigger öffnet ein kleines Auswahl-Popover.
   Wird für Inline-Schnell-Wechsel von Status/Priorität/Vorgangstyp in
   der Inbox-Karte genutzt. Tooltip-haftes Verhalten (Click toggelt,
   Click-Outside schließt) + Portal in document.body damit das Popover
   nicht von overflow-hidden der Liste abgeschnitten wird.
   ──────────────────────────────────────────────────────────────────────── */

export interface PopoverOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  color?: string;
  active?: boolean;
}

export default function InlinePopover<T extends string>({
  trigger,
  title,
  options,
  onSelect,
  ariaLabel,
}: {
  /** Das anzuzeigende Element (Badge, Strich, Chip, …). Wird mit role=button gewrappt. */
  trigger: React.ReactNode;
  /** Überschrift im Popover, z.B. „Status ändern". */
  title?: string;
  options: PopoverOption<T>[];
  onSelect: (value: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      // Klicks im Popover dürfen nicht zu schließen — wir prüfen das anhand
      // einer data-Marke am Portal-Root
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-inline-popover]")) return;
      if (!ref.current?.contains(target)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function handleSelect(v: T) {
    onSelect(v);
    setOpen(false);
  }

  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }
      }}
      className="inline-block cursor-pointer hover:brightness-110 transition-[filter]"
    >
      {trigger}

      {open && pos && createPortal(
        <div
          role="menu"
          data-inline-popover
          className="fixed z-[2147483000] bg-white border border-steel-line/45 rounded-lg shadow-xl p-2 min-w-[200px]"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <div className="dd-eyebrow text-ink-2 px-2 pb-1.5 mb-1 border-b border-steel-line/45">
              {title}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {options.map((o) => (
              <button
                key={o.value}
                role="menuitem"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(o.value); }}
                className={`text-left px-2.5 py-1.5 rounded transition-colors ${
                  o.active
                    ? "bg-copper/10"
                    : "hover:bg-bg-2"
                }`}
                title={o.hint}
              >
                <span className="flex items-center gap-2">
                  {o.color && (
                    <span
                      aria-hidden
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className={`font-sans text-[12.5px] ${o.active ? "font-bold text-ink" : "text-ink"}`}>
                    {o.label}
                  </span>
                  {o.active && <span className="ml-auto font-mono text-[10px] text-copper">aktiv</span>}
                </span>
                {o.hint && (
                  <span className="block font-sans text-[10.5px] text-ink-2 mt-0.5 leading-snug">
                    {o.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
