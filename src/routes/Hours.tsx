import { useEffect, useMemo, useState } from "react";
import { listAllEntries, listSites, listWorkers } from "../lib/api";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { getHoliday, isHoliday } from "../lib/holidays";
import {
  fmtHours, isoWeek, todayIso, weekDays, workMinutes
} from "../lib/utils";
import { isWorkEntry, type Entry, type Site, type Worker } from "../lib/types";
import BackButton from "../components/BackButton";

const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export default function Hours() {
  const [weekOffset, setWeekOffset] = useState(0);
  const refDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const { year, week } = isoWeek(refDate);
  const days = weekDays(year, week).slice(0, 5); // Mo–Fr
  const today = todayIso();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdmins, setShowAdmins] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [w, e, s] = await Promise.all([
        listWorkers(),
        listAllEntries(days[0], days[days.length - 1]),
        listSites().catch(() => [] as Site[])
      ]);
      setWorkers(w);
      setEntries(e);
      setSites(s);
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

  useRealtime("hours-overview", ["entries", "workers", "assignments"], refresh);
  useRefreshOnVisible(refresh);

  const team = useMemo(
    () => workers.filter((w) => showAdmins || !w.isAdmin)
      .sort((a, b) => Number(!!a.isAdmin) - Number(!!b.isAdmin) || a.lastName.localeCompare(b.lastName, "de")),
    [workers, showAdmins]
  );

  function entriesFor(workerId: string, date: string): Entry[] {
    return entries.filter((e) => e.workerId === workerId && e.date === date);
  }

  function siteOf(siteId: string): Site | undefined {
    return sites.find((s) => s.id === siteId);
  }

  // Wochensumme pro Worker (Arbeitsminuten)
  function totalForWorker(workerId: string): number {
    return entries
      .filter((e) => e.workerId === workerId)
      .reduce((sum, e) => sum + workMinutes(e), 0);
  }

  // Wochensoll: 40h minus 8h pro Feiertag
  const holidayCount = days.filter((d) => isHoliday(d)).length;
  const sollMin = (40 - holidayCount * 8) * 60;
  const totalAll = team.reduce((s, w) => s + totalForWorker(w.id), 0);

  const monthRangeLabel = useMemo(() => {
    const mo = new Date(days[0]);
    const fr = new Date(days[days.length - 1]);
    if (mo.getMonth() === fr.getMonth()) {
      return `${mo.getDate()}. bis ${fr.getDate()}. ${MONTH_LONG[mo.getMonth()]}`;
    }
    return `${mo.getDate()}. ${MONTH_LONG[mo.getMonth()]} bis ${fr.getDate()}. ${MONTH_LONG[fr.getMonth()]}`;
  }, [days]);

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT">
      <header className="sticky top-0 z-30 surface-steel px-5 lg:px-10 xl:px-14 pt-4 pb-4 safe-top">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 lg:gap-4 flex-wrap">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="w-9 h-9 rounded-full border border-white/20 text-white hover:border-copper-bright hover:bg-white/10 flex items-center justify-center text-lg leading-none transition-colors"
              title="Vorherige Woche"
            >‹</button>
            <div className="flex flex-col">
              <span className="dd-eyebrow text-copper-bright">Stunden · KW {week} / {year}</span>
              <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">{monthRangeLabel}</h1>
              <span className="font-sans text-[12px] text-steel mt-1">
                {weekOffset === 0 ? "Aktuelle Woche" : weekOffset < 0 ? "Vergangene Woche" : "Zukünftige Woche"}
                {holidayCount > 0 && ` · ${holidayCount} Feiertag${holidayCount > 1 ? "e" : ""}`}
              </span>
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
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-[12px] text-steel">
              <input
                type="checkbox"
                checked={showAdmins}
                onChange={(e) => setShowAdmins(e.target.checked)}
                className="accent-copper w-4 h-4"
              />
              Admins zeigen
            </label>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-8 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
          {error}
        </div>
      )}

      <main className="px-3 lg:px-10 xl:px-14 py-6">
        {loading ? (
          <div className="text-center py-16 h-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : team.length === 0 ? (
          <div className="text-center py-16 h-mono text-ink-2 text-[12px]">Keine Mitarbeiter</div>
        ) : (
          <>
          {/* MOBILE: pro Mitarbeiter eine Karte mit Tag-Liste */}
          <div className="space-y-3 lg:hidden">
            {team.map((w) => {
              const total = totalForWorker(w.id);
              const diff = total - sollMin;
              return (
                <article key={w.id} className="dd-card overflow-hidden" style={{ ["--c" as any]: total >= sollMin ? "#1F7A3D" : total === 0 ? "#A9AEB3" : "#DC6E2D" }}>
                  <header className="flex items-center justify-between px-4 py-3 bg-bg-3 border-b border-steel-line/40">
                    <div className="min-w-0">
                      <div className="font-display text-base uppercase tracking-tight leading-tight truncate">
                        {w.firstName} {w.lastName}
                        {w.isAdmin && <span className="ml-2 h-mono text-copper text-[9px]">ADMIN</span>}
                      </div>
                      <div className="h-mono text-ink-2 text-[10px] truncate">{w.role}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="h-display text-2xl leading-none">{fmtHours(total)}</div>
                      <div className={`h-mono text-[10px] mt-0.5 ${
                        total >= sollMin ? "text-good" : total === 0 ? "text-ink-mute" : "text-rust"
                      }`}>
                        {total === 0 ? "·" : diff >= 0 ? `+${fmtHours(diff)}h zu Soll` : `${fmtHours(diff)}h zu Soll`}
                      </div>
                    </div>
                  </header>
                  <ul className="divide-y divide-ink/10">
                    {days.map((iso) => {
                      const dayEntries = entriesFor(w.id, iso);
                      const dt = new Date(iso);
                      const isToday = iso === today;
                      const holiday = getHoliday(iso);
                      return (
                        <li
                          key={iso}
                          className={`px-4 py-2.5 grid grid-cols-[60px_1fr] gap-3 items-center ${
                            isToday ? "bg-copper/5" : holiday ? "bg-bronze/5" : ""
                          }`}
                        >
                          <div>
                            <div className={`h-mono font-bold text-[12px] ${isToday ? "text-copper" : holiday ? "text-bronze" : ""}`}>
                              {DAY_SHORT[dt.getDay()].toUpperCase()}
                            </div>
                            <div className="h-mono text-ink-2 text-[10px]">
                              {String(dt.getDate()).padStart(2,"0")}.{String(dt.getMonth()+1).padStart(2,"0")}.
                            </div>
                          </div>
                          <div className="min-w-0">
                            <Cell entries={dayEntries} date={iso} siteOf={siteOf} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
            <div className="dd-card px-4 py-3.5 flex items-center justify-between" style={{ ["--c" as any]: "#1A1C1E" }}>
              <div>
                <div className="h-mono text-copper text-[11px]">Gesamt</div>
                <div className="text-[12px] text-ink-2">{team.length} Mitarbeiter</div>
              </div>
              <div className="text-right">
                <div className="h-display text-2xl leading-none">{fmtHours(totalAll)}</div>
                <div className="h-mono text-ink-2 text-[10px] mt-0.5">erfasst · Soll {fmtHours(sollMin * team.length)}</div>
              </div>
            </div>
          </div>

          {/* DESKTOP: Tabelle */}
          <div className="hidden lg:block">
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="border-b-2 border-ink/20">
                  <th className="text-left h-mono text-copper text-[12px] py-4 px-4 bg-bg-DEFAULT w-[200px]">
                    Mitarbeiter
                  </th>
                  {days.map((iso) => {
                    const isToday = iso === today;
                    const dt = new Date(iso);
                    const holiday = getHoliday(iso);
                    return (
                      <th
                        key={iso}
                        className={`text-left h-mono py-4 px-3 ${
                          isToday ? "text-copper bg-copper/8" : holiday ? "text-bronze bg-bronze/8" : "text-ink-body"
                        }`}
                      >
                        <div className="text-[13px] font-bold">{DAY_SHORT[dt.getDay()]} {String(dt.getDate()).padStart(2,"0")}.{String(dt.getMonth()+1).padStart(2,"0")}.</div>
                        {holiday && (
                          <div className="text-[10px] mt-1 normal-case tracking-normal opacity-90">🎉 {holiday.name}</div>
                        )}
                        {isToday && !holiday && (
                          <div className="text-[10px] mt-1">Heute</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="text-right h-mono text-copper text-[12px] py-4 px-4 w-[140px]">
                    Σ Woche
                  </th>
                </tr>
              </thead>
              <tbody>
                {team.map((w) => {
                  const total = totalForWorker(w.id);
                  const diff = total - sollMin;
                  return (
                    <tr key={w.id} className="border-b border-ink/10 hover:bg-bg-2/50">
                      <td className="py-4 px-4 align-top">
                        <div className="font-display text-lg uppercase tracking-tight leading-tight truncate">
                          {w.firstName} {w.lastName}
                        </div>
                        {w.isAdmin && <span className="inline-block mt-1 h-mono text-copper text-[10px] px-1.5 py-0.5 bg-copper/10 rounded">ADMIN</span>}
                        <div className="h-mono text-ink-2 text-[11px] mt-1 truncate">{w.role}</div>
                      </td>
                      {days.map((iso) => (
                        <td
                          key={iso}
                          className={`py-3 px-2.5 align-top ${
                            iso === today ? "bg-copper/8" : isHoliday(iso) ? "bg-bronze/8" : ""
                          }`}
                        >
                          <Cell entries={entriesFor(w.id, iso)} date={iso} siteOf={siteOf} large />
                        </td>
                      ))}
                      <td className="py-4 px-4 text-right align-top">
                        <div className="h-display text-3xl leading-none">{fmtHours(total)}<span className="text-base text-ink-2 ml-1">h</span></div>
                        <div className={`h-mono text-[11px] mt-1.5 ${
                          total >= sollMin ? "text-good" : total === 0 ? "text-ink-mute" : "text-rust"
                        }`}>
                          {total === 0 ? "·" : diff >= 0 ? `+${fmtHours(diff)} zu Soll` : `${fmtHours(diff)} zu Soll`}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink/25 bg-bg-2">
                  <td className="py-4 px-4">
                    <div className="h-mono text-copper text-[12px]">Gesamt</div>
                    <div className="font-display text-base uppercase tracking-tight mt-1">{team.length} Mitarbeiter</div>
                    <div className="h-mono text-ink-2 text-[11px] mt-1">Soll {fmtHours(sollMin * team.length)} h</div>
                  </td>
                  <td colSpan={days.length} />
                  <td className="py-4 px-4 text-right">
                    <div className="h-display text-4xl leading-none">{fmtHours(totalAll)}<span className="text-lg text-ink-2 ml-1">h</span></div>
                    <div className="h-mono text-ink-2 text-[11px] mt-1.5">erfasst</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </main>
    </div>
  );
}

function Cell({
  entries, date, siteOf, large
}: {
  entries: Entry[];
  date: string;
  siteOf: (id: string) => Site | undefined;
  large?: boolean;
}) {
  const today = todayIso();
  const isPast = date < today;
  const holiday = getHoliday(date);

  if (entries.length > 0) {
    return (
      <div className="space-y-1.5">
        {entries.map((e, i) => (
          <CellEntry key={i} entry={e} site={siteOf(isWorkEntry(e) ? e.siteId : "")} large={large} />
        ))}
      </div>
    );
  }

  if (holiday) {
    return (
      <div className={`text-bronze leading-tight ${large ? "text-[12px]" : "text-[10px]"}`}>
        <div className="font-bold">FREI</div>
        <div className="opacity-75">Feiertag</div>
      </div>
    );
  }

  return (
    <div className={`text-center ${large ? "text-2xl" : "text-base"} ${isPast ? "text-rust/55" : "text-ink-mute"}`}>·</div>
  );
}

function CellEntry({ entry, site, large }: { entry: Entry; site?: Site; large?: boolean }) {
  if (isWorkEntry(entry)) {
    const min = workMinutes(entry);
    return (
      <div className={`bg-copper/10 border border-copper/40 rounded-lg ${large ? "px-3 py-2" : "px-1.5 py-1"}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-display leading-none ${large ? "text-xl" : "text-sm"}`}>
            {fmtHours(min)} <span className={`text-ink-2 ${large ? "text-xs" : "text-[10px]"}`}>h</span>
          </span>
          <span className={`h-mono text-copper font-bold ${large ? "text-[10px]" : "text-[9px]"}`}>{entry.discipline}</span>
        </div>
        {site?.projectNumber && (
          <div className={`h-mono text-copper/85 truncate ${large ? "text-[10px] mt-1" : "text-[9px] mt-0.5"}`}>
            #{site.projectNumber}
          </div>
        )}
        {site?.name && (
          <div className={`truncate leading-tight font-semibold ${large ? "text-[12px] mt-0.5" : "text-[10px] mt-0.5"}`}>
            {site.name}
          </div>
        )}
      </div>
    );
  }
  const meta = ABSENCE_META[entry.type];
  return (
    <div className={`rounded-lg ${meta.bg} ${large ? "px-3 py-2" : "px-1.5 py-1"}`}>
      <div className="flex items-center gap-1.5">
        <span className={large ? "text-base" : "text-sm"}>{meta.emoji}</span>
        <span className={`h-mono font-bold ${meta.fg} ${large ? "text-[11px]" : "text-[9px]"}`}>{meta.code}</span>
      </div>
      {entry.endDate && entry.endDate !== entry.date && (
        <div className={`text-ink-2 ${large ? "text-[11px] mt-1" : "text-[9px] mt-0.5"}`}>
          bis {entry.endDate.slice(8, 10)}.{entry.endDate.slice(5, 7)}.
        </div>
      )}
    </div>
  );
}

const ABSENCE_META = {
  sick:     { emoji: "🏥", code: "KRANK",  bg: "bg-rust/15 border border-rust/30",       fg: "text-rust" },
  vacation: { emoji: "🏖", code: "URLAUB", bg: "bg-moss/15 border border-moss-bright/30", fg: "text-moss-bright" },
  holiday:  { emoji: "🎉", code: "FREI",   bg: "bg-bronze/15 border border-bronze/30",   fg: "text-bronze" }
} as const;
