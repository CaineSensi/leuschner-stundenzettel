import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listWorkers, listAllEntries } from "../lib/api";
import type { Entry, Worker } from "../lib/types";
import { StundenzettelSheet } from "./StundenPrint";

/* ────────────────────────────────────────────────────────────────────────
   Sammel-Druck · alle aktiven Mitarbeiter, ein Monat, je eine A4-Seite.
   URL-Parameter: ?year=<YYYY>&month=<1-12>
   Bei Page-Load wird automatisch der Browser-Druckdialog geöffnet —
   dort „Als PDF speichern" wählen, um alle Zettel als ein PDF zu sichern.
   ──────────────────────────────────────────────────────────────────────── */

const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function daysOfMonth(year: number, month1to12: number): string[] {
  const last = new Date(year, month1to12, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${year}-${String(month1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export default function StundenPrintAll() {
  const [params] = useSearchParams();
  const year = parseInt(params.get("year") ?? String(new Date().getFullYear()), 10);
  const month = parseInt(params.get("month") ?? String(new Date().getMonth() + 1), 10);

  const days = useMemo(() => daysOfMonth(year, month), [year, month]);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ws, es] = await Promise.all([
          listWorkers(),
          listAllEntries(firstDay, lastDay),
        ]);
        if (cancelled) return;
        setWorkers(ws);
        setEntries(es);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [firstDay, lastDay]);

  // Auto-Print sobald Daten geladen sind
  useEffect(() => {
    if (loading || error || workers.length === 0) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [loading, error, workers.length]);

  if (loading) return <div className="p-10 font-mono text-sm">Lädt …</div>;
  if (error) return <div className="p-10 text-rust font-mono text-sm">Fehler: {error}</div>;
  if (workers.length === 0) return <div className="p-10 font-mono text-sm">Keine Mitarbeiter gefunden.</div>;

  return (
    <div className="bg-white text-black min-h-screen">
      {/* Bildschirm-Toolbar — beim Drucken ausgeblendet */}
      <div className="print:hidden bg-bg-deep text-white px-6 py-3 sticky top-0 z-50">
        <div className="flex items-center justify-between gap-4">
          <div className="font-mono text-[12px] tracking-wider uppercase">
            Sammel-Druck · alle Mitarbeiter ({workers.length}) · {MONTH_LONG[month - 1]} {year}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-copper text-white rounded font-mono text-[12px] tracking-wider uppercase hover:bg-copper-bright"
            >
              🖨 Alle drucken / als PDF
            </button>
            <Link
              to="/admin/zeiterfassung?tab=monat"
              className="px-4 py-2 border border-white/30 text-white rounded font-mono text-[12px] tracking-wider uppercase hover:bg-white/10"
            >
              ← Zurück
            </Link>
          </div>
        </div>
        <div className="font-mono text-[10px] text-white/60 mt-1.5">
          💡 Tipp: Im Druckdialog „Als PDF speichern" wählen und „Kopf- und Fußzeilen" abwählen.
          Jeder Mitarbeiter landet auf einer eigenen Seite.
        </div>
      </div>

      {workers.map((w, i) => (
        <div key={w.id} className={i < workers.length - 1 ? "break-after-page" : ""}>
          <StundenzettelSheet worker={w} entries={entries} year={year} month={month} />
        </div>
      ))}
    </div>
  );
}
