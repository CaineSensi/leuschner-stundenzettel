import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listWorkers, listSites, listAllEntries, listAssignmentsForCompany
} from "../lib/api";
import { useRealtime, useRefreshOnVisible, useRefreshOnAuth } from "../lib/realtime";
import { getHoliday, isHoliday } from "../lib/holidays";
import { isoWeek, todayIso, weekDays, fmtHours, workMinutes, isEntryActiveOn } from "../lib/utils";
import { isWorkEntry, type Assignment, type Entry, type Site, type Worker } from "../lib/types";
import BackButton from "../components/BackButton";

/* ────────────────────────────────────────────────────────────────────────
   Tagesplanung · eigenständige Top-Level-Kategorie
   Matrix Mitarbeiter × Wochentag (Mo–Fr) der gewählten Woche. Zeigt wer wo
   geplant/erfasst ist und wo Einträge fehlen. Eigene Wochen-Navigation.
   ──────────────────────────────────────────────────────────────────────── */

const DAY_LONG  = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const DAY_SHORT = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export default function Tagesplanung() {
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

  useRealtime(`tagesplanung-${days[0]}`, ["workers", "entries", "assignments", "sites"], refresh);
  useRefreshOnVisible(refresh);
  // Holt die Daten nach, sobald die Supabase-Session steht (Route mountet
  // sonst vor dem Session-Restore -> erster Fetch ohne Token -> leerer View).
  useRefreshOnAuth(refresh);

  const team = useMemo(() => {
    const workerIdsInRange = new Set<string>([
      ...entries.map((e) => e.workerId),
      ...assignments.map((a) => a.workerId),
    ]);
    return workers
      .filter((w) => !w.isAdmin || workerIdsInRange.has(w.id))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de"));
  }, [workers, entries, assignments]);

  const monthRangeLabel = useMemo(() => {
    const mo = new Date(days[0]);
    const fr = new Date(days[days.length - 1]);
    if (mo.getMonth() === fr.getMonth()) return `${mo.getDate()}. bis ${fr.getDate()}. ${MONTH_LONG[mo.getMonth()]}`;
    return `${mo.getDate()}. ${MONTH_LONG[mo.getMonth()]} bis ${fr.getDate()}. ${MONTH_LONG[fr.getMonth()]}`;
  }, [days]);

  function siteOf(siteId?: string) { return sites.find((s) => s.id === siteId); }
  function entriesFor(workerId: string, date: string) { return entries.filter((e) => e.workerId === workerId && isEntryActiveOn(e, date)); }
  function assignmentFor(workerId: string, date: string) { return assignments.find((a) => a.workerId === workerId && a.date === date); }
  function totalForWorker(workerId: string): number {
    return entries.filter((e) => e.workerId === workerId).reduce((s, e) => s + workMinutes(e), 0);
  }
  function gapsFor(workerId: string): number {
    let n = 0;
    for (const d of days) {
      if (d > today) continue;
      if (!entries.some((e) => e.workerId === workerId && isEntryActiveOn(e, d))) n += 1;
    }
    return n;
  }

  const totalWeekMinutes = team.reduce((s, w) => s + totalForWorker(w.id), 0);
  const holidayCount = days.filter((d) => isHoliday(d)).length;
  const sollMinutes = team.length * (40 - holidayCount * 8) * 60;
  const totalGaps = team.reduce((s, w) => s + gapsFor(w.id), 0);

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT flex flex-col">
      {/* HEADER ─ Stahl-Surface wie Zeiterfassung/Plan */}
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[1800px] mx-auto px-5 lg:px-10 xl:px-14 pt-4 pb-4">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">
              {DAY_LONG[refDate.getDay()]} · {new Date(today).toLocaleDateString("de-DE", { day: "2-digit", month: "long" })} · KW {week}
            </span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              Tagesplanung
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
          </div>
        </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-10 xl:mx-14 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust">
          {error}
        </div>
      )}

      <main className="flex-1 w-full max-w-[1800px] mx-auto px-5 lg:px-10 xl:px-14 py-6">
        {loading ? (
          <div className="text-center py-16 font-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : (
          <Matrix
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
        )}
      </main>
    </div>
  );
}

/* ──────── Tagesplanung-Matrix ──────── */

function Matrix({
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
    // Reine Arbeitszeit (Pause nicht abziehen — sie ist außerhalb der
    // Spanne und unbezahlt; siehe lib/utils:workMinutes, 09.06.2026).
    const min = workEntry.endMin - workEntry.startMin;
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
