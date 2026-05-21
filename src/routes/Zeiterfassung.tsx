import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  listWorkers, listSites, listAllEntries, listAssignmentsForCompany
} from "../lib/api";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { getHoliday, isHoliday } from "../lib/holidays";
import { isoWeek, todayIso, weekDays, fmtHours, workMinutes } from "../lib/utils";
import { isWorkEntry, DISCIPLINE_LABEL, type Assignment, type Entry, type Site, type Worker } from "../lib/types";
import {
  buildExportRows, buildCSV, downloadCSV, csvFilename, aggregate,
  LOHNART_LABEL, LOHNART_MAPPING, LOHNART_ABSENCE, type ExportRow,
} from "../lib/datev";
import BackButton from "../components/BackButton";

/* ────────────────────────────────────────────────────────────────────────
   Zeiterfassung · konsolidierter Tab
   Ersetzt die zuvor verteilten Top-Level-Einträge Wochenplan + Stunden
   + DATEV. Sub-Tabs: 01 Tagesplanung · 02 Wochenübersicht · 03 DATEV
   · 04 Urlaub & Krank. Tab-State in URL-Query (?tab=…) damit Reload bleibt.
   ──────────────────────────────────────────────────────────────────────── */

type TabKey = "tagesplanung" | "woche" | "datev" | "urlaub";

const TABS: { key: TabKey; num: string; label: string; hint: string }[] = [
  { key: "tagesplanung", num: "01", label: "Tagesplanung",     hint: "Matrix Mitarbeiter × Wochentag. Zeigt wer wo geplant ist und wo Einträge fehlen." },
  { key: "woche",        num: "02", label: "Wochenübersicht",  hint: "Summen pro Mitarbeiter, Vergleich Soll/Ist, Lücken-Übersicht." },
  { key: "datev",        num: "03", label: "DATEV-Export",     hint: "CSV-Export für den Steuerberater mit Lohnarten und Kostenstellen." },
  { key: "urlaub",       num: "04", label: "Urlaub & Krank",   hint: "Abwesenheiten dieser Woche pro Mitarbeiter, getrennt nach Urlaub und Krankheit." }
];

const DAY_LONG  = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const DAY_SHORT = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export default function Zeiterfassung() {
  const [params, setParams] = useSearchParams();
  const rawTab = (params.get("tab") ?? "tagesplanung") as TabKey;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? rawTab : "tagesplanung";

  function setTab(t: TabKey) {
    const p = new URLSearchParams(params);
    if (t === "tagesplanung") p.delete("tab"); else p.set("tab", t);
    setParams(p, { replace: false });
  }

  const [weekOffset, setWeekOffset] = useState(0);
  const refDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const { year, week } = isoWeek(refDate);
  const days = weekDays(year, week).slice(0, 5);
  const today = todayIso();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [w, s, e, a] = await Promise.all([
        listWorkers(),
        listSites().catch(() => [] as Site[]),
        listAllEntries(days[0], days[days.length - 1]).catch(() => [] as Entry[]),
        listAssignmentsForCompany(days[0], days[days.length - 1]).catch(() => [] as Assignment[])
      ]);
      setWorkers(w);
      setSites(s);
      setEntries(e);
      setAssignments(a);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  useRealtime(`zeiterfassung-${year}-${week}`, ["workers", "entries", "assignments", "sites"], refresh);
  useRefreshOnVisible(refresh);

  const team = useMemo(
    () => workers.filter((w) => !w.isAdmin).sort((a, b) => a.lastName.localeCompare(b.lastName, "de")),
    [workers]
  );

  const monthRangeLabel = useMemo(() => {
    const mo = new Date(days[0]);
    const fr = new Date(days[days.length - 1]);
    if (mo.getMonth() === fr.getMonth()) return `${mo.getDate()}. bis ${fr.getDate()}. ${MONTH_LONG[mo.getMonth()]}`;
    return `${mo.getDate()}. ${MONTH_LONG[mo.getMonth()]} bis ${fr.getDate()}. ${MONTH_LONG[fr.getMonth()]}`;
  }, [days]);

  // Helpers
  function siteOf(siteId?: string) { return sites.find((s) => s.id === siteId); }
  function entriesFor(workerId: string, date: string) { return entries.filter((e) => e.workerId === workerId && e.date === date); }
  function assignmentFor(workerId: string, date: string) { return assignments.find((a) => a.workerId === workerId && a.date === date); }
  function totalForWorker(workerId: string): number {
    return entries.filter((e) => e.workerId === workerId).reduce((s, e) => s + workMinutes(e), 0);
  }
  function gapsFor(workerId: string): number {
    let n = 0;
    for (const d of days) {
      if (d > today) continue;
      if (!entries.some((e) => e.workerId === workerId && e.date === d)) n += 1;
    }
    return n;
  }

  const totalWeekMinutes = team.reduce((s, w) => s + totalForWorker(w.id), 0);
  const holidayCount = days.filter((d) => isHoliday(d)).length;
  const sollMinutes = team.length * (40 - holidayCount * 8) * 60;
  const totalGaps = team.reduce((s, w) => s + gapsFor(w.id), 0);

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT flex flex-col">
      {/* HEADER ─ Stahl-Surface wie Angebote/Plan */}
      <header className="sticky top-0 z-30 surface-steel px-5 lg:px-10 xl:px-14 pt-4 pb-4 safe-top">
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

      <main className="flex-1 px-5 lg:px-10 xl:px-14 py-6">
        {loading ? (
          <div className="text-center py-16 font-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : tab === "tagesplanung" ? (
          <Tagesplanung
            team={team}
            days={days}
            today={today}
            entriesFor={entriesFor}
            assignmentFor={assignmentFor}
            siteOf={siteOf}
            sollMinutes={sollMinutes}
            totalWeekMinutes={totalWeekMinutes}
            totalGaps={totalGaps}
          />
        ) : tab === "woche" ? (
          <Wochenuebersicht
            team={team}
            days={days}
            today={today}
            entries={entries}
            totalForWorker={totalForWorker}
            gapsFor={gapsFor}
            holidayCount={holidayCount}
            totalWeekMinutes={totalWeekMinutes}
            sollMinutes={sollMinutes}
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

/* ──────── TAB 01 · Tagesplanung-Matrix ──────── */

function Tagesplanung({
  team, days, today, entriesFor, assignmentFor, siteOf,
  sollMinutes, totalWeekMinutes, totalGaps
}: {
  team: Worker[]; days: string[]; today: string;
  entriesFor: (workerId: string, date: string) => Entry[];
  assignmentFor: (workerId: string, date: string) => Assignment | undefined;
  siteOf: (id?: string) => Site | undefined;
  sollMinutes: number; totalWeekMinutes: number; totalGaps: number;
}) {
  return (
    <>
      <div className="dd-card overflow-hidden" style={{ ["--c" as any]: "#A9AEB3" }}>
        {/* Header-Zeile */}
        <div
          className="grid surface-steel text-white"
          style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="px-4 py-3 dd-eyebrow text-steel">Mitarbeiter</div>
          {days.map((iso) => {
            const dt = new Date(iso);
            const isToday = iso === today;
            const holiday = getHoliday(iso);
            return (
              <div key={iso} className="px-2 py-3 text-center border-l border-white/8 flex flex-col items-center gap-0.5">
                <span className="font-display font-black uppercase text-lg leading-none" style={{ color: isToday ? "#E8853F" : "#FFF" }}>
                  {DAY_SHORT[dt.getDay()]}
                </span>
                <span className="dd-eyebrow" style={{ color: isToday ? "#E8853F" : "#A9AEB3" }}>
                  {String(dt.getDate()).padStart(2, "0")}.{String(dt.getMonth() + 1).padStart(2, "0")}.{isToday ? " · HEUTE" : ""}
                </span>
                {holiday && (
                  <span className="font-mono text-[9px] tracking-wider text-bronze uppercase mt-0.5">{holiday.name}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Mitarbeiter-Zeilen */}
        {team.length === 0 ? (
          <div className="text-center py-12 font-mono text-ink-2 text-[12px]">Keine Mitarbeiter</div>
        ) : team.map((w, idx) => (
          <div
            key={w.id}
            className={`grid border-t border-ink/8 ${idx % 2 === 1 ? "bg-bg-2/40" : ""}`}
            style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {/* Name-Spalte */}
            <div className="px-4 py-3 flex items-center gap-3 border-r border-ink/8">
              <div className="w-10 h-10 rounded-full bg-bg-deep text-copper-bright font-display font-black text-[12px] flex items-center justify-center border border-paper-2 flex-shrink-0">
                {w.initials}
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold text-ink leading-tight truncate">{w.firstName} {w.lastName}</div>
                <div className="dd-eyebrow text-ink-mute mt-0.5 truncate">{w.role}</div>
              </div>
            </div>

            {/* Tage */}
            {days.map((iso) => {
              const es = entriesFor(w.id, iso);
              const workEntry = es.find(isWorkEntry);
              const absence = es.find((e) => !isWorkEntry(e));
              const plan = assignmentFor(w.id, iso);
              const isToday = iso === today;
              const isFuture = iso > today;

              return (
                <Cell
                  key={iso}
                  iso={iso}
                  isToday={isToday}
                  isFuture={isFuture}
                  workEntry={workEntry}
                  absence={absence}
                  plan={plan}
                  siteOf={siteOf}
                />
              );
            })}
          </div>
        ))}

        {/* Footer-Zeile mit Tagessumme */}
        {team.length > 0 && (
          <div
            className="grid border-t-2 border-ink bg-bg-3"
            style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="px-4 py-3 font-display font-black uppercase text-[13px] tracking-wide text-ink">Σ pro Tag</div>
            {days.map((iso) => {
              const dayTotal = team.reduce((s, w) => {
                const es = entriesFor(w.id, iso);
                return s + es.reduce((t, e) => t + workMinutes(e), 0);
              }, 0);
              const anyLive = team.some((w) => entriesFor(w.id, iso).length === 0 && iso === today && assignmentFor(w.id, iso));
              return (
                <div key={iso} className="px-2 py-3 text-center border-l border-ink/10 font-display font-black text-[16px] tabular-nums text-ink">
                  {dayTotal > 0 ? `${fmtHours(dayTotal)} h` : anyLive ? <span className="text-copper">läuft</span> : <span className="text-ink-mute">—</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action-Bar unten · Soll/Ist + DATEV */}
      <div className="mt-4 dd-card px-5 py-4 flex items-center justify-between gap-4 flex-wrap" style={{ ["--c" as any]: "#DC6E2D" }}>
        <div>
          <div className="dd-eyebrow text-copper">Wochen-Soll vs. Ist</div>
          <div className="font-display font-black text-2xl text-ink leading-none tabular-nums mt-1.5">
            {fmtHours(totalWeekMinutes)} <span className="text-base text-ink-mute font-mono tracking-wide">von {fmtHours(sollMinutes)} h</span>
            <span className="text-base text-ink-mute font-mono tracking-wide ml-2">
              · {sollMinutes > 0 ? Math.round((totalWeekMinutes / sollMinutes) * 100) : 0} %
              {totalGaps > 0 && <span className="text-rust font-bold"> · {totalGaps} {totalGaps === 1 ? "Lücke" : "Lücken"}</span>}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/admin/plan" className="btn-ghost !min-h-[44px] !px-5 text-[12px]">
            Tagesplan bearbeiten →
          </Link>
          <Link to="/admin/zeiterfassung?tab=datev" className="btn-primary !min-h-[44px] text-[12px] flex items-center">
            DATEV ↗
          </Link>
        </div>
      </div>
    </>
  );
}

function Cell({ isToday, isFuture, workEntry, absence, plan, siteOf }: {
  iso: string;
  isToday: boolean;
  isFuture: boolean;
  workEntry?: Entry;
  absence?: Entry;
  plan?: Assignment;
  siteOf: (id?: string) => Site | undefined;
}) {

  if (absence) {
    const tone = absence.type === "vacation" ? "moss"
               : absence.type === "sick"     ? "rust"
               : "bronze";
    const bg = tone === "moss"   ? "linear-gradient(180deg,#E2F0E6,#CFE5D7)"
             : tone === "rust"   ? "linear-gradient(180deg,#FBE6E4,#F1D3CF)"
             :                     "linear-gradient(180deg,#F4ECDD,#E5D5B0)";
    const fg = tone === "moss"   ? "#155F2E"
             : tone === "rust"   ? "#A21B1B"
             :                     "#6E5023";
    const label = absence.type === "vacation" ? "Urlaub"
                : absence.type === "sick"     ? "Krank"
                :                                "Feiertag";
    return (
      <div className="px-2 py-2.5 border-l border-ink/8 flex flex-col justify-center gap-0.5" style={{ background: bg }}>
        <div className="text-[12.5px] font-bold leading-tight" style={{ color: fg }}>{label}</div>
        <div className="font-mono text-[10px] tracking-wider uppercase" style={{ color: fg }}>
          {isToday ? "HEUTE" : "8.0 h gezählt"}
        </div>
      </div>
    );
  }

  if (workEntry && isWorkEntry(workEntry)) {
    const site = siteOf(workEntry.siteId);
    const min = (workEntry.endMin - workEntry.startMin) - workEntry.pauseMin;
    return (
      <div className="px-2 py-2.5 border-l border-ink/8 bg-gradient-to-b from-[#FFF8EF] to-[#FCEFDC] flex flex-col justify-center gap-0.5">
        <div className="text-[12px] font-bold text-ink leading-tight truncate">{site?.name ?? "Baustelle"}</div>
        <div className="font-mono text-[10px] tracking-wider text-copper uppercase truncate">{workEntry.discipline}</div>
        <div className="font-display font-black text-base text-ink tabular-nums leading-none mt-0.5">{fmtHours(Math.max(0, min))} h</div>
      </div>
    );
  }

  if (plan && isToday) {
    const site = siteOf(plan.siteId);
    return (
      <div className="px-2 py-2.5 border-l border-ink/8 border-2 border-dashed border-copper flex flex-col justify-center gap-0.5 bg-gradient-to-b from-[#FFF8EF] to-[#FCEFDC]">
        <div className="text-[12px] font-bold text-ink leading-tight truncate">{site?.name ?? "Baustelle"}</div>
        <div className="font-mono text-[10px] tracking-wider text-good uppercase font-bold">geplant</div>
        <div className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase">noch nicht erfasst</div>
      </div>
    );
  }

  if (plan) {
    const site = siteOf(plan.siteId);
    return (
      <div className="px-2 py-2.5 border-l border-ink/8 flex flex-col justify-center gap-0.5 bg-bg-3/30">
        <div className="text-[12px] font-bold text-ink-mute leading-tight truncate">geplant: {site?.name ?? "Baustelle"}</div>
        <div className="font-mono text-[10px] tracking-wider text-ink-mute uppercase">+ Eintrag</div>
      </div>
    );
  }

  if (isFuture) {
    return (
      <div className="px-2 py-2.5 border-l border-ink/8 bg-bg-3/30 flex items-center justify-center">
        <span className="font-mono text-[10px] tracking-wider text-ink-mute uppercase">—</span>
      </div>
    );
  }

  // Fehlt
  return (
    <div className="px-2 py-2.5 border-l border-ink/8 bg-rust/8 flex flex-col justify-center items-start gap-1">
      <div className="font-mono text-[10.5px] tracking-wider uppercase font-bold text-rust">kein Eintrag</div>
      <button className="font-mono text-[10px] tracking-wider uppercase text-white bg-rust px-2 py-1 rounded">
        Push senden
      </button>
    </div>
  );
}

/* ──────── TAB 02 · Wochenübersicht ──────── */

function Wochenuebersicht({
  team, totalForWorker, gapsFor,
  holidayCount, totalWeekMinutes, sollMinutes
}: {
  team: Worker[]; days: string[]; today: string; entries: Entry[];
  totalForWorker: (id: string) => number;
  gapsFor: (id: string) => number;
  holidayCount: number; totalWeekMinutes: number; sollMinutes: number;
}) {
  const wkSollPerWorker = (40 - holidayCount * 8) * 60;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#DC6E2D" }}>
          <div className="dd-eyebrow text-copper">Wochen-Σ</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">
            {fmtHours(totalWeekMinutes)} <span className="text-lg text-ink-mute font-mono">h</span>
          </div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            von {fmtHours(sollMinutes)} h · {sollMinutes > 0 ? Math.round((totalWeekMinutes / sollMinutes) * 100) : 0} %
          </div>
        </div>
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#1F7A3D" }}>
          <div className="dd-eyebrow text-good">Mitarbeiter</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">{team.length}</div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            Wochensoll je {fmtHours(wkSollPerWorker)} h
          </div>
        </div>
        <div className="dd-card px-5 py-4" style={{ ["--c" as any]: "#B91C1C" }}>
          <div className="dd-eyebrow text-rust">Feiertage</div>
          <div className="font-display font-black text-3xl text-ink leading-none tabular-nums mt-1.5">{holidayCount}</div>
          <div className="font-mono text-[11px] tracking-wider text-ink-2 uppercase mt-1">
            {holidayCount === 0 ? "kein Feiertag" : `Soll reduziert um ${holidayCount * 8} h`}
          </div>
        </div>
      </div>

      <div className="dd-card overflow-hidden" style={{ ["--c" as any]: "#A9AEB3" }}>
        <div className="surface-steel px-5 py-3 flex items-center justify-between">
          <div>
            <div className="dd-eyebrow text-copper-bright">Stunden je Mitarbeiter</div>
            <div className="font-display font-black uppercase text-base text-white mt-0.5">Σ Mo–Fr</div>
          </div>
          <Link to="/admin/stunden" className="dd-eyebrow text-steel hover:text-copper-bright">
            Detail-Tabelle →
          </Link>
        </div>
        <div className="divide-y divide-ink/8">
          {team.map((w) => {
            const total = totalForWorker(w.id);
            const gaps = gapsFor(w.id);
            const pct = wkSollPerWorker > 0 ? Math.min(100, (total / wkSollPerWorker) * 100) : 0;
            return (
              <div key={w.id} className="px-5 py-3 grid grid-cols-[48px_1fr_auto_auto] gap-4 items-center">
                <div className="w-10 h-10 rounded-full bg-bg-deep text-copper-bright font-display font-black text-[12px] flex items-center justify-center">{w.initials}</div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-ink truncate">{w.firstName} {w.lastName}</div>
                  <div className="dd-eyebrow text-ink-mute mt-0.5">{w.role}</div>
                  <div className="h-1.5 bg-bg-3 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${gaps > 0 ? "bg-rust" : pct >= 100 ? "bg-good" : "bg-copper"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display font-black text-xl tabular-nums text-ink leading-none">{fmtHours(total)}</div>
                  <div className="dd-eyebrow text-ink-mute mt-1">Std.</div>
                </div>
                <span className={`font-mono text-[10.5px] tracking-wider uppercase px-2.5 py-1 rounded-full font-bold ${
                  gaps > 0 ? "bg-rust/15 text-rust"
                  : pct >= 100 ? "bg-good/15 text-good"
                  : "bg-copper/15 text-copper"
                }`}>
                  {gaps > 0 ? `${gaps} Lücke${gaps === 1 ? "" : "n"}` : pct >= 100 ? "Komplett" : "Läuft"}
                </span>
              </div>
            );
          })}
          {team.length === 0 && (
            <div className="px-5 py-8 text-center font-mono text-ink-2 text-[12px]">Keine Mitarbeiter</div>
          )}
        </div>
      </div>
    </>
  );
}

/* ──────── TAB 03 · DATEV-Export ──────── */

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

/* ──────── TAB 04 · Urlaub & Krank ──────── */

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
