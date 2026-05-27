import { useEffect, useMemo, useState } from "react";
import {
  listAssignmentsForCompany, listAllEntries, listSites, listWorkers,
  upsertAssignment, deleteAssignment, publishWeek
} from "../lib/api";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import { getHoliday } from "../lib/holidays";
import { isWorkEntry, type Assignment, type Entry, type Site, type Worker } from "../lib/types";
import { isoWeek, todayIso, weekDays, withTimeout } from "../lib/utils";
import BackButton from "../components/BackButton";

const MONTH_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const DAY_LONG = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];

export default function Plan() {
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
  // Auch Admin/Inhaber kommen in den Pool — Rick & Co. müssen sich selbst auf
  // Baustellen schicken können, wenn sie mit anpacken. Sortiert: Nicht-Admins zuerst.
  const team = useMemo(
    () => [...workers].sort((a, b) => Number(!!a.isAdmin) - Number(!!b.isAdmin)),
    [workers]
  );

  const [sites, setSites] = useState<Site[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [absences, setAbsences] = useState<Entry[]>([]);
  const [pendingSites, setPendingSites] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ date: string } | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [draggedWorker, setDraggedWorker] = useState<{ workerId: string; from: "pool" | { date: string; siteId: string } } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ date: string; siteId: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  // Workers einmalig laden
  useEffect(() => {
    console.log("[plan] listWorkers start");
    withTimeout(listWorkers(), 8000, "Mitarbeiter-Liste")
      .then((w) => { console.log("[plan] listWorkers ok", w.length); setWorkers(w); })
      .catch((e) => { console.error("[plan] listWorkers FAIL", e); setError(`Mitarbeiter: ${e.message}`); });
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      console.log("[plan] refresh start", days[0], "→", days[days.length - 1]);
      const [s, a, e] = await Promise.all([
        withTimeout(listSites(), 8000, "Baustellen"),
        withTimeout(listAssignmentsForCompany(days[0], days[days.length - 1]), 8000, "Wochenplan"),
        withTimeout(listAllEntries(days[0], days[days.length - 1]), 8000, "Einträge").catch(() => [] as Entry[])
      ]);
      console.log("[plan] refresh ok", { sites: s.length, assignments: a.length, entries: e.length });
      setSites(s);
      setAssignments(a);
      // Nur Abwesenheits-Einträge (Krank/Urlaub/Feiertag) — Arbeitsstunden brauchen wir hier nicht
      setAbsences(e.filter((entry) => !isWorkEntry(entry)));
    } catch (err: any) {
      console.error("[plan] refresh FAIL", err);
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  function absenceForDay(workerId: string, date: string): Entry | undefined {
    return absences.find((e) => {
      if (e.workerId !== workerId) return false;
      if (isWorkEntry(e)) return false;
      const start = e.date;
      const end = e.endDate ?? e.date;
      return date >= start && date <= end;
    });
  }

  useEffect(() => {
    refresh();
    setPendingSites({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  // Echtzeit: bei Änderungen an Zuweisungen, Baustellen, Workers oder Abwesenheiten sofort neu laden
  useRealtime(`plan-${year}-${week}`, ["assignments", "sites", "workers", "entries"], refresh);
  useRefreshOnVisible(refresh);
  useRefreshOnAuth(refresh);

  function siteIdsForDay(date: string): string[] {
    const fromAssignments = Array.from(
      new Set(assignments.filter((a) => a.date === date).map((a) => a.siteId))
    );
    const pending = (pendingSites[date] ?? []).filter((id) => !fromAssignments.includes(id));
    return [...fromAssignments, ...pending];
  }

  function workersOnSite(date: string, siteId: string): Assignment[] {
    return assignments.filter((a) => a.date === date && a.siteId === siteId);
  }

  function getSite(id: string): Site | undefined {
    return sites.find((s) => s.id === id);
  }

  function getWorker(id: string): Worker | undefined {
    return team.find((w) => w.id === id);
  }

  async function handleDrop(date: string, siteId: string) {
    if (!draggedWorker) return;
    const { workerId, from } = draggedWorker;
    setDraggedWorker(null);
    setDropTarget(null);

    if (typeof from === "object" && from.date === date && from.siteId === siteId) return;

    const existing = assignments.find((a) => a.workerId === workerId && a.date === date);

    setError(null);
    try {
      if (existing) {
        await deleteAssignment(workerId, date);
      }
      const saved = await upsertAssignment({
        workerId, date, siteId, discipline: "PFL"
      });
      setAssignments((prev) => {
        const filtered = prev.filter((a) => !(a.workerId === workerId && a.date === date));
        return [...filtered, saved];
      });
      setPendingSites((prev) => {
        const list = (prev[date] ?? []).filter((id) => id !== siteId);
        return { ...prev, [date]: list };
      });
    } catch (err: any) {
      setError(err?.message ?? "Speichern fehlgeschlagen");
    }
  }

  async function handleRemoveWorker(date: string, workerId: string) {
    setError(null);
    try {
      await deleteAssignment(workerId, date);
      setAssignments((prev) => prev.filter((a) => !(a.workerId === workerId && a.date === date)));
    } catch (err: any) {
      setError(err?.message ?? "Entfernen fehlgeschlagen");
    }
  }

  async function handleRemoveSite(date: string, siteId: string) {
    const onSite = workersOnSite(date, siteId);
    if (onSite.length > 0 && !confirm(`${onSite.length} Mitarbeiter sind dort zugewiesen, wirklich entfernen?`)) {
      return;
    }
    setError(null);
    try {
      await Promise.all(onSite.map((a) => deleteAssignment(a.workerId, a.date)));
      setAssignments((prev) => prev.filter((a) => !(a.date === date && a.siteId === siteId)));
      setPendingSites((prev) => {
        const list = (prev[date] ?? []).filter((id) => id !== siteId);
        return { ...prev, [date]: list };
      });
    } catch (err: any) {
      setError(err?.message ?? "Entfernen fehlgeschlagen");
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    setPublishMsg(null);
    try {
      const count = await publishWeek(days[0], days[days.length - 1]);
      if (count === 0) {
        setPublishMsg("Nichts neues zu übertragen, alles bereits aktuell.");
      } else {
        setPublishMsg(`✓ ${count} ${count === 1 ? "Zuweisung" : "Zuweisungen"} an die Mitarbeiter übertragen`);
      }
      setTimeout(() => setPublishMsg(null), 4000);
      refresh();
    } catch (err: any) {
      setError(err?.message ?? "Übertragen fehlgeschlagen");
    } finally {
      setPublishing(false);
    }
  }

  function handleAddSite(date: string, siteId: string) {
    setPicker(null);
    setPickerSearch("");
    setPendingSites((prev) => {
      const list = prev[date] ?? [];
      if (list.includes(siteId)) return prev;
      return { ...prev, [date]: [...list, siteId] };
    });
  }

  const filteredSites = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    let list = [...sites];
    if (q) {
      list = list.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.street.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) =>
      Number(!!b.starred) - Number(!!a.starred) || a.name.localeCompare(b.name, "de")
    );
  }, [sites, pickerSearch]);

  const draftCount = assignments.filter((a) => !a.publishedAt).length;

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
      {/* HEADER — wie Sites/Hours */}
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
              <span className="dd-eyebrow text-copper-bright">KW {week} / {year}</span>
              <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">{monthRangeLabel}</h1>
              <span className="font-sans text-[12px] text-steel mt-1">
                {weekOffset === 0 ? "Aktuelle Woche" : weekOffset < 0 ? "Vergangene Woche" : "Zukünftige Woche"}
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
          <button
            onClick={handlePublish}
            disabled={publishing || draftCount === 0}
            className={`px-5 py-2.5 rounded-xl font-display font-extrabold uppercase tracking-wide text-[13px] transition-colors ${
              draftCount > 0
                ? "bg-copper-bright text-bg-deep hover:brightness-110"
                : "bg-white/10 text-steel cursor-not-allowed"
            } disabled:opacity-60`}
            title={draftCount === 0 ? "Alles bereits an Mitarbeiter übertragen" : "Pläne dieser Woche an die Mitarbeiter übertragen"}
          >
            {publishing ? "Überträgt …" : draftCount > 0 ? `📤 Übertragen · ${draftCount}` : "✓ Aktuell"}
          </button>
        </div>

        {publishMsg && (
          <div className="mt-3 px-4 py-2.5 bg-good/20 border border-good/50 rounded-lg text-[13px] text-moss-bright">
            {publishMsg}
          </div>
        )}

        <p className="font-sans text-[13px] text-steel mt-4 leading-snug max-w-4xl">
          Mitarbeiter aus dem Pool unten in eine Baustelle ziehen. Änderungen sind <strong className="text-copper-bright">Entwurf</strong>, bis du auf <strong className="text-copper-bright">„Übertragen"</strong> klickst, erst dann sehen die Mitarbeiter-Handys den Plan.
        </p>

        {/* MITARBEITER-POOL */}
        <div className="flex items-center gap-4 mt-4 pb-1 overflow-x-auto board-scroll">
          <span className="dd-eyebrow text-copper-bright tracking-widest flex-shrink-0">MITARBEITER</span>
          <div className="flex gap-2 flex-nowrap">
            {team.map((w) => (
              <PoolPill
                key={w.id}
                worker={w}
                onDragStart={() => setDraggedWorker({ workerId: w.id, from: "pool" })}
                onDragEnd={() => { setDraggedWorker(null); setDropTarget(null); }}
              />
            ))}
            {team.length === 0 && !loading && (
              <span className="font-sans text-steel text-[11px] italic">keine Mitarbeiter</span>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-8 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
          {error}
        </div>
      )}

      {/* TAGE — Heavy-Duty Stencil Layout, 5 Spalten Mo-Fr */}
      <main className="px-6 lg:px-12 xl:px-16 py-8">
        {loading ? (
          <div className="text-center py-16 h-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : team.length === 0 ? (
          <div className="text-center py-16 h-mono text-ink-2 text-[12px]">
            Keine Mitarbeiter vorhanden
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {days.map((iso) => {
              const isToday = iso === today;
              const dt = new Date(iso);
              const siteIds = siteIdsForDay(iso);
              const holiday = getHoliday(iso);
              const dayAbsences = team
                .map((w) => ({ worker: w, absence: absenceForDay(w.id, iso) }))
                .filter((a) => a.absence);
              const totalAssigned = assignments.filter((a) => a.date === iso).length;

              return (
                <section
                  key={iso}
                  className={`flex flex-col overflow-hidden ${
                    isToday ? "rounded-xl border-2 border-copper bg-copper/5" : "dd-card"
                  }`}
                  style={isToday ? undefined : { ["--c" as any]: "#8B9197" }}
                >
                  {/* DAY-HEADER */}
                  <header className="px-4 pt-4 pb-3 flex items-start justify-between gap-2 border-b border-ink/10">
                    <div className="min-w-0 flex-1">
                      <div className="h-mono text-copper text-[11px]">
                        {String(dt.getDate()).padStart(2, "0")}.{String(dt.getMonth() + 1).padStart(2, "0")}.
                        {isToday && " · HEUTE"}
                      </div>
                      <div className={`h-display text-2xl leading-none mt-1.5 ${isToday ? "text-copper" : ""}`}>
                        {DAY_LONG[dt.getDay()]}
                      </div>
                      {totalAssigned > 0 && (
                        <div className="h-mono text-ink-2 text-[10px] mt-1.5">
                          {totalAssigned} {totalAssigned === 1 ? "Zuweisung" : "Zuweisungen"}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setPicker({ date: iso })}
                      className="flex-shrink-0 w-8 h-8 rounded-full bg-copper text-bg-deep hover:bg-copper-bright flex items-center justify-center text-base font-bold transition-colors"
                      title="Baustelle hinzufügen"
                    >＋</button>
                  </header>

                  {/* Holiday-Banner */}
                  {holiday && (
                    <div className="px-4 py-2 bg-bronze/10 border-b border-bronze/30 text-center">
                      <span className="h-mono text-bronze text-[10px] tracking-widest">🎉 {holiday.name}</span>
                    </div>
                  )}

                  {/* ABWESEND-Liste */}
                  {dayAbsences.length > 0 && (
                    <div className="px-4 py-3 bg-bg-3/40 border-b border-ink/10">
                      <div className="h-mono text-ink-2 text-[10px] tracking-widest mb-2">Abwesend</div>
                      <div className="flex flex-wrap gap-1.5">
                        {dayAbsences.map(({ worker, absence }) => {
                          const meta = ABSENCE_META[absence!.type as keyof typeof ABSENCE_META];
                          return (
                            <div
                              key={worker.id}
                              className={`flex items-center gap-1.5 pl-1 pr-2 py-0.5 border rounded-full ${meta.bg} ${meta.border}`}
                              title={`${worker.firstName} ${worker.lastName} · ${meta.label}`}
                            >
                              <span className="w-5 h-5 rounded-full bg-bg-deep text-copper-bright font-display font-extrabold text-[9px] flex items-center justify-center">
                                {worker.initials}
                              </span>
                              <span className="text-[11px] font-semibold whitespace-nowrap">{worker.firstName}</span>
                              <span className="text-sm leading-none">{meta.emoji}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* SITE-CARDS */}
                  <div className="flex-1 p-3 space-y-2.5 min-h-[200px]">
                    {siteIds.length === 0 && dayAbsences.length === 0 && (
                      <button
                        onClick={() => setPicker({ date: iso })}
                        className="w-full h-full min-h-[180px] rounded-lg border-2 border-dashed border-ink/15 hover:border-copper hover:bg-copper/5 hover:text-copper text-ink-mute h-mono text-[11px] tracking-widest transition-colors flex flex-col items-center justify-center gap-2"
                      >
                        <span className="text-3xl">＋</span>
                        <span>Baustelle</span>
                      </button>
                    )}

                    {siteIds.map((siteId) => {
                      const site = getSite(siteId);
                      if (!site) return null;
                      const onSite = workersOnSite(iso, siteId);
                      const isDropping = dropTarget?.date === iso && dropTarget.siteId === siteId;
                      return (
                        <SiteCard
                          key={siteId}
                          site={site}
                          assignments={onSite}
                          getWorker={getWorker}
                          isDropping={isDropping}
                          onDragOver={() => setDropTarget({ date: iso, siteId })}
                          onDragLeave={() => {
                            setDropTarget((prev) =>
                              prev?.date === iso && prev.siteId === siteId ? null : prev
                            );
                          }}
                          onDrop={() => handleDrop(iso, siteId)}
                          onPillDragStart={(workerId) =>
                            setDraggedWorker({ workerId, from: { date: iso, siteId } })
                          }
                          onPillDragEnd={() => { setDraggedWorker(null); setDropTarget(null); }}
                          onRemoveWorker={(workerId) => handleRemoveWorker(iso, workerId)}
                          onRemoveSite={() => handleRemoveSite(iso, siteId)}
                        />
                      );
                    })}

                    {siteIds.length > 0 && (
                      <button
                        onClick={() => setPicker({ date: iso })}
                        className="w-full rounded-lg border border-dashed border-ink/15 hover:border-copper hover:text-copper text-ink-mute h-mono text-[11px] tracking-widest py-2.5 transition-colors"
                      >
                        ＋ Baustelle
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {/* SITE-PICKER-DIALOG */}
      {picker && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { setPicker(null); setPickerSearch(""); }}
        >
          <div
            className="bg-bg-DEFAULT rounded-2xl border-2 border-ink/30 shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 border-b border-ink/15">
              <div className="flex items-center justify-between">
                <h3 className="h-display text-2xl">Welche Baustelle?</h3>
                <button
                  onClick={() => { setPicker(null); setPickerSearch(""); }}
                  className="w-8 h-8 rounded-lg text-ink-body hover:bg-bg-3 hover:text-paper flex items-center justify-center text-2xl leading-none"
                >
                  ×
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Suchen: Name, Straße, Ort …"
                className="w-full mt-3 px-3.5 py-2.5 bg-bg-2 border-2 border-ink/20 rounded-lg text-sm text-paper placeholder:text-ink-2 focus:outline-none focus:border-copper"
              />
            </div>
            <ul className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
              {filteredSites.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => handleAddSite(picker.date, s.id)}
                    className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg bg-bg-2 border border-ink/15 hover:bg-copper/10 hover:border-copper transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      {s.projectNumber && (
                        <div className="h-mono text-copper text-[10px]">Auftrag {s.projectNumber}</div>
                      )}
                      <div className="font-bold text-[15px] text-paper truncate">{s.name}</div>
                      <div className="h-mono text-ink-body text-[11px] mt-0.5 truncate">
                        {s.street}{s.city ? ` · ${s.city}` : ""}
                      </div>
                    </div>
                    {s.starred && <span className="text-copper text-lg">★</span>}
                  </button>
                </li>
              ))}
              {filteredSites.length === 0 && (
                <li className="text-center text-ink-2 text-[13px] italic py-6">
                  Keine Baustelle gefunden
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

const ABSENCE_META = {
  sick:     { emoji: "🏥", label: "Krank",    bg: "bg-rust/10",   border: "border-rust/40",    dark: "rgba(185,28,28,0.25)",  darkBorder: "rgba(185,28,28,0.6)" },
  vacation: { emoji: "🏖", label: "Urlaub",   bg: "bg-moss/10",   border: "border-moss-bright/40", dark: "rgba(21,128,61,0.25)",  darkBorder: "rgba(21,128,61,0.6)" },
  holiday:  { emoji: "🎉", label: "Feiertag", bg: "bg-bronze/10", border: "border-bronze/40",  dark: "rgba(180,135,75,0.25)", darkBorder: "rgba(180,135,75,0.6)" }
} as const;

function PoolPill({
  worker, onDragStart, onDragEnd
}: {
  worker: Worker;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copyMove";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="flex items-center gap-2 pl-1 pr-3 py-1 bg-white/10 border border-white/15 rounded-full cursor-grab active:cursor-grabbing select-none flex-shrink-0 hover:bg-white/15 transition-colors"
    >
      <span className="w-7 h-7 rounded-full bg-bg-deep text-copper-bright font-display font-extrabold text-[11px] flex items-center justify-center ring-1 ring-white/15">
        {worker.initials}
      </span>
      <span className="text-[13px] font-semibold whitespace-nowrap text-white">{worker.firstName}</span>
      <span className="font-mono text-steel text-[9px] whitespace-nowrap">
        {worker.role.split(" · ")[0]}
      </span>
    </div>
  );
}

function SiteCard({
  site, assignments, getWorker, isDropping,
  onDragOver, onDragLeave, onDrop,
  onPillDragStart, onPillDragEnd,
  onRemoveWorker, onRemoveSite
}: {
  site: Site;
  assignments: Assignment[];
  getWorker: (id: string) => Worker | undefined;
  isDropping: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onPillDragStart: (workerId: string) => void;
  onPillDragEnd: () => void;
  onRemoveWorker: (workerId: string) => void;
  onRemoveSite: () => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`relative bg-bg-DEFAULT border-l-[3px] border-y border-r rounded-lg flex flex-col transition-colors ${
        isDropping
          ? "border-l-copper-bright border-y-copper border-r-copper bg-copper/10"
          : "border-l-copper border-y-ink/10 border-r-ink/10"
      }`}
    >
      <div className="px-3 pt-2.5 pb-2 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {site.projectNumber && (
            <div className="h-mono text-copper text-[10px] tracking-widest leading-none">
              Auftrag {site.projectNumber}
            </div>
          )}
          <div className="font-display font-extrabold text-[16px] uppercase tracking-tight leading-tight mt-1 break-words">
            {site.name}
          </div>
          <div className="h-mono text-ink-2 text-[10px] mt-0.5 truncate">
            {site.city || site.street}
          </div>
        </div>
        <button
          onClick={onRemoveSite}
          className="w-6 h-6 rounded text-ink-mute hover:text-rust hover:bg-rust/10 flex items-center justify-center text-base leading-none flex-shrink-0"
          title="Baustelle entfernen"
        >×</button>
      </div>

      <div className="px-2 pb-2 flex flex-wrap gap-1 flex-1 content-start min-h-[36px]">
        {assignments.length === 0 && (
          <span className="self-center w-full text-center h-mono text-ink-mute text-[10px] tracking-widest py-2 italic">
            Mitarbeiter hier rein ziehen
          </span>
        )}
        {assignments.map((a) => {
          const worker = getWorker(a.workerId);
          if (!worker) return null;
          return (
            <div
              key={a.workerId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "copyMove";
                onPillDragStart(a.workerId);
              }}
              onDragEnd={onPillDragEnd}
              className={`group flex items-center gap-1 pl-0.5 pr-1 py-0.5 bg-bg-2 border rounded-full cursor-grab active:cursor-grabbing select-none ${
                a.publishedAt ? "border-copper" : "border-dashed border-copper/60"
              }`}
              title={`${worker.firstName} ${worker.lastName}${a.publishedAt ? " · übertragen" : " · Entwurf"}`}
            >
              <span className="w-5 h-5 rounded-full bg-bg-deep text-copper-bright font-display font-extrabold text-[9px] flex items-center justify-center flex-shrink-0">
                {worker.initials}
              </span>
              <span className="text-[11px] font-semibold whitespace-nowrap pr-1">{worker.firstName}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveWorker(a.workerId); }}
                className="w-4 h-4 rounded-full text-ink-2 hover:bg-rust hover:text-white flex items-center justify-center text-[11px] leading-none opacity-60 group-hover:opacity-100 transition-opacity"
                title="Entfernen"
              >×</button>
            </div>
          );
        })}
      </div>

      {/* Draft-Indikator: kleines Dreieck oben rechts */}
      {assignments.some((a) => !a.publishedAt) && (
        <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-copper rounded-bl" title="Enthält Entwurf" />
      )}
    </div>
  );
}
