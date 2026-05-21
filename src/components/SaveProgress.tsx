import { useEffect } from "react";

/* ────────────────────────────────────────────────────────────────────────
   SaveProgress · Modal das mehrere Speichern-Schritte live anzeigt.
   Status-Werte: pending → running → done | skipped | error.
   Modal lässt sich nicht schließen solange ein Schritt running ist.
   ──────────────────────────────────────────────────────────────────────── */

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface SaveStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  errorHint?: string;     // Zusatztext bei error, z. B. „Migration fehlt"
}

interface Props {
  open: boolean;
  steps: SaveStep[];
  title: string;
  /** Wenn nicht null: Action-Button unten (z. B. „Schließen" wenn alles done) */
  done?: { label: string; onClick: () => void };
  /** Wenn ein Schritt error hat: Action-Button (z. B. „Erneut versuchen") */
  retry?: { label: string; onClick: () => void };
  /** „Schließen" wenn kein Schritt mehr running */
  onClose?: () => void;
}

const ICON: Record<StepStatus, string> = {
  pending: "○", running: "◐", done: "✓", skipped: "—", error: "✕",
};
const COLOR: Record<StepStatus, string> = {
  pending: "#9CA3AF", running: "#DC6E2D", done: "#1F7A3D", skipped: "#9CA3AF", error: "#B91C1C",
};

export default function SaveProgress({ open, steps, title, done, retry, onClose }: Props) {
  const anyRunning = steps.some((s) => s.status === "running");
  const anyError   = steps.some((s) => s.status === "error");
  const allDone    = !anyRunning && !anyError && steps.every((s) => s.status === "done" || s.status === "skipped");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !anyRunning && onClose) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, anyRunning, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/55 z-[60]" onClick={() => !anyRunning && onClose?.()} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[92vw] max-w-[520px] bg-white rounded-xl shadow-2xl border border-steel-line/45 overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="surface-steel px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="dd-eyebrow text-copper-bright">
              {anyRunning ? "Wird ausgeführt …" : anyError ? "Mit Fehler beendet" : allDone ? "Erledigt" : "Bereit"}
            </div>
            <h2 className="font-display font-extrabold uppercase text-[18px] text-white leading-tight mt-0.5">
              {title}
            </h2>
          </div>
          {!anyRunning && onClose && (
            <button
              onClick={onClose}
              className="bg-white/10 border border-white/20 text-white w-8 h-8 rounded-md grid place-items-center hover:bg-white/20 text-[16px]"
              aria-label="Schließen"
            >✕</button>
          )}
        </div>

        <ul className="flex-1 overflow-y-auto p-5 space-y-2">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 px-3 py-2 rounded-md bg-bg-2">
              <span
                className={`font-mono font-bold text-[15px] leading-none flex-shrink-0 mt-0.5 ${s.status === "running" ? "animate-spin-slow" : ""}`}
                style={{ color: COLOR[s.status], width: 18, display: "inline-block", textAlign: "center" }}
                aria-hidden
              >
                {ICON[s.status]}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`font-sans text-[13.5px] ${
                  s.status === "done" ? "text-ink" :
                  s.status === "error" ? "text-rust font-bold" :
                  s.status === "running" ? "text-ink font-bold" :
                  "text-ink-2"
                }`}>
                  {s.label}
                </div>
                {s.detail && (
                  <div className="font-mono text-[11px] text-ink-2 mt-0.5 break-words whitespace-pre-wrap">
                    {s.detail}
                  </div>
                )}
                {s.status === "error" && s.errorHint && (
                  <div className="font-mono text-[11px] text-rust mt-1 bg-rust/10 border border-rust/30 rounded p-2 whitespace-pre-wrap">
                    {s.errorHint}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="px-5 py-3.5 bg-bg-2 border-t border-steel-line/45 flex flex-wrap gap-2 justify-end flex-shrink-0">
          {anyError && retry && (
            <button onClick={retry.onClick} className="btn-ghost !min-h-[40px] !px-4 text-[12px]">
              {retry.label}
            </button>
          )}
          {!anyRunning && onClose && (
            <button onClick={onClose} className="btn-ghost !min-h-[40px] !px-4 text-[12px]">
              Schließen
            </button>
          )}
          {allDone && done && (
            <button onClick={done.onClick} className="btn-primary !min-h-[40px] text-[12px] min-w-[140px]">
              {done.label}
            </button>
          )}
        </div>
      </div>

      <style>{`@keyframes ddspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.animate-spin-slow{display:inline-block;animation:ddspin 1.1s linear infinite}`}</style>
    </>
  );
}
