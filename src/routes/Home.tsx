import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CURRENT_WORKER } from "../lib/mockData";
import { listEntries } from "../lib/api";
import {
  dayName, fmtDateLong, fmtHours, fmtTime, isoWeek, shortDate, siteById, todayIso,
  weekDays, workMinutes
} from "../lib/utils";
import type { Entry } from "../lib/types";
import { isWorkEntry } from "../lib/types";
import { logout, currentUser } from "../lib/auth";
import {
  enableNotifications, notificationsEnabled, notificationsSupported, notify
} from "../lib/notifications";

export default function Home() {
  const navigate = useNavigate();
  const today = todayIso();
  const { year, week } = isoWeek(new Date());
  const days = weekDays(year, week);
  const me = currentUser() ?? CURRENT_WORKER;

  const [myEntries, setMyEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await listEntries(me.id, days[0], days[days.length - 1]);
      if (!cancelled) setMyEntries(entries);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  const totalMin = myEntries.reduce((s, e) => s + workMinutes(e), 0);
  const sollMin = 40 * 60;

  const [notifReady, setNotifReady] = useState(notificationsEnabled());
  const todayInWeek = days.includes(today);
  const hasToday = myEntries.some((e) => e.date === today);

  // Reminder: nach 1.5s automatisch Hinweis senden, wenn aktiviert
  useEffect(() => {
    if (!notifReady || !todayInWeek || hasToday) return;
    const t = setTimeout(() => {
      notify(
        "Heute noch nichts erfasst",
        "Plus-Knopf öffnen — dauert keine zwei Minuten."
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [notifReady, todayInWeek, hasToday]);

  async function handleEnableNotif() {
    const ok = await enableNotifications();
    setNotifReady(ok);
    if (ok) notify("Erinnerungen aktiv", "Wir melden uns, wenn ein Tag offen bleibt.");
  }

  function handleLogout() {
    if (confirm("Wirklich abmelden?")) {
      logout();
      navigate("/login", { replace: true });
    }
  }

  const offen = days.filter((iso) => iso <= today && !myEntries.some((e) => e.date === iso));

  return (
    <main className="min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
      <header className="px-6 safe-top pt-3 pb-4">
        <div className="flex items-center justify-between">
          <span className="h-mono text-copper">— Moin, {me.firstName} ·</span>
          <div className="flex items-center gap-3">
            {me.isAdmin && (
              <Link to="/admin" className="h-mono text-copper text-[12px]">
                ← Admin
              </Link>
            )}
            <button onClick={handleLogout} className="h-mono text-paper/40 text-[12px]">
              Abmelden
            </button>
          </div>
        </div>
        <div className="flex items-baseline justify-between mt-1 gap-3">
          <h1 className="h-display text-3xl">KW {week}</h1>
          <span className="h-mono text-paper/55 text-[12px]">
            {shortDate(days[0])} – {shortDate(days[days.length - 1])} {year}
          </span>
        </div>
        {todayInWeek && (
          <p className="h-mono text-copper text-[12px] mt-1.5">
            — Heute · {fmtDateLong(today)}
          </p>
        )}
      </header>

      <section className="px-6 grid grid-cols-2 gap-2.5">
        <Stat label="Diese Woche" value={`${fmtHours(totalMin)} h`} sub={`${fmtHours(totalMin - sollMin)} h zu Soll`} positive={totalMin >= sollMin} />
        <Stat label="Tagessoll" value="8,0 h" sub="40 h / Woche" />
      </section>

      {/* Notification opt-in */}
      {notificationsSupported() && !notifReady && (
        <button
          onClick={handleEnableNotif}
          className="mx-6 mt-4 px-4 py-3 bg-bg-2 border border-copper/40 rounded-xl flex items-center gap-3 text-left"
        >
          <span className="text-2xl">🔔</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Erinnerung aktivieren</div>
            <div className="h-mono text-paper/55 text-[11px] mt-0.5">Wir melden uns abends, wenn ein Tag noch offen ist.</div>
          </div>
          <span className="text-copper text-xl">→</span>
        </button>
      )}

      {/* Offene Tage Banner */}
      {offen.length > 0 && (
        <Link
          to="/entry"
          className="mx-6 mt-3 px-4 py-3 bg-rust/15 border border-rust/40 rounded-xl flex items-center gap-3"
        >
          <span className="text-2xl">⚠</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{offen.length} {offen.length === 1 ? "Tag" : "Tage"} offen</div>
            <div className="h-mono text-paper/55 text-[11px] mt-0.5">
              {offen.map((iso) => `${dayName(iso)} ${shortDate(iso)}`).join(" · ")}
            </div>
          </div>
          <span className="text-rust text-xl">→</span>
        </Link>
      )}

      <section className="flex-1 px-6 mt-6 overflow-y-auto pb-28">
        <div className="flex items-baseline justify-between mb-3">
          <span className="h-mono text-copper">— Tage</span>
          <span className="h-mono text-paper/45 text-[12px]">
            {myEntries.length} von {days.length} erfasst
          </span>
        </div>
        <ul className="space-y-2">
          {days.map((iso) => {
            const entry = myEntries.find((e) => e.date === iso);
            return (
              <li key={iso}>
                {entry ? <DayRow date={iso} entry={entry} /> : <EmptyRow date={iso} />}
              </li>
            );
          })}
        </ul>
      </section>

      <Link
        to="/entry"
        className="fixed bottom-7 right-6 lg:right-[calc(50%-208px)] w-14 h-14 rounded-full bg-copper text-bg-deep font-display font-extrabold text-3xl flex items-center justify-center shadow-xl active:scale-95 transition-transform"
        aria-label="Eintrag hinzufügen"
      >
        +
      </Link>
    </main>
  );
}

function Stat({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="bg-bg-2 rounded-xl px-4 py-3">
      <div className="h-mono text-copper text-[11px]">{label}</div>
      <div className="h-display text-2xl mt-0.5">{value}</div>
      {sub && (
        <div className={`text-[12px] mt-0.5 ${positive ? "text-good" : "text-paper/50"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function DayRow({ date, entry }: { date: string; entry: Entry }) {
  const isToday = date === todayIso();
  if (isWorkEntry(entry)) {
    const site = siteById(entry.siteId);
    const min = workMinutes(entry);
    return (
      <Link
        to={`/day/${date}`}
        className={`rounded-xl px-4 py-3 grid grid-cols-[36px_1fr_auto] gap-3 items-center active:bg-bg-3 transition-colors ${
          isToday ? "bg-copper/15 border border-copper/40" : "bg-bg-2"
        }`}
      >
        <div className="text-center">
          <div className={`font-mono font-bold text-[11px] tracking-wider ${isToday ? "text-copper" : ""}`}>
            {dayName(date).toUpperCase()}
            {isToday && <span className="block text-[11px] text-copper mt-0.5">HEUTE</span>}
          </div>
          {!isToday && <div className="font-mono text-[11px] text-paper/40 mt-0.5">{shortDate(date)}</div>}
        </div>
        <div>
          <div className="font-semibold text-sm leading-tight">{site?.name ?? "—"}</div>
          <div className="h-mono text-copper text-[11px] mt-0.5">
            {entry.discipline} · {fmtTime(entry.startMin)}–{fmtTime(entry.endMin)}
          </div>
        </div>
        <div className="h-display text-2xl">{fmtHours(min)}</div>
      </Link>
    );
  }

  const meta = ABSENCE_META[entry.type];
  return (
    <Link
      to={`/day/${date}`}
      className={`rounded-xl px-4 py-3 grid grid-cols-[36px_1fr_auto] gap-3 items-center active:scale-[0.99] transition-transform ${meta.bg}`}
    >
      <div className="text-center">
        <div className="font-mono font-bold text-[11px] tracking-wider">{dayName(date).toUpperCase()}</div>
        <div className="font-mono text-[11px] text-paper/40 mt-0.5">{shortDate(date)}</div>
      </div>
      <div>
        <div className="font-semibold text-sm leading-tight flex items-center gap-2">
          <span>{meta.emoji}</span>
          <span>{meta.label}</span>
        </div>
        <div className="h-mono text-paper/55 text-[11px] mt-0.5">
          {entry.endDate && entry.endDate !== entry.date
            ? `bis ${shortDate(entry.endDate)}`
            : "ganzer Tag"}
        </div>
      </div>
      <div className={`h-mono text-[11px] px-2 py-1 rounded-md font-bold ${meta.badge}`}>
        {meta.code}
      </div>
    </Link>
  );
}

function EmptyRow({ date }: { date: string }) {
  const isToday = date === todayIso();
  return (
    <Link
      to="/entry"
      className={`rounded-xl px-4 py-3 grid grid-cols-[36px_1fr_auto] gap-3 items-center ${
        isToday
          ? "bg-copper/10 border border-copper/40 text-paper"
          : "bg-transparent border border-dashed border-ink/15 text-paper/40"
      }`}
    >
      <div className="text-center">
        <div className={`font-mono font-bold text-[11px] tracking-wider ${isToday ? "text-copper" : ""}`}>
          {dayName(date).toUpperCase()}
          {isToday && <span className="block text-[11px] text-copper mt-0.5">HEUTE</span>}
        </div>
        {!isToday && <div className="font-mono text-[11px] mt-0.5">{shortDate(date)}</div>}
      </div>
      <div>
        <div className="italic text-sm leading-tight">+ Eintrag hinzufügen</div>
        <div className="h-mono text-[11px] mt-0.5">noch offen</div>
      </div>
      <div className="h-display text-2xl text-paper/30">—</div>
    </Link>
  );
}

const ABSENCE_META = {
  sick:     { emoji: "🏥", label: "Krankheit",  code: "KRANK",  bg: "bg-rust/12 border border-rust/30",     badge: "bg-rust/30 text-rust" },
  vacation: { emoji: "🏖", label: "Urlaub",     code: "URLAUB", bg: "bg-moss/15 border border-moss-bright/30", badge: "bg-moss/30 text-moss-bright" },
  holiday:  { emoji: "🎉", label: "Feiertag",   code: "FREI",   bg: "bg-bg-3 border border-ink/10",       badge: "bg-bg-4 text-paper/70" }
} as const;
