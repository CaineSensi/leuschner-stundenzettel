import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listWorkers, listAllEntries } from "../lib/api";
import { isHoliday, getHoliday } from "../lib/holidays";
import { fmtHours, paidMinutes, workMinutes, isWorkdayFor } from "../lib/utils";
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

  // Soll = alle regulären Arbeitstage des Workers im Monat (Feiertage drin —
  // die werden mit Tagessoll bezahlt). Beispiel Rick (Di+Do): 4 Di + 4 Do = 8 Tage.
  const sollDays = days.filter((iso) => isWorkdayFor(worker.workdays, iso));
  const sollMinutes = sollDays.length * target;

  // Ist = explizite Entries + automatisch bezahlte Feiertage an Workdays
  // (für die kein eigener Entry existiert). Wochenende-Feiertage zählen nicht.
  const datesWithEntry = new Set(entries.map((e) => e.date));
  const autoHolidayMinutes = days
    .filter((iso) => isWorkdayFor(worker.workdays, iso) && isHoliday(iso) && !datesWithEntry.has(iso))
    .length * target;
  const entryPaid = entries.reduce((s, e) => s + paidMinutes(e, target), 0);
  const istMinutes = entryPaid + autoHolidayMinutes;
  const workMinutesTotal = entries.reduce((s, e) => s + workMinutes(e), 0);
  const pct = sollMinutes > 0 ? Math.round((istMinutes / sollMinutes) * 100) : 0;

  return (
    <div className="bg-white text-black min-h-screen">
      {/* Bildschirm-Toolbar — beim Drucken ausgeblendet */}
      <div className="print:hidden bg-bg-deep text-white px-6 py-3 sticky top-0 z-50">
        <div className="flex items-center justify-between gap-4">
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
        <div className="font-mono text-[10px] text-white/60 mt-1.5">
          💡 Tipp: Im Druckdialog „Kopf- und Fußzeilen" abwählen (Optionen → Weitere
          Einstellungen), damit URL/Datum am Seitenrand nicht mitgedruckt werden.
        </div>
      </div>

      {/* Druck-Bereich · A4 mit kompakter Skalierung damit alles auf eine Seite passt */}
      <div className="max-w-[210mm] mx-auto p-6 print:p-4 print:max-w-none">
        {/* Kopf — kompakt */}
        <header className="flex items-end justify-between border-b-2 border-black pb-2 mb-2.5">
          <div>
            <div className="font-bold text-[9px] tracking-[0.2em] uppercase text-gray-600">Rund um's Haus Leuschner e.K.</div>
            <h1 className="text-xl print:text-lg font-black uppercase mt-0.5 leading-tight">Stundennachweis</h1>
            <div className="text-[11px] print:text-[10px] mt-0.5">
              <span className="font-bold">{MONTH_LONG[month - 1]} {year}</span>
              <span className="text-gray-600"> · KW {String(getWeek(firstDay)).padStart(2, "0")} – {String(getWeek(lastDay)).padStart(2, "0")}</span>
            </div>
          </div>
          <div className="text-right leading-tight">
            <div className="font-bold uppercase tracking-wider text-[9px] text-gray-600">Mitarbeiter</div>
            <div className="text-base font-bold leading-tight">{worker.firstName} {worker.lastName}</div>
            <div className="text-[10px] text-gray-600">{worker.role}</div>
            <div className="text-[10px] mt-0.5">
              Personalnr. <span className="font-mono font-bold">{worker.initials}</span>
              <span className="mx-1.5 text-gray-400">·</span>
              Tagessoll <span className="font-mono font-bold">{fmtHours(target)} h</span>
            </div>
          </div>
        </header>

        {/* Tabelle — sehr kompakt, alle 28–31 Tage auf einer A4 */}
        <table className="w-full text-[10px] print:text-[9px] border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="px-1 py-1 w-[60px]">Datum</th>
              <th className="px-1 py-1 w-[24px]">Tag</th>
              <th className="px-1 py-1 w-[42px]">Beginn</th>
              <th className="px-1 py-1 w-[42px]">Ende</th>
              <th className="px-1 py-1 w-[42px]">Pause</th>
              <th className="px-1 py-1 w-[80px]">Art</th>
              <th className="px-1 py-1 w-[52px] text-right">Stunden</th>
              <th className="px-1 py-1">Bemerkung</th>
            </tr>
          </thead>
          <tbody>
            {days.map((iso) => {
              const dt = new Date(iso);
              const wd = dt.getDay();
              const isWeekend = wd === 0 || wd === 6;
              const holiday = getHoliday(iso);
              const isWorkerDay = isWorkdayFor(worker.workdays, iso);
              const dayEntries = entries.filter((e) => e.date === iso);
              const workEntry = dayEntries.find(isWorkEntry);
              const absence = dayEntries.find((e) => !isWorkEntry(e));

              let hoursCell = "";
              let artCell = "";
              let beginCell = "";
              let endCell = "";
              let pauseCell = "";
              let bemerkung = "";

              if (workEntry && isWorkEntry(workEntry)) {
                hoursCell = fmtHours(workMinutes(workEntry), 2);
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
              } else if (holiday && isWorkerDay) {
                // Feiertag an einem regulären Arbeitstag → automatisch
                // mit Tagessoll bezahlt (Feiertagslohn nach EFZG).
                artCell = "Feiertag";
                hoursCell = fmtHours(target, 2);
                bemerkung = holiday.name;
              } else if (holiday) {
                // Feiertag an einem Nicht-Arbeitstag des Workers → kein Lohn,
                // er hätte sowieso nicht gearbeitet.
                artCell = "Feiertag";
                hoursCell = "—";
                bemerkung = holiday.name;
              } else if (!isWorkerDay) {
                artCell = "frei";
                hoursCell = "—";
              } else {
                // Regulärer Arbeitstag ohne Eintrag → Lücke
                hoursCell = "—";
              }

              const rowBg = isWeekend || !isWorkerDay
                ? "bg-gray-100"
                : holiday ? "bg-yellow-50" : "";
              return (
                <tr key={iso} className={`border-b border-gray-300 ${rowBg}`}>
                  <td className="px-1 py-[2px] font-mono tabular-nums">{String(dt.getDate()).padStart(2,"0")}.{String(month).padStart(2,"0")}.</td>
                  <td className="px-1 py-[2px] font-bold">{DAY_SHORT[wd]}</td>
                  <td className="px-1 py-[2px] font-mono tabular-nums">{beginCell}</td>
                  <td className="px-1 py-[2px] font-mono tabular-nums">{endCell}</td>
                  <td className="px-1 py-[2px] font-mono tabular-nums">{pauseCell}</td>
                  <td className="px-1 py-[2px]">{artCell}</td>
                  <td className="px-1 py-[2px] text-right font-mono tabular-nums font-bold">{hoursCell}</td>
                  <td className="px-1 py-[2px] text-gray-700 truncate max-w-0">{bemerkung}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td colSpan={6} className="px-1 py-1.5 uppercase text-[10px] tracking-wider">Σ Monat</td>
              <td className="px-1 py-1.5 text-right font-mono tabular-nums text-[12px]">{fmtHours(istMinutes, 2)}</td>
              <td className="px-1 py-1.5 text-[9px] text-gray-600">davon gearbeitet: {fmtHours(workMinutesTotal, 2)} h</td>
            </tr>
          </tfoot>
        </table>

        {/* Bilanz-Block — einzeilig kompakt */}
        <div className="grid grid-cols-3 gap-3 mt-3 border border-gray-400 rounded px-3 py-2 bg-gray-50 text-[10px]">
          <div>
            <span className="uppercase tracking-wider text-gray-600">Soll: </span>
            <span className="font-mono font-bold tabular-nums">{fmtHours(sollMinutes, 1)} h</span>
            <span className="text-gray-600 ml-1">({sollDays.length} AT × {fmtHours(target, 1)} h)</span>
          </div>
          <div>
            <span className="uppercase tracking-wider text-gray-600">Ist: </span>
            <span className="font-mono font-bold tabular-nums">{fmtHours(istMinutes, 1)} h</span>
            <span className="text-gray-600 ml-1">inkl. Feiertag/Urlaub/Krank</span>
          </div>
          <div>
            <span className="uppercase tracking-wider text-gray-600">Erfüllung: </span>
            <span className="font-mono font-bold tabular-nums">{pct} %</span>
            <span className="text-gray-600 ml-1">({istMinutes - sollMinutes >= 0 ? "+" : ""}{fmtHours(istMinutes - sollMinutes, 1)} h Saldo)</span>
          </div>
        </div>

        {/* Unterschriften — kompakt */}
        <div className="grid grid-cols-2 gap-12 mt-6 print:mt-4 text-[9px] uppercase tracking-wider text-gray-600">
          <div className="border-t border-black pt-1">Datum / Unterschrift Mitarbeiter</div>
          <div className="border-t border-black pt-1">Datum / Unterschrift Vorgesetzter</div>
        </div>

        <div className="mt-3 text-center text-[8px] text-gray-500">
          Erstellt {new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })} · leuschner-stundenzettel
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
