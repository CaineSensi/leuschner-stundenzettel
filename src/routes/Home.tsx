import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { submitWeek } from "../lib/api";
import { getHoliday, isHoliday } from "../lib/holidays";
import { useLiveData } from "../lib/live";
import {
  dayName, fmtDateLong, fmtHours, fmtTime, isEntryActiveOn, isoWeek, shortDate, todayIso,
  weekDays, workMinutes
} from "../lib/utils";
import type { Assignment, Entry, Site } from "../lib/types";
import { DISCIPLINE_LABEL, isWorkEntry } from "../lib/types";
import { currentUser } from "../lib/auth";
import {
  enableNotifications, notificationsEnabled, notificationsSupported, notify
} from "../lib/notifications";

export default function Home() {
  const navigate = useNavigate();
  const today = todayIso();
  const { year, week } = isoWeek(new Date());
  const days = weekDays(year, week).slice(0, 5); // Mo–Fr
  const me = currentUser();

  useEffect(() => {
    if (!me) navigate("/onboarding", { replace: true });
  }, [me, navigate]);
  if (!me) return null;

  // ── Daten aus dem zentralen LiveDataContext (kein eigener Fetch mehr) ──
  const { entries, assignments, sites: allSites, isLoaded, refresh } = useLiveData();

  // Nur Einträge dieser Woche anzeigen
  const myEntries = entries.filter((e) => days.some((d) => isEntryActiveOn(e, d)));
  const weekAssignments = assignments.filter((a) => days.includes(a.date));

  const todayAssignment = weekAssignments.find((a) => a.date === today) ?? null;
  const assignmentSite = todayAssignment
    ? allSites.find((s) => s.id === todayAssignment.siteId) ?? null
    : null;

  const totalMin = myEntries.reduce((s, e) => s + workMinutes(e), 0);
  const holidayDays = days.filter((d) => isHoliday(d)).length;
  const sollMin = (40 - holidayDays * 8) * 60;

  const [notifReady, setNotifReady] = useState(notificationsEnabled());
  const todayInWeek = days.includes(today);
  const hasToday = myEntries.some((e) => isEntryActiveOn(e, today));

  useEffect(() => {
    if (!notifReady || !todayInWeek || hasToday) return;
    const t = setTimeout(() => {
      notify("Heute noch nichts erfasst", "Plus-Knopf öffnen, dauert keine zwei Minuten.");
    }, 1500);
    return () => clearTimeout(t);
  }, [notifReady, todayInWeek, hasToday]);

  async function handleEnableNotif() {
    const ok = await enableNotifications();
    setNotifReady(ok);
    if (ok) notify("Erinnerungen aktiv", "Wir melden uns, wenn ein Tag offen bleibt.");
  }

  const [refreshing, setRefreshing] = useState(false);
  function handleRefresh() {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 800);
  }

  const [submitting, setSubmitting] = useState(false);
  async function handleSubmitWeek() {
    if (!me || submitting) return;
    setSubmitting(true);
    try {
      await submitWeek(me.id, days[0], days[days.length - 1]);
      refresh();
    } catch (err) {
      console.error("[home] submitWeek failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  // Feiertage zählen NICHT als offen — aber erst zeigen wenn Daten geladen sind
  const offen = isLoaded
    ? days.filter((iso) =>
        iso <= today && !myEntries.some((e) => isEntryActiveOn(e, iso)) && !isHoliday(iso)
      )
    : [];

  const isWeekSubmitted = myEntries.length > 0 && myEntries.some((e) => e.submittedAt != null);

  return (
    <main className="on-dark min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
      <header className="surface-steel px-6 safe-top pt-3 pb-5">
        <div className="flex items-center justify-between">
          <span className="h-mono text-copper">Moin, {me.firstName} ·</span>
          <div className="flex items-center gap-3">
            {me.isAdmin && (
              <Link to="/admin" className="h-mono text-copper text-[12px]">
                ← Admin
              </Link>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-copper text-bg-deep font-mono font-bold text-[11px] uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-60"
              aria-label="Aktualisieren"
            >
              <span className={`text-base leading-none ${refreshing ? "animate-spin" : ""}`}>↻</span>
              <span>{refreshing ? "Lädt …" : "Aktualisieren"}</span>
            </button>
          </div>
        </div>
        <div className="flex items-baseline justify-between mt-1 gap-3">
          <h1 className="h-display text-3xl text-white">KW {week}</h1>
          <span className="h-mono text-white/55 text-[12px]">
            {shortDate(days[0])} bis {shortDate(days[days.length - 1])} {year}
          </span>
        </div>
        {todayInWeek && (
          <p className="h-mono text-copper text-[12px] mt-1.5">
            Heute · {fmtDateLong(today)}
          </p>
        )}
      </header>

      <section className="px-6 grid grid-cols-2 gap-2.5">
        <Stat label="Diese Woche" value={`${fmtHours(totalMin)} h`} sub={`${fmtHours(totalMin - sollMin)} h zu Soll`} positive={totalMin >= sollMin} />
        <Stat label="Tagessoll" value="8,0 h" sub="40 h / Woche" />
      </section>

      {notificationsSupported() && !notifReady && (
        <button
          onClick={handleEnableNotif}
          className="dd-card mx-6 mt-4 px-4 py-3 flex items-center gap-3 text-left" style={{ ["--c" as any]: "#DC6E2D" }}
        >
          <span className="text-2xl">🔔</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Erinnerung aktivieren</div>
            <div className="h-mono text-ink-2 text-[11px] mt-0.5">Wir melden uns abends, wenn ein Tag noch offen ist.</div>
          </div>
          <span className="text-copper text-xl">→</span>
        </button>
      )}

      {todayAssignment && !hasToday && todayInWeek && (
        <button
          onClick={() => navigate("/entry", { state: { assignment: todayAssignment } })}
          className="mx-6 mt-4 px-4 py-4 rounded-xl bg-gradient-to-br from-copper/25 to-copper/8 border border-copper text-left active:scale-[0.99] transition-transform"
        >
          <div className="h-mono text-copper text-[11px]">Heute · vom Büro geplant</div>
          {assignmentSite?.projectNumber && (
            <div className="h-mono text-ink-2 text-[11px] mt-0.5">Auftrag {assignmentSite.projectNumber}</div>
          )}
          <div className="font-display text-xl mt-1 leading-tight">
            {assignmentSite?.name ?? "Baustelle"}
          </div>
          <div className="h-mono text-ink-2 text-[11px] mt-0.5">
            {DISCIPLINE_LABEL[todayAssignment.discipline]}
            {assignmentSite?.street ? ` · ${assignmentSite.street}` : ""}
            {assignmentSite?.city ? `, ${assignmentSite.city}` : ""}
          </div>
          {todayAssignment.note && (
            <div className="text-[12px] text-ink-body mt-2 italic leading-snug">
              „{todayAssignment.note}"
            </div>
          )}
          <div className="mt-3 h-mono text-copper text-[12px] flex items-center justify-between">
            <span>Stunden eintragen</span>
            <span className="text-base">→</span>
          </div>
        </button>
      )}

      {!todayAssignment && !hasToday && todayInWeek && (
        <div className="dd-card mx-6 mt-4 px-4 py-4" style={{ ["--c" as any]: "#A9AEB3" }}>
          <div className="h-mono text-ink-2 text-[11px]">Heute · {fmtDateLong(today)}</div>
          <div className="font-semibold text-[14px] mt-1">Keine Baustelle vorgegeben</div>
          <div className="text-[12px] text-ink-body mt-1 leading-snug">
            Frag im Büro, sobald die Zuweisung da ist, taucht sie hier auf.
          </div>
        </div>
      )}

      {offen.length > 0 && (
        <Link
          to={`/entry?date=${offen[0]}`}
          className="mx-6 mt-3 px-4 py-3 bg-rust/15 border border-rust/40 rounded-xl flex items-center gap-3"
        >
          <span className="text-2xl">⚠</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{offen.length} {offen.length === 1 ? "Tag" : "Tage"} offen</div>
            <div className="h-mono text-ink-2 text-[11px] mt-0.5">
              {offen.map((iso) => `${dayName(iso)} ${shortDate(iso)}`).join(" · ")}
            </div>
          </div>
          <span className="text-rust text-xl">→</span>
        </Link>
      )}

      <section className="flex-1 px-6 mt-6 overflow-y-auto pb-28">
        <div className="flex items-baseline justify-between mb-3">
          <span className="h-mono text-copper">Tage</span>
          <span className="h-mono text-ink-mute text-[12px]">
            {myEntries.length} von {days.length} erfasst
          </span>
        </div>
        <ul className="space-y-2.5">
          {days.map((iso) => {
            const entry = myEntries.find((e) => isEntryActiveOn(e, iso));
            const holiday = getHoliday(iso);
            const assignment = weekAssignments.find((a) => a.date === iso);
            const assignSite = assignment ? allSites.find((s) => s.id === assignment.siteId) ?? null : null;
            return (
              <li key={iso}>
                {entry
                  ? <DayRow date={iso} entry={entry} sites={allSites} />
                  : holiday
                  ? <HolidayRow date={iso} name={holiday.name} />
                  : <EmptyRow date={iso} assignment={assignment} site={assignSite} />}
              </li>
            );
          })}
        </ul>
      </section>

      {offen.length === 0 && myEntries.length > 0 && !isWeekSubmitted && (
        <div className="px-6 pb-4 pt-2">
          <button
            onClick={handleSubmitWeek}
            disabled={submitting}
            className="w-full py-4 rounded-xl font-display font-black uppercase tracking-wide text-base text-white flex items-center justify-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{ background: "linear-gradient(180deg, #1F7A3D, #155F2E)", boxShadow: "0 8px 20px -8px rgba(31,122,61,.65), inset 0 1px 0 rgba(255,255,255,.2)" }}
          >
            <span className="text-xl leading-none">{submitting ? "⏳" : "✓"}</span>
            <span>{submitting ? "Wird gesendet …" : "Woche an Rick senden"}</span>
          </button>
          <p className="text-center h-mono text-ink-mute text-[11px] mt-2">
            Alle Tage erfasst · Woche KW {week} einreichen
          </p>
        </div>
      )}

      {isWeekSubmitted && (
        <div className="mx-6 mb-4 px-4 py-3 rounded-xl bg-good/15 border border-good/40 flex items-center gap-3">
          <span className="text-xl">✓</span>
          <div>
            <div className="font-semibold text-[13px]" style={{ color: "#1F7A3D" }}>Woche eingereicht</div>
            <div className="h-mono text-[11px] mt-0.5" style={{ color: "#1F7A3D" }}>KW {week} wurde an Rick übermittelt</div>
          </div>
        </div>
      )}

      {!isWeekSubmitted && (
        <Link
          to="/entry"
          className="fixed bottom-7 right-6 lg:right-[calc(50%-208px)] w-14 h-14 rounded-full bg-copper text-bg-deep font-display font-extrabold text-3xl flex items-center justify-center shadow-xl active:scale-95 transition-transform"
          aria-label="Eintrag hinzufügen"
        >
          +
        </Link>
      )}
    </main>
  );
}

function Stat({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="dd-card px-4 py-3" style={{ ["--c" as any]: positive ? "#1F7A3D" : "#DC6E2D" }}>
      <div className="h-mono text-copper text-[11px]">{label}</div>
      <div className="h-display text-2xl mt-0.5 text-ink tabular-nums">{value}</div>
      {sub && (
        <div className={`text-[12px] mt-0.5 ${positive ? "text-good" : "text-ink-2"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function DayRow({ date, entry, sites }: { date: string; entry: Entry; sites: Site[] }) {
  const isToday = date === todayIso();
  if (isWorkEntry(entry)) {
    const site = sites.find((s) => s.id === entry.siteId);
    const min = workMinutes(entry);
    return (
      <Link
        to={`/day/${date}`}
        className={`px-4 py-3.5 grid grid-cols-[44px_1fr_auto] gap-3 items-center transition-transform active:scale-[0.99] ${
          isToday ? "rounded-xl bg-copper/15 border-2 border-copper/50" : "dd-card"
        }`}
        style={isToday ? undefined : { ["--c" as any]: "#DC6E2D" }}
      >
        <div className="text-center">
          <div className={`font-mono font-bold text-[12px] tracking-wider ${isToday ? "text-copper" : ""}`}>
            {dayName(date).toUpperCase()}
          </div>
          {isToday
            ? <div className="font-mono text-[10px] text-copper mt-0.5">HEUTE</div>
            : <div className="font-mono text-[11px] text-ink-2 mt-0.5">{shortDate(date)}</div>}
        </div>
        <div className="min-w-0">
          {site?.projectNumber && (
            <div className="h-mono text-copper text-[10px] truncate">Auftrag {site.projectNumber}</div>
          )}
          <div className="font-display font-extrabold text-base uppercase tracking-tight leading-tight truncate">
            {site?.name ?? "Baustelle (gelöscht)"}
          </div>
          <div className="h-mono text-ink-2 text-[11px] mt-0.5">
            {entry.discipline} · {fmtTime(entry.startMin)} bis {fmtTime(entry.endMin)}
          </div>
        </div>
        <div className="text-right">
          <div className="h-display text-2xl leading-none">{fmtHours(min)}</div>
          <div className="h-mono text-ink-mute text-[10px] mt-0.5">h</div>
        </div>
      </Link>
    );
  }

  const meta = ABSENCE_META[entry.type];
  return (
    <Link
      to={`/day/${date}`}
      className={`rounded-xl px-4 py-3.5 grid grid-cols-[44px_1fr_auto] gap-3 items-center active:scale-[0.99] transition-transform ${meta.bg}`}
    >
      <div className="text-center">
        <div className="font-mono font-bold text-[12px] tracking-wider">{dayName(date).toUpperCase()}</div>
        <div className="font-mono text-[11px] text-ink-2 mt-0.5">{shortDate(date)}</div>
      </div>
      <div className="min-w-0">
        <div className="font-display font-extrabold text-base uppercase tracking-tight leading-tight flex items-center gap-2">
          <span>{meta.emoji}</span>
          <span>{meta.label}</span>
        </div>
        <div className="h-mono text-ink-2 text-[11px] mt-0.5">
          {entry.endDate && entry.endDate !== entry.date
            ? `bis ${shortDate(entry.endDate)}`
            : "ganzer Tag"}
        </div>
      </div>
      <div className={`h-mono text-[11px] px-2.5 py-1 rounded-md font-bold ${meta.badge}`}>
        {meta.code}
      </div>
    </Link>
  );
}

function EmptyRow({ date, assignment, site }: { date: string; assignment?: Assignment; site?: Site | null }) {
  const navigate = useNavigate();
  const isToday = date === todayIso();
  const isFuture = date > todayIso();
  const hasPlan = !!assignment;

  const content = (
    <>
      <div className="text-center">
        <div className={`font-mono font-bold text-[12px] tracking-wider ${isToday ? "text-copper" : ""}`}>
          {dayName(date).toUpperCase()}
        </div>
        {isToday
          ? <div className="font-mono text-[10px] text-copper mt-0.5">HEUTE</div>
          : <div className="font-mono text-[11px] mt-0.5">{shortDate(date)}</div>}
      </div>
      <div className="min-w-0 text-left">
        {hasPlan ? (
          <>
            {site?.projectNumber && (
              <div className="h-mono text-copper text-[10px] truncate">Auftrag {site.projectNumber}</div>
            )}
            <div className="font-display font-extrabold text-base uppercase tracking-tight leading-tight truncate">
              {site?.name ?? "Baustelle"}
            </div>
            <div className="h-mono text-[11px] mt-0.5">
              {assignment!.discipline} · {isFuture ? "geplant" : "+ Stunden eintragen"}
            </div>
          </>
        ) : (
          <>
            <div className="font-display font-extrabold text-base uppercase tracking-tight leading-tight">
              {isFuture ? "geplant" : "Eintrag fehlt"}
            </div>
            <div className="h-mono text-[11px] mt-0.5">
              {isFuture ? "noch in der Zukunft" : "+ nachtragen"}
            </div>
          </>
        )}
      </div>
      <div className="h-display text-2xl text-ink-mute">{hasPlan ? "→" : "·"}</div>
    </>
  );

  if (isFuture) {
    return (
      <div className="rounded-xl px-4 py-3.5 grid grid-cols-[44px_1fr_auto] gap-3 items-center bg-transparent border border-dashed border-ink/10 text-ink-mute">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate(`/entry?date=${date}`)}
      className={`w-full rounded-xl px-4 py-3.5 grid grid-cols-[44px_1fr_auto] gap-3 items-center active:bg-bg-3 transition-colors ${
        isToday && hasPlan
          ? "bg-gradient-to-br from-copper/25 to-copper/8 border-2 border-copper text-paper"
          : isToday
          ? "bg-copper/10 border-2 border-copper/50 text-paper"
          : hasPlan
          ? "bg-bg-2 border border-copper/40 text-paper"
          : "bg-transparent border border-dashed border-ink/20 text-ink-body"
      }`}
    >
      {content}
    </button>
  );
}

function HolidayRow({ date, name }: { date: string; name: string }) {
  const isToday = date === todayIso();
  return (
    <div
      className={`rounded-xl px-4 py-3.5 grid grid-cols-[44px_1fr_auto] gap-3 items-center bg-bronze/15 border ${isToday ? "border-bronze" : "border-bronze/40"}`}
    >
      <div className="text-center">
        <div className="font-mono font-bold text-[12px] tracking-wider">{dayName(date).toUpperCase()}</div>
        <div className="font-mono text-[11px] text-ink-2 mt-0.5">{shortDate(date)}</div>
      </div>
      <div className="min-w-0">
        <div className="font-display font-extrabold text-base uppercase tracking-tight leading-tight flex items-center gap-2">
          <span>🎉</span><span>{name}</span>
        </div>
        <div className="h-mono text-ink-2 text-[11px] mt-0.5">Gesetzlicher Feiertag · automatisch frei</div>
      </div>
      <div className="h-mono text-[11px] px-2.5 py-1 rounded-md font-bold bg-bronze/30 text-bronze">FREI</div>
    </div>
  );
}

const ABSENCE_META = {
  sick:     { emoji: "🏥", label: "Krankheit",  code: "KRANK",  bg: "bg-rust/12 border border-rust/30",     badge: "bg-rust/30 text-rust" },
  vacation: { emoji: "🏖", label: "Urlaub",     code: "URLAUB", bg: "bg-moss/15 border border-moss-bright/30", badge: "bg-moss/30 text-moss-bright" },
  holiday:  { emoji: "🎉", label: "Feiertag",   code: "FREI",   bg: "bg-bg-3 border border-ink/10",       badge: "bg-bg-4 text-ink-body" }
} as const;
