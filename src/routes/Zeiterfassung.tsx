import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  listWorkers, listSites, listAllEntries
} from "../lib/api";
import { useRealtime, useRefreshOnVisible, useRefreshOnAuth } from "../lib/realtime";
import { getHoliday, isHoliday } from "../lib/holidays";
import { isoWeek, todayIso, weekDays, fmtHours, workMinutes, paidMinutes, isWorkdayFor } from "../lib/utils";
import { isWorkEntry, DISCIPLINE_LABEL, type Entry, type Site, type Worker } from "../lib/types";
import {
  buildExportRows, buildCSV, downloadCSV, csvFilename, aggregate,
  LOHNART_LABEL, LOHNART_MAPPING, LOHNART_ABSENCE, type ExportRow,
} from "../lib/datev";
import BackButton from "../components/BackButton";

/* ────────────────────────────────────────────────────────────────────────
   Zeiterfassung · konsolidierter Tab
   Sub-Tabs: 01 Monat · 02 DATEV · 03 Urlaub & Krank. Die Tagesplanung ist
   eine eigene Top-Level-Kategorie (siehe routes/Tagesplanung.tsx).
   Tab-State in URL-Query (?tab=…) damit Reload bleibt.
   ──────────────────────────────────────────────────────────────────────── */

type TabKey = "monat" | "datev" | "urlaub";

const TABS: { key: TabKey; num: string; label: string; hint: string }[] = [
  { key: "monat",        num: "01", label: "Monatsübersicht",  hint: "Kalender-Grid des ganzen Monats. Summen pro Mitarbeiter, Soll/Ist, Feiertage." },
  { key: "datev",        num: "02", label: "DATEV-Export",     hint: "CSV-Export für den Steuerberater mit Lohnarten und Kostenstellen." },
  { key: "urlaub",       num: "03", label: "Urlaub & Krank",   hint: "Abwesenheiten dieser Woche pro Mitarbeiter, getrennt nach Urlaub und Krankheit." }
];

const DAY_LONG  = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

/** Kurz-Label für Arbeitstage-Set (Mo-Fr → "", sonst z.B. "Di+Do · "). */
function workdayLabel(workdays?: number[]): string {
  const std = [1,2,3,4,5];
  if (!workdays || workdays.length === 0) return "";
  if (workdays.length === 5 && std.every((d) => workdays.includes(d))) return "";
  const names = ["", "Mo","Di","Mi","Do","Fr","Sa","So"];
  return workdays.sort((a,b) => a-b).map((d) => names[d]).join("+") + " · ";
}

/** Alle Tage des Monats (Anker = beliebiger Tag im Monat) als ISO-Date-Strings. */
function allDaysOfMonth(anchor: Date): string[] {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export default function Zeiterfassung() {
  const [params, setParams] = useSearchParams();
  const rawTab = (params.get("tab") ?? "monat") as TabKey;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? rawTab : "monat";

  function setTab(t: TabKey) {
    const p = new URLSearchParams(params);
    if (t === "monat") p.delete("tab"); else p.set("tab", t);
    setParams(p, { replace: false });
  }

  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const refDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const { year, week } = isoWeek(refDate);
  const days = weekDays(year, week).slice(0, 5);
  const today = todayIso();

  // Für den Monat-Tab eigene Range: erster bis letzter Tag des Anker-Monats
  const monthAnchor = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const monthDays = useMemo(() => allDaysOfMonth(monthAnchor), [monthAnchor]);

  // Welcher Range wird geladen: für Monat-Tab der ganze Monat, sonst die Arbeitswoche
  const loadRange: [string, string] = tab === "monat"
    ? [monthDays[0], monthDays[monthDays.length - 1]]
    : [days[0], days[days.length - 1]];

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [w, s, e] = await Promise.all([
        listWorkers(),
        listSites().catch(() => [] as Site[]),
        listAllEntries(loadRange[0], loadRange[1]).catch(() => [] as Entry[])
      ]);
      setWorkers(w);
      setSites(s);
      setEntries(e);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, monthOffset, tab]);

  useRealtime(`zeiterfassung-${tab}-${loadRange[0]}`, ["workers", "entries", "sites"], refresh);
  useRefreshOnVisible(refresh);
  // Holt die Daten nach, sobald die Supabase-Session steht (Route mountet
  // sonst vor dem Session-Restore -> erster Fetch ohne Token -> leerer View).
  useRefreshOnAuth(refresh);

  // Auch Admins anzeigen, sofern sie Stunden gebucht haben oder im Range
  // geplant sind — Admin-Status ist eine Berechtigungs-Sache, nicht ein
  // „bucht-keine-Stunden"-Marker. Reine Admin-Konten (Office-only ohne
  // Entries) werden weiter ausgeblendet, damit die Matrix nicht aufbläht.
  const team = useMemo(() => {
    const workerIdsInRange = new Set<string>(entries.map((e) => e.workerId));
    return workers
      .filter((w) => !w.isAdmin || workerIdsInRange.has(w.id))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de"));
  }, [workers, entries]);

  const monthRangeLabel = useMemo(() => {
    const mo = new Date(days[0]);
    const fr = new Date(days[days.length - 1]);
    if (mo.getMonth() === fr.getMonth()) return `${mo.getDate()}. bis ${fr.getDate()}. ${MONTH_LONG[mo.getMonth()]}`;
    return `${mo.getDate()}. ${MONTH_LONG[mo.getMonth()]} bis ${fr.getDate()}. ${MONTH_LONG[fr.getMonth()]}`;
  }, [days]);

  // Helpers
  function totalForWorker(workerId: string): number {
    return entries.filter((e) => e.workerId === workerId).reduce((s, e) => s + workMinutes(e), 0);
  }

  const totalWeekMinutes = team.reduce((s, w) => s + totalForWorker(w.id), 0);
  const holidayCount = days.filter((d) => isHoliday(d)).length;
  const sollMinutes = team.length * (40 - holidayCount * 8) * 60;

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT flex flex-col">
      {/* HEADER ─ Stahl-Surface wie Angebote/Plan */}
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[1700px] mx-auto px-5 lg:px-10 xl:px-14 pt-4 pb-4">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">
              {DAY_LONG[refDate.getDay()]} · {new Date(today).toLocaleDateString("de-DE", { day: "2-digit", month: "long" })} · KW {week}
            </span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              Zeiterfassung
            </h1>
            <span className="font-mono text-[11.5px] mt-1.5 block tracking-wide text-steel">
              {!loading && `Live · ${team.length} Mitarbeiter · ${entries.length} Einträge KW ${week}`}
            </span>
          </div>
          {tab === "monat" ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setMonthOffset((o) => o - 1)}
                className="w-9 h-9 rounded-full border border-white/20 text-white hover:border-copper-bright hover:bg-white/10 flex items-center justify-center text-lg leading-none transition-colors"
                title="Vorheriger Monat"
              >‹</button>
              <div className="flex flex-col text-center">
                <span className="dd-eyebrow text-copper-bright">{MONTH_LONG[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}</span>
                <span className="font-mono text-[11.5px] text-steel">{monthDays.length} Tage</span>
              </div>
              <button
                onClick={() => setMonthOffset((o) => o + 1)}
                className="w-9 h-9 rounded-full border border-white/20 text-white hover:border-copper-bright hover:bg-white/10 flex items-center justify-center text-lg leading-none transition-colors"
                title="Nächster Monat"
              >›</button>
              <button
                onClick={() => setMonthOffset(0)}
                disabled={monthOffset === 0}
                className="font-mono text-[11px] px-3.5 py-1.5 rounded-full border border-copper-bright text-copper-bright hover:bg-copper-bright hover:text-bg-deep disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-copper-bright transition-colors"
              >Aktuell</button>
              <button className="btn-ghost !min-h-[42px] !px-4 text-[12px]">PDF</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setWeekOffset((o) => o - 1)}
                className="w-9 h-9 rounded-full border border-white/20 text-white hover:border-copper-bright hover:bg-white/10 flex items-center justify-center text-lg leading-none transition-colors"
                title="Vorherige Woche"
              >‹</button>
              <div className="flex flex-col text-center">
                <span className="dd-eyebrow text-copper-bright">KW {week} / {year}</span>
                <span className="font-mono text-[11.5px] text-steel">{monthRangeLabel}</span>
              </div>
              <button
                onClick={() => setWeekOffset((o) => o + 1)}
                className="w-9 h-9 rounded-full border border-white/20 text-white hover:border-copper-bright hover:bg-white/10 flex items-center justify-center text-lg leading-none transition-colors"
                title="Nächste Woche"
              >›</button>
              <button
                onClick={() => setWeekOffset(0)}
                disabled={weekOffset === 0}
                className="font-mono text-[11px] px-3.5 py-1.5 rounded-full border border-copper-bright text-copper-bright hover:bg-copper-bright hover:text-bg-deep disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-copper-bright transition-colors"
              >Heute</button>
              <button className="btn-ghost !min-h-[42px] !px-4 text-[12px]">PDF</button>
            </div>
          )}
        </div>
        </div>
      </header>

      {/* SUB-TABS */}
      <nav className="px-5 lg:px-10 xl:px-14 pt-5 -mb-px flex gap-0 border-b-2 border-ink">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.hint}
              className={`relative px-5 py-3 -mb-0.5 font-mono text-[12px] tracking-wider uppercase border-b-2 transition-colors ${
                active
                  ? "border-copper text-ink font-bold bg-gradient-to-b from-white to-bg-2 border-x border-x-steel-line border-t border-t-steel-line rounded-t-md"
                  : "border-transparent text-ink-2 hover:text-ink"
              }`}
              style={active ? { borderBottomColor: "transparent" } : undefined}
            >
              <span className={`mr-2 ${active ? "text-copper" : "text-ink-mute"}`}>{t.num}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="mx-5 lg:mx-10 xl:mx-14 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust">
          {error}
        </div>
      )}

      <main className="flex-1 w-full max-w-[1700px] mx-auto px-5 lg:px-10 xl:px-14 py-6">
        {loading ? (
          <div className="text-center py-16 font-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : tab === "monat" ? (
          <Monatsuebersicht
            team={team}
            monthDays={monthDays}
            monthAnchor={monthAnchor}
            today={today}
            entries={entries}
          />
        ) : tab === "datev" ? (
          <DatevTab
            week={week} year={year}
            totalWeekMinutes={totalWeekMinutes}
            sollMinutes={sollMinutes}
            team={team}
            days={days}
            entries={entries}
            sites={sites}
          />
        ) : (
          <UrlaubKrankTab team={team} entries={entries} days={days} />
        )}
      </main>
    </div>
  );
}

/* ──────── TAB 01 · Monatsübersicht ──────── */

function Monatsuebersicht({
  team, monthDays, monthAnchor, today, entries,
}: {
  team: Worker[]; monthDays: string[]; monthAnchor: Date; today: string;
  entries: Entry[];
}) {
  // Arbeitstage Mo–Fr ohne Feiertage (Soll-Berechnung)
  const workdays = monthDays.filter((iso) => {
    const wd = new Date(iso).getDay();
    return wd >= 1 && wd <= 5 && !isHoliday(iso);
  });
  const holidaysInMonth = monthDays.filter((iso) => {
    const wd = new Date(iso).getDay();
    return wd >= 1 && wd <= 5 && isHoliday(iso);
  });

  function targetOf(w: Worker): number { return w.dailyTargetMinutes ?? 480; }
  function workdaysOfWorker(w: Worker): number {
    return monthDays.filter((iso) => isWorkdayFor(w.workdays, iso)).length;
  }
  function sollForWorker(w: Worker): number { return workdaysOfWorker(w) * targetOf(w); }
  function workerEntriesOnDay(workerId: string, iso: string): Entry[] {
    return entries.filter((e) => e.workerId === workerId && e.date === iso);
  }
  /** Bezahlte Minuten für einen Worker an einem Tag — explizite Entries
   *  plus automatischer Feiertag-Lohn an regulären Arbeitstagen. */
  function paidOnDay(w: Worker, iso: string): number {
    const dayEntries = workerEntriesOnDay(w.id, iso);
    if (dayEntries.length > 0) {
      return dayEntries.reduce((s, e) => s + paidMinutes(e, targetOf(w)), 0);
    }
    if (isWorkdayFor(w.workdays, iso) && isHoliday(iso)) return targetOf(w);
    return 0;
  }
  function workerMinutes(w: Worker): number {
    return monthDays.reduce((s, iso) => s + paidOnDay(w, iso), 0);
  }
  function dayTotal(iso: string): number {
    return team.reduce((s, w) => s + paidOnDay(w, iso), 0);
  }

  const totalMonthMinutes = team.reduce((s, w) => s + workerMinutes(w), 0);
  const sollTotal = team.reduce((s, w) => s + sollForWorker(w), 0);

  // Kalender-Grid: erster Tag Mo-orientiert (1=Mo … 7=So)
  const firstWeekday = ((new Date(monthDays[0]).getDay() + 6) % 7); // 0=Mo, 6=So
  const totalCells = Math.ceil((firstWeekday + monthDays.length) / 7) * 7;

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#DC6E2D" }}>
          <div className="dd-eyebrow text-copper">Σ Monat</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">
            {fmtHours(totalMonthMinutes)} <span className="text-lg text-ink-mute font-mono">h</span>
          </div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            von {fmtHours(sollTotal)} h · {sollTotal > 0 ? Math.round((totalMonthMinutes / sollTotal) * 100) : 0} % · inkl. Feiertage/Urlaub/Krank
          </div>
        </div>
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#1F7A3D" }}>
          <div className="dd-eyebrow text-good">Arbeitstage</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">{workdays.length}</div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            Mo–Fr ohne Feiertage
          </div>
        </div>
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#B91C1C" }}>
          <div className="dd-eyebrow text-rust">Feiertage</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">{holidaysInMonth.length}</div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            {holidaysInMonth.length === 0 ? "keiner" : holidaysInMonth.map((d) => new Date(d).getDate() + ".").join(" ")} · werden mit Tagessoll bezahlt
          </div>
        </div>
      </div>

      {/* Mitarbeiter-Karten mit Monats-Summe */}
      <div className="dd-card overflow-hidden mb-5" style={{ ["--c" as any]: "#A9AEB3" }}>
        <div className="surface-steel px-5 py-3 flex items-center justify-between gap-4">
          <div>
            <div className="dd-eyebrow text-copper-bright">Stunden je Mitarbeiter · {MONTH_LONG[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}</div>
            <div className="font-display font-black uppercase text-base text-white mt-0.5">Σ {fmtHours(totalMonthMinutes)} h</div>
          </div>
          {team.length > 0 && (
            <Link
              to={`/admin/stunden-print-all?year=${monthAnchor.getFullYear()}&month=${monthAnchor.getMonth() + 1}`}
              target="_blank"
              rel="noopener"
              className="shrink-0 px-3 py-2 bg-copper text-white rounded font-mono text-[11px] tracking-wider uppercase hover:bg-copper-bright transition-colors print:hidden"
              title={`Alle Stundenzettel für ${MONTH_LONG[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()} als PDF (neuer Tab)`}
            >
              🖨 Alle als PDF
            </Link>
          )}
        </div>
        <div className="divide-y divide-ink/8">
          {team.length === 0 ? (
            <div className="px-5 py-8 text-center font-mono text-ink-2 text-[12px]">Keine Mitarbeiter</div>
          ) : team.map((w) => {
            const tot = workerMinutes(w);
            const soll = sollForWorker(w);
            const pct = soll > 0 ? Math.min(100, (tot / soll) * 100) : 0;
            const printHref = `/admin/stunden-print?worker=${w.id}&year=${monthAnchor.getFullYear()}&month=${monthAnchor.getMonth() + 1}`;
            return (
              <Link
                key={w.id}
                to={printHref}
                target="_blank"
                rel="noopener"
                className="px-5 py-3 grid grid-cols-[48px_1fr_auto] gap-4 items-center hover:bg-bg-2/40 transition-colors group"
                title={`Stundenzettel ${w.firstName} ${w.lastName} für ${MONTH_LONG[monthAnchor.getMonth()]} drucken (neuer Tab)`}
              >
                <div className="w-10 h-10 rounded-full bg-bg-deep text-copper-bright font-display font-black text-[12px] flex items-center justify-center">{w.initials}</div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-ink truncate group-hover:text-copper transition-colors">
                    {w.firstName} {w.lastName} <span className="text-ink-mute font-normal text-[11px] ml-1 print:hidden">🖨</span>
                  </div>
                  <div className="dd-eyebrow text-ink-mute mt-0.5">{w.role} · {workdayLabel(w.workdays)} {fmtHours(targetOf(w))} h/Tag</div>
                  <div className="h-1.5 bg-bg-3 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-good" : "bg-copper"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display font-black text-xl tabular-nums text-ink leading-none">{fmtHours(tot)}</div>
                  <div className="dd-eyebrow text-ink-mute mt-1">
                    von {fmtHours(soll)} h · {Math.round(pct)} %
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Kalender-Grid 7 Spalten Mo–So */}
      <div className="dd-card overflow-hidden" style={{ ["--c" as any]: "#DC6E2D" }}>
        <div className="surface-steel px-5 py-3">
          <div className="dd-eyebrow text-copper-bright">Kalender · jeden Tag Σ aller Mitarbeiter</div>
          <div className="font-display font-black uppercase text-base text-white mt-0.5">{MONTH_LONG[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}</div>
        </div>
        <div className="grid grid-cols-7 surface-steel text-white">
          {["Mo","Di","Mi","Do","Fr","Sa","So"].map((d) => (
            <div key={d} className="px-2 py-2 text-center dd-eyebrow border-l border-white/8 first:border-l-0 text-steel">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }).map((_, idx) => {
            const dayNum = idx - firstWeekday + 1;
            if (dayNum < 1 || dayNum > monthDays.length) {
              return <div key={idx} className="aspect-[5/4] border-t border-l border-ink/8 first:border-l-0 bg-bg-3/30" />;
            }
            const iso = monthDays[dayNum - 1];
            const dt = new Date(iso);
            const wd = dt.getDay();
            const isWeekend = wd === 0 || wd === 6;
            const isFuture = iso > today;
            const isToday = iso === today;
            const holiday = getHoliday(iso);
            const total = dayTotal(iso);
            const workerCount = team.filter((w) => workerEntriesOnDay(w.id, iso).some(isWorkEntry)).length;
            const bg = holiday
              ? "bg-bronze/10"
              : isToday
                ? "bg-gradient-to-b from-[#FFF8EF] to-[#FCEFDC]"
                : isWeekend
                  ? "bg-bg-3/40"
                  : "bg-white";
            return (
              <div
                key={idx}
                className={`aspect-[5/4] border-t border-l border-ink/8 first:border-l-0 px-2 py-1.5 flex flex-col justify-between ${bg}`}
              >
                <div className="flex items-start justify-between">
                  <span className={`font-display font-black text-sm tabular-nums leading-none ${isToday ? "text-copper" : holiday ? "text-bronze" : isWeekend ? "text-ink-mute" : "text-ink"}`}>
                    {dayNum}
                  </span>
                  {holiday && <span className="font-mono text-[8.5px] tracking-wider text-bronze uppercase truncate ml-1">{holiday.name}</span>}
                </div>
                {total > 0 ? (
                  <div className="text-right">
                    <div className="font-display font-black text-[14px] tabular-nums text-ink leading-none">{fmtHours(total)}h</div>
                    <div className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase mt-0.5">{workerCount} MA</div>
                  </div>
                ) : !isWeekend && !holiday && !isFuture ? (
                  <span className="font-mono text-[9.5px] tracking-wider text-rust/60 uppercase text-right">leer</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ──────── TAB 02 · DATEV-Export ──────── */

function DatevTab({
  week, year, totalWeekMinutes, sollMinutes, team, days, entries, sites,
}: {
  week: number; year: number; totalWeekMinutes: number; sollMinutes: number;
  team: Worker[]; days: string[]; entries: Entry[]; sites: Site[];
}) {
  const [showPreview, setShowPreview] = useState(false);

  const rows = useMemo(
    () => buildExportRows(days, team, entries, sites),
    [days, team, entries, sites]
  );
  const agg = useMemo(() => aggregate(rows), [rows]);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  function handleDownload() {
    if (rows.length === 0) {
      alert("Für diese Woche gibt es noch keine Stunden zum Exportieren.");
      return;
    }
    const csv = buildCSV(rows);
    downloadCSV(csvFilename(year, week), csv);
  }

  return (
    <div className="max-w-5xl space-y-4">
      {/* Status-Karte */}
      <div className="dd-card px-6 py-6" style={{ ["--c" as any]: "#DC6E2D" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="dd-eyebrow text-copper">DATEV-Export · KW {week} / {year}</div>
            <h2 className="font-display font-black uppercase text-2xl text-ink mt-1.5">
              {rows.length === 0
                ? "Noch keine Stunden in dieser Woche"
                : `${totalHours.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Stunden in ${rows.length} Zeilen`}
            </h2>
            <p className="text-[13.5px] text-ink-body mt-2 leading-relaxed max-w-[640px]">
              CSV-Export im DATEV-LODAS-Format: Semikolon-getrennt, UTF-8 mit BOM (Excel-tauglich),
              Komma als Dezimaltrenner. Spalten: Personalnummer · Name · Datum · Lohnart · Stunden
              · Kostenstelle · Bemerkung.
            </p>
          </div>
          <div className="flex flex-col gap-2 min-w-[180px]">
            <button
              onClick={handleDownload}
              disabled={rows.length === 0}
              title="Lädt die CSV-Datei mit allen Stunden dieser Woche herunter. Datei kann in Excel oder direkt im DATEV-Lohn-Modul geöffnet werden."
              className="btn-primary !min-h-[44px] text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↓ CSV herunterladen
            </button>
            <button
              onClick={() => setShowPreview(true)}
              disabled={rows.length === 0}
              title="Öffnet eine Vorschau-Tabelle mit allen Export-Zeilen — siehst genau was in der CSV-Datei landen wird, bevor du sie herunterlädst."
              className="btn-ghost !min-h-[44px] !px-4 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Vorschau ansehen
            </button>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-ink/10 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="dd-eyebrow text-ink-mute">Σ Stunden gebucht</div>
            <div className="font-display font-black text-2xl tabular-nums mt-1">{fmtHours(totalWeekMinutes)}</div>
          </div>
          <div>
            <div className="dd-eyebrow text-ink-mute">Soll Mo–Fr</div>
            <div className="font-display font-black text-2xl tabular-nums mt-1">{fmtHours(sollMinutes)}</div>
          </div>
          <div>
            <div className="dd-eyebrow text-ink-mute">Erfüllung</div>
            <div className="font-display font-black text-2xl tabular-nums mt-1">
              {sollMinutes > 0 ? Math.round((totalWeekMinutes / sollMinutes) * 100) : 0} %
            </div>
          </div>
          <div>
            <div className="dd-eyebrow text-ink-mute">Mitarbeiter im Export</div>
            <div className="font-display font-black text-2xl tabular-nums mt-1">{agg.perWorker.length}</div>
          </div>
        </div>
      </div>

      {/* Lohnart-Mapping (read-only · konfigurierbar im Code, bis StB liefert) */}
      <div className="dd-card px-6 py-5" style={{ ["--c" as any]: "#C9852F" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="dd-eyebrow text-bronze">Lohnart-Mapping</div>
            <p className="text-[12.5px] text-ink-body mt-1 max-w-[640px]">
              Default „010 Grundlohn" für alle Arbeits-Stunden bis der Steuerberater eine
              feinere Aufschlüsselung (z.B. eigene Lohnarten je Discipline) liefert.
              Anpassbar in <code className="font-mono text-[11.5px] bg-bg-deep text-copper-bright px-1.5 py-0.5 rounded">src/lib/datev.ts</code>.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {(["PFL", "GTN", "ZAU"] as const).map((d) => (
            <div key={d} className="flex items-center justify-between text-[12.5px] py-1 border-b border-ink/8">
              <span className="font-mono text-ink-2">{DISCIPLINE_LABEL[d]}</span>
              <span className="font-mono text-ink">
                Lohnart <b className="text-copper">{LOHNART_MAPPING[d]}</b>
                <span className="text-ink-mute ml-2">{LOHNART_LABEL[LOHNART_MAPPING[d]]}</span>
              </span>
            </div>
          ))}
          {(["vacation", "sick", "holiday"] as const).map((a) => (
            <div key={a} className="flex items-center justify-between text-[12.5px] py-1 border-b border-ink/8">
              <span className="font-mono text-ink-2">
                {a === "vacation" ? "Urlaub" : a === "sick" ? "Krankheit" : "Feiertag"}
              </span>
              <span className="font-mono text-ink">
                Lohnart <b className="text-copper">{LOHNART_ABSENCE[a]}</b>
                <span className="text-ink-mute ml-2">{LOHNART_LABEL[LOHNART_ABSENCE[a]]}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Summen pro Lohnart */}
      {agg.perLohnart.length > 0 && (
        <div className="dd-card px-6 py-5" style={{ ["--c" as any]: "#1F7A3D" }}>
          <div className="dd-eyebrow text-good mb-3">Summen je Lohnart in dieser Woche</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {agg.perLohnart.sort(([a], [b]) => a.localeCompare(b)).map(([code, hours]) => (
              <div key={code} className="bg-bg-2 border border-steel-line/45 rounded-lg px-3.5 py-2.5">
                <div className="font-mono text-[10px] tracking-wider text-ink-mute uppercase">Lohnart {code}</div>
                <div className="font-display font-black text-xl tabular-nums text-ink mt-0.5">
                  {hours.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h
                </div>
                <div className="font-mono text-[10.5px] text-ink-2 mt-0.5">{LOHNART_LABEL[code] ?? "?"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vorschau-Modal */}
      {showPreview && <PreviewModal rows={rows} week={week} year={year} onClose={() => setShowPreview(false)} onDownload={handleDownload} />}
    </div>
  );
}

function PreviewModal({
  rows, week, year, onClose, onDownload,
}: {
  rows: ExportRow[]; week: number; year: number; onClose: () => void; onDownload: () => void;
}) {
  return (
    <>
      <div className="dd-scrim on" onClick={onClose} />
      <aside className="dd-drawer on" role="dialog" aria-modal="true" aria-label="DATEV-Vorschau">
        <div className="surface-steel px-5 lg:px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="dd-eyebrow text-copper-bright">CSV-Vorschau · KW {week} / {year}</div>
              <h2 className="font-display font-black uppercase text-xl lg:text-2xl text-white mt-1 leading-tight">
                {rows.length} Zeilen · {csvFilename(year, week)}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="bg-white/10 border border-white/20 text-white w-9 h-9 rounded-md grid place-items-center hover:bg-white/20 text-[17px]"
            >✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 lg:px-6 py-5 board-scroll">
          <table className="w-full font-mono text-[11.5px] border-collapse">
            <thead className="sticky top-0 bg-bg-2 z-10">
              <tr className="border-b-2 border-ink">
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Pers-Nr</th>
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Name</th>
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Datum</th>
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Lohnart</th>
                <th className="text-right px-2 py-2 dd-eyebrow text-ink">Stunden</th>
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Kost-St</th>
                <th className="text-left px-2 py-2 dd-eyebrow text-ink">Bemerkung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className={`border-b border-ink/8 ${idx % 2 === 1 ? "bg-bg-2/40" : ""}`}>
                  <td className="px-2 py-1.5 text-ink font-bold">{r.personalNumber}</td>
                  <td className="px-2 py-1.5 text-ink">{r.workerName}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.date}</td>
                  <td className="px-2 py-1.5"><span className="text-copper font-bold">{r.lohnart}</span> <span className="text-ink-mute">{LOHNART_LABEL[r.lohnart] ?? ""}</span></td>
                  <td className="px-2 py-1.5 text-right text-ink tabular-nums font-bold">
                    {r.hours.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-2 py-1.5 text-ink-2">{r.kostenstelle || "—"}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.bemerkung}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink bg-bg-3">
                <td colSpan={4} className="px-2 py-2 font-display font-black uppercase text-ink text-[12px]">Σ Wochenstunden</td>
                <td className="px-2 py-2 text-right font-display font-black text-ink tabular-nums text-[14px]">
                  {rows.reduce((s, r) => s + r.hours, 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex-shrink-0 px-5 lg:px-6 py-3.5 bg-[#E2E4E7] border-t border-steel flex flex-wrap gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost !min-h-[44px] !px-4 text-[12px]">Schließen</button>
          <button onClick={onDownload} className="btn-primary !min-h-[44px] text-[12px]">↓ CSV herunterladen</button>
        </div>
      </aside>
    </>
  );
}

/* ──────── TAB 03 · Urlaub & Krank ──────── */

function UrlaubKrankTab({ team, entries, days }: { team: Worker[]; entries: Entry[]; days: string[] }) {
  const absences = entries.filter((e) => !isWorkEntry(e));
  const byWorker = team.map((w) => ({
    worker: w,
    vacation: absences.filter((e) => e.workerId === w.id && e.type === "vacation"),
    sick:     absences.filter((e) => e.workerId === w.id && e.type === "sick")
  }));
  const anyAbsence = byWorker.some((r) => r.vacation.length + r.sick.length > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="dd-card px-5 py-5" style={{ ["--c" as any]: "#1F7A3D" }}>
        <div className="dd-eyebrow text-good">Urlaub · KW {days[0].slice(5, 7)}.{days[0].slice(0, 4)}</div>
        <h3 className="font-display font-black uppercase text-lg text-ink mt-1">Wer ist diese Woche raus</h3>
        <div className="mt-4 divide-y divide-ink/8">
          {byWorker.filter((r) => r.vacation.length > 0).map((r) => (
            <div key={r.worker.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-moss-deep text-moss-bright font-display font-black text-[11px] flex items-center justify-center">{r.worker.initials}</div>
                <div>
                  <div className="text-[13px] font-bold text-ink">{r.worker.firstName} {r.worker.lastName}</div>
                  <div className="dd-eyebrow text-good mt-0.5">{r.vacation.length} {r.vacation.length === 1 ? "Tag" : "Tage"} Urlaub</div>
                </div>
              </div>
            </div>
          ))}
          {byWorker.every((r) => r.vacation.length === 0) && (
            <div className="py-5 text-center font-mono text-ink-mute text-[12px] uppercase tracking-wider">Niemand im Urlaub</div>
          )}
        </div>
      </div>

      <div className="dd-card px-5 py-5" style={{ ["--c" as any]: "#B91C1C" }}>
        <div className="dd-eyebrow text-rust">Krankheit · KW {days[0].slice(5, 7)}.{days[0].slice(0, 4)}</div>
        <h3 className="font-display font-black uppercase text-lg text-ink mt-1">Krank gemeldet</h3>
        <div className="mt-4 divide-y divide-ink/8">
          {byWorker.filter((r) => r.sick.length > 0).map((r) => (
            <div key={r.worker.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-bg-deep text-rust font-display font-black text-[11px] flex items-center justify-center border border-rust/30">{r.worker.initials}</div>
                <div>
                  <div className="text-[13px] font-bold text-ink">{r.worker.firstName} {r.worker.lastName}</div>
                  <div className="dd-eyebrow text-rust mt-0.5">{r.sick.length} {r.sick.length === 1 ? "Tag" : "Tage"} Krank</div>
                </div>
              </div>
            </div>
          ))}
          {byWorker.every((r) => r.sick.length === 0) && (
            <div className="py-5 text-center font-mono text-ink-mute text-[12px] uppercase tracking-wider">Niemand krank gemeldet</div>
          )}
        </div>
      </div>

      {!anyAbsence && (
        <div className="lg:col-span-2 dd-card px-6 py-8 text-center" style={{ ["--c" as any]: "#A9AEB3" }}>
          <div className="font-display font-black uppercase text-xl text-good">✓ Volle Mannschaft</div>
          <div className="font-mono text-[11.5px] tracking-wider text-ink-mute uppercase mt-2">
            Keine Abwesenheiten in dieser Woche
          </div>
        </div>
      )}
    </div>
  );
}
