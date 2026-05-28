import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listWorkers, listAllEntries } from "../lib/api";
import { isHoliday, getHoliday } from "../lib/holidays";
import { fmtHours, paidMinutes, workMinutes } from "../lib/utils";
import { isWorkEntry, DISCIPLINE_LABEL, type Entry, type Worker } from "../lib/types";

/* ────────────────────────────────────────────────────────────────────────
   Druck-Stundenzettel · ein Mitarbeiter, ein Monat
   URL-Parameter: ?worker=<id>&year=<YYYY>&month=<1-12>
   Bei Page-Load wird automatisch der Browser-Druckdialog geöffnet.
   ──────────────────────────────────────────────────────────────────────── */

const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const DAY_SHORT  = ["So","Mo","Di","Mi","Do","Fr","Sa"];

function daysOfMonth(year: number, month1to12: number): string[] {
  const last = new Date(year, month1to12, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${year}-${String(month1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function fmtTime(min?: number | null): string {
  if (min === null || min === undefined) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function StundenPrint() {
  const [params] = useSearchParams();
  const workerId = params.get("worker") ?? "";
  const year = parseInt(params.get("year") ?? String(new Date().getFullYear()), 10);
  const month = parseInt(params.get("month") ?? String(new Date().getMonth() + 1), 10);

  const days = useMemo(() => daysOfMonth(year, month), [year, month]);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const [worker, setWorker] = useState<Worker | null>(null);
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
        const w = ws.find((x) => x.id === workerId) ?? null;
        setWorker(w);
        setEntries(es.filter((e) => e.workerId === workerId));
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workerId, firstDay, lastDay]);

  // Auto-Print sobald Daten geladen sind und User es noch nicht abgebrochen hat
  useEffect(() => {
    if (loading || error || !worker) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [loading, error, worker]);

  if (loading) return <div className="p-10 font-mono text-sm">Lädt …</div>;
  if (error) return <div className="p-10 text-rust font-mono text-sm">Fehler: {error}</div>;
  if (!worker) return <div className="p-10 font-mono text-sm">Mitarbeiter nicht gefunden.</div>;

  const target = worker.dailyTargetMinutes ?? 480;
  const workdays = days.filter((iso) => {
    const wd = new Date(iso).getDay();
    return wd >= 1 && wd <= 5 && !isHoliday(iso);
  });
  const sollMinutes = workdays.length * target;
  const istMinutes = entries.reduce((s, e) => s + paidMinutes(e, target), 0);
  const workMinutesTotal = entries.reduce((s, e) => s + workMinutes(e), 0);
  const pct = sollMinutes > 0 ? Math.round((istMinutes / sollMinutes) * 100) : 0;

  return (
    <div className="bg-white text-black min-h-screen">
      {/* Bildschirm-Toolbar — beim Drucken ausgeblendet */}
      <div className="print:hidden bg-bg-deep text-white px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-50">
        <div className="font-mono text-[12px] tracking-wider uppercase">
          Druck-Ansicht · {worker.firstName} {worker.lastName} · {MONTH_LONG[month - 1]} {year}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-copper text-white rounded font-mono text-[12px] tracking-wider uppercase hover:bg-copper-bright"
          >
            🖨 Drucken
          </button>
          <Link
            to="/admin/zeiterfassung?tab=monat"
            className="px-4 py-2 border border-white/30 text-white rounded font-mono text-[12px] tracking-wider uppercase hover:bg-white/10"
          >
            ← Zurück
          </Link>
        </div>
      </div>

      {/* Druck-Bereich · A4-Verhältnis, schwarz auf weiß */}
      <div className="max-w-[210mm] mx-auto p-8 print:p-6 print:max-w-none">
        {/* Kopf */}
        <header className="flex items-end justify-between border-b-2 border-black pb-3 mb-5">
          <div>
            <div className="font-bold text-xs tracking-[0.2em] uppercase text-gray-600">Rund um's Haus Leuschner e.K.</div>
            <h1 className="text-2xl font-black uppercase mt-1">Stundennachweis</h1>
            <div className="text-sm mt-1">
              <span className="font-bold">{MONTH_LONG[month - 1]} {year}</span>
              <span className="text-gray-600"> · KW {String(getWeek(firstDay)).padStart(2, "0")} – {String(getWeek(lastDay)).padStart(2, "0")}</span>
            </div>
          </div>
          <div className="text-right text-sm leading-tight">
            <div className="font-bold uppercase tracking-wider text-[10px] text-gray-600">Mitarbeiter</div>
            <div className="text-xl font-bold">{worker.firstName} {worker.lastName}</div>
            <div className="text-xs text-gray-600 mt-0.5">{worker.role}</div>
            <div className="text-xs mt-1">
              Personalnr.: <span className="font-mono font-bold">{worker.initials}</span>
              <span className="mx-2 text-gray-400">·</span>
              Tagessoll: <span className="font-mono font-bold">{fmtHours(target)} h</span>
            </div>
          </div>
        </header>

        {/* Tabelle */}
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="px-1.5 py-1.5 w-[80px]">Datum</th>
              <th className="px-1.5 py-1.5 w-[28px]">Tag</th>
              <th className="px-1.5 py-1.5 w-[55px]">Beginn</th>
              <th className="px-1.5 py-1.5 w-[55px]">Ende</th>
              <th className="px-1.5 py-1.5 w-[55px]">Pause</th>
              <th className="px-1.5 py-1.5 w-[70px]">Art</th>
              <th className="px-1.5 py-1.5 w-[60px] text-right">Stunden</th>
              <th className="px-1.5 py-1.5">Bemerkung</th>
            </tr>
          </thead>
          <tbody>
            {days.map((iso) => {
              const dt = new Date(iso);
              const wd = dt.getDay();
              const isWeekend = wd === 0 || wd === 6;
              const holiday = getHoliday(iso);
              const dayEntries = entries.filter((e) => e.date === iso);
              const workEntry = dayEntries.find(isWorkEntry);
              const absence = dayEntries.find((e) => !isWorkEntry(e));

              // Stunden-Spalte
              let hoursCell: string = "";
              let artCell: string = "";
              let beginCell: string = "";
              let endCell: string = "";
              let pauseCell: string = "";
              let bemerkung: string = "";

              if (workEntry && isWorkEntry(workEntry)) {
                const mins = workMinutes(workEntry);
                hoursCell = `${fmtHours(mins, 2)}`;
                artCell = DISCIPLINE_LABEL[workEntry.discipline] ?? workEntry.discipline;
                beginCell = fmtTime(workEntry.startMin);
                endCell = fmtTime(workEntry.endMin);
                pauseCell = workEntry.pauseMin > 0 ? fmtTime(workEntry.pauseMin) : "—";
                bemerkung = workEntry.note ?? "";
              } else if (absence) {
                const label = absence.type === "vacation" ? "Urlaub"
                            : absence.type === "sick"     ? "Krank"
                            :                                "Feiertag";
                artCell = label;
                hoursCell = fmtHours(target, 2);
                bemerkung = absence.note ?? (absence.type === "holiday" ? (holiday?.name ?? "Feiertag") : "");
              } else if (holiday) {
                artCell = "Feiertag";
                hoursCell = fmtHours(target, 2);
                bemerkung = holiday.name;
              } else if (isWeekend) {
                artCell = wd === 6 ? "Samstag" : "Sonntag";
                hoursCell = "—";
              } else {
                hoursCell = "—";
              }

              const rowBg = isWeekend ? "bg-gray-100" : holiday ? "bg-yellow-50" : "";
              return (
                <tr key={iso} className={`border-b border-gray-300 ${rowBg}`}>
                  <td className="px-1.5 py-1 font-mono tabular-nums">{String(dt.getDate()).padStart(2,"0")}.{String(month).padStart(2,"0")}.</td>
                  <td className="px-1.5 py-1 font-bold">{DAY_SHORT[wd]}</td>
                  <td className="px-1.5 py-1 font-mono tabular-nums">{beginCell}</td>
                  <td className="px-1.5 py-1 font-mono tabular-nums">{endCell}</td>
                  <td className="px-1.5 py-1 font-mono tabular-nums">{pauseCell}</td>
                  <td className="px-1.5 py-1">{artCell}</td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums font-bold">{hoursCell}</td>
                  <td className="px-1.5 py-1 text-gray-700">{bemerkung}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td colSpan={6} className="px-1.5 py-2 uppercase text-[11px] tracking-wider">Σ Monat</td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-base">{fmtHours(istMinutes, 2)}</td>
              <td className="px-1.5 py-2 text-[10px] text-gray-600">davon gearbeitet: {fmtHours(workMinutesTotal, 2)} h</td>
            </tr>
          </tfoot>
        </table>

        {/* Bilanz-Block */}
        <div className="grid grid-cols-3 gap-4 mt-6 text-sm border border-gray-400 rounded p-3 bg-gray-50">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-600">Soll im Monat</div>
            <div className="font-bold text-lg tabular-nums">{fmtHours(sollMinutes, 1)} h</div>
            <div className="text-[10px] text-gray-600">{workdays.length} AT × {fmtHours(target, 1)} h</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-600">Ist im Monat</div>
            <div className="font-bold text-lg tabular-nums">{fmtHours(istMinutes, 1)} h</div>
            <div className="text-[10px] text-gray-600">inkl. Feiertag/Urlaub/Krank</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-600">Erfüllung</div>
            <div className="font-bold text-lg tabular-nums">{pct} %</div>
            <div className="text-[10px] text-gray-600">{istMinutes - sollMinutes >= 0 ? "+" : ""}{fmtHours(istMinutes - sollMinutes, 1)} h Saldo</div>
          </div>
        </div>

        {/* Unterschriften */}
        <div className="grid grid-cols-2 gap-12 mt-12 text-[10px] uppercase tracking-wider text-gray-600">
          <div className="border-t border-black pt-1">Datum / Unterschrift Mitarbeiter</div>
          <div className="border-t border-black pt-1">Datum / Unterschrift Vorgesetzter</div>
        </div>

        <div className="mt-6 text-center text-[9px] text-gray-500">
          Erstellt: {new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
          {" · "}leuschner-stundenzettel
        </div>
      </div>
    </div>
  );
}

// ISO-Wochennummer für Header-Anzeige
function getWeek(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((+d - +yearStart) / 86400000) + 1) / 7);
}
