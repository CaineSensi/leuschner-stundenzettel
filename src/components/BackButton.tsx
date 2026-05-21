import { useNavigate } from "react-router-dom";

/* ────────────────────────────────────────────────────────────────────────
   BackButton · konsistenter „zurück"-Button in allen Admin-Headern.
   Sichtbar (Border + heller Hintergrund), animierter Pfeil in Kupfer,
   damit auch jemand anders am Bildschirm sofort weiß wo er hin klicken
   muss. Wird in jeder Admin-Route oben links eingebaut.
   ──────────────────────────────────────────────────────────────────────── */
export default function BackButton({
  to = "/admin",
  label = "Zur Übersicht",
  title,
}: {
  to?: string;
  label?: string;
  /** Tooltip für die HTML-`title`-Anzeige (mouse-hover). */
  title?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      title={title ?? `Zurück: ${label}`}
      className="group inline-flex items-center gap-2.5 px-3.5 py-2 rounded-md bg-white/10 border border-white/25 hover:bg-white/20 hover:border-copper-bright transition-colors mb-3"
    >
      <span
        aria-hidden
        className="text-copper-bright text-[18px] leading-none group-hover:-translate-x-0.5 transition-transform"
      >←</span>
      <span className="font-display font-extrabold uppercase tracking-wide text-[12px] text-white">
        {label}
      </span>
    </button>
  );
}
