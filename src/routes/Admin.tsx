import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import Logo from "../components/Logo";
import type { WeeklySummary } from "../lib/mockData";
import { listWorkers, listEntries, createInvitation, updateWorkerPhone, unlinkWorker } from "../lib/api";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { isBackendConnected } from "../lib/supabase";
import { fmtDateLong, fmtHours, isoWeek, siteById, todayIso, weekDays, workMinutes } from "../lib/utils";
import { currentUser, signOutFully } from "../lib/auth";
import {
  sendReminderToAll, workersWithoutEntry
} from "../lib/notifications";
import { isWorkEntry, type Entry, type Worker } from "../lib/types";

export default function Admin() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "submitted" | "open">("all");

  const [team, setTeam] = useState<Worker[]>([]);
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showWorkers, setShowWorkers] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [preselectWorker, setPreselectWorker] = useState<Worker | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const me = currentUser();
  const adminLabel = me ? `${me.firstName.charAt(0)}. ${me.lastName} · Admin` : "Admin";
  const today = todayIso();
  const { year, week } = isoWeek(new Date());
  const days = weekDays(year, week).slice(0, 5); // Mo–Fr
  const todayInWeek = days.includes(today);
  const refDate = todayInWeek ? today : "2026-05-08";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const workers = await listWorkers();
        console.log("[admin] loaded workers:", workers);
        if (cancelled) return;
        setAllWorkers(workers);
        const teamMembers = workers.filter((w) => !w.isAdmin);
        setTeam(teamMembers);

        const allEntriesArrays = await Promise.all(
          teamMembers.map((w) => listEntries(w.id, days[0], days[days.length - 1]))
        );
        if (cancelled) return;
        setAllEntries(allEntriesArrays.flat());
      } catch (err: any) {
        console.error("[admin] load error:", err);
        if (!cancelled) setLoadError(err?.message ?? "Verbindung fehlgeschlagen");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Echtzeit: bei Änderungen an Workers, Einträgen oder Zuweisungen sofort neu laden
  useRealtime("admin-dashboard", ["workers", "entries", "assignments"], () => setRefreshKey((k) => k + 1));
  useRefreshOnVisible(() => setRefreshKey((k) => k + 1));

  const missingToday = workersWithoutEntry(refDate, allEntries, team);

  // Echte Wochenstatistik aus den geladenen Einträgen
  const summaries: WeeklySummary[] = team.map((w) => {
    const myEntries = allEntries.filter((e) => e.workerId === w.id);
    const minutes = myEntries.reduce((s, e) => s + workMinutes(e), 0);
    const daysFilled = myEntries.length;
    const daysExpected = days.filter((d) => d <= today).length;
    const todayE = myEntries.find((e) => e.date === today && isWorkEntry(e));
    return {
      workerId: w.id,
      minutes,
      daysFilled,
      daysExpected,
      submitted: myEntries.length > 0 && days.every((d) =>
        myEntries.some((e) => e.date === d) || d > today
      ),
      lastActivity: myEntries.length > 0 ? myEntries[myEntries.length - 1].date : "",
      currentSite: todayE && isWorkEntry(todayE) ? todayE.siteId : undefined
    };
  });

  const totalMinutes = summaries.reduce((s, w) => s + w.minutes, 0);
  const submitted = summaries.filter((w) => w.submitted).length;
  const onSite = summaries.filter((w) => w.currentSite).length;

  const filtered = summaries.filter((s) => {
    if (filter === "submitted") return s.submitted;
    if (filter === "open") return !s.submitted;
    return true;
  });

  // Echter Live-Feed: zeigt die letzten Einträge der Woche, frischeste oben
  const liveFeed = [...allEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  function handleRemindAll() {
    sendReminderToAll(missingToday);
  }

  async function handleLogout() {
    await signOutFully();
    navigate("/buero", { replace: true });
  }

  return (
    <div className="min-h-screen safe-top safe-bottom">
      <div className="lg:flex">
        <aside className="hidden lg:flex flex-col w-64 bg-bg-2 border-r border-ink/10 px-5 py-6 sticky top-0 h-screen">
          <Logo />
          <p className="h-mono text-paper/45 text-[11px] mt-1.5">{adminLabel}</p>

          <nav className="mt-10 flex flex-col gap-1 text-[12px]">
            <NavItem icon="▦" label="Übersicht" active />
            <NavItem icon="●" label="Mitarbeiter" onClick={() => setShowWorkers(true)} />
            <NavItem icon="◷" label="Wochenplan" to="/admin/plan" />
            <NavItem icon="⌂" label="Baustellen" to="/admin/sites" />
            <NavItem icon="≡" label="Stunden" to="/admin/stunden" />
            <NavItem icon="▮" label="Auswertung" disabled />
            <NavItem icon="↗" label="DATEV-Export" disabled />
          </nav>

          <button onClick={handleLogout} className="mt-auto h-mono text-paper/40 text-[12px] text-left hover:text-copper">
            ← Abmelden
          </button>
        </aside>

        <main className="flex-1 px-5 py-5 lg:px-12 xl:px-16 lg:py-8 w-full">
          <header className="lg:hidden mb-6 flex items-center justify-between">
            <div>
              <Logo />
              <p className="h-mono text-paper/45 text-[11px] mt-1">{adminLabel}</p>
            </div>
            <button onClick={handleLogout} className="h-mono text-paper/40 text-[12px]">
              Abmelden
            </button>
          </header>

          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6 pb-5 border-b border-ink/10">
            <div>
              <p className="h-mono text-copper">
                — KW {week} / {year} · Mitarbeiter
                {todayInWeek && <span className="text-paper/45"> · Heute {fmtDateLong(today)}</span>}
              </p>
              <h1 className="h-display text-3xl lg:text-4xl mt-1">
                {new Date(days[0]).toLocaleDateString("de-DE", { day: "2-digit", month: "long" })}
                {" – "}
                {new Date(days[days.length - 1]).toLocaleDateString("de-DE", { day: "2-digit", month: "long" })}
              </h1>
              {!loading && (
                <p className={`h-mono text-[11px] mt-1.5 ${isBackendConnected() ? "text-good" : "text-paper/40"}`}>
                  {isBackendConnected()
                    ? `● Live · ${team.length} Mitarbeiter · ${allEntries.length} Einträge aus Frankfurt`
                    : "○ Mock-Modus"}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link to="/admin/plan" className="btn-ghost text-[12px] lg:hidden">
                Wochenplan
              </Link>
              <button className="btn-ghost text-[12px]">Filter</button>
              <button className="btn-ghost text-[12px]">PDF</button>
              <button className="btn-primary text-[11px]">DATEV-Export ↗</button>
            </div>
          </div>

          {/* Error-Banner falls listWorkers fehlschlägt */}
          {loadError && (
            <div className="mb-5 bg-rust/15 border border-rust/40 rounded-xl p-4">
              <div className="h-mono text-rust text-[12px]">— Fehler beim Laden</div>
              <p className="text-sm text-paper mt-1">{loadError}</p>
              <p className="h-mono text-paper/55 text-[11px] mt-2">
                Öffne Browser-Console (F12) für Details.
              </p>
            </div>
          )}

          {/* Hinweis falls Workers geladen aber Liste leer */}
          {!loading && !loadError && team.length === 0 && (
            <div className="mb-5 bg-copper/10 border border-copper/40 rounded-xl p-4">
              <div className="h-mono text-copper text-[12px]">— Liste leer</div>
              <p className="text-sm text-paper mt-1">
                Keine Mitarbeiter aus der DB geladen. Mögliche Ursachen:
              </p>
              <ul className="text-[12px] text-paper/70 mt-2 list-disc list-inside space-y-1">
                <li>RLS blockiert Zugriff (Demo-Policies nicht aktiv?)</li>
                <li>Alle Workers sind als Admin markiert</li>
                <li>Workers-Tabelle ist leer</li>
              </ul>
            </div>
          )}

          {/* Eigene Wochenübersicht für Admin */}
          {me && (
            <Link
              to="/"
              className="block mb-5 bg-gradient-to-br from-copper/15 to-bg-2 border border-copper/30 rounded-xl p-4 lg:p-5 flex items-center gap-4 active:scale-[0.99] transition-transform"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-copper-bright to-copper text-bg-deep flex items-center justify-center font-display font-extrabold text-base flex-shrink-0">
                {me.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="h-mono text-copper text-[11px]">— Mein Wochenzettel</div>
                <div className="font-semibold text-sm mt-0.5">{me.firstName} {me.lastName}</div>
                <div className="h-mono text-paper/55 text-[11px] mt-0.5">
                  Eigene Stunden eintragen — wie ein Mitarbeiter
                </div>
              </div>
              <span className="text-copper text-2xl flex-shrink-0">→</span>
            </Link>
          )}

          {/* Notification-Banner ist global (AdminPushBanner) — hier kein doppeltes Element */}

          {/* Wer fehlt heute */}
          {missingToday.length > 0 && (
            <div className="mb-5 bg-rust/10 border border-rust/35 rounded-xl px-5 py-4 lg:flex items-center gap-5">
              <div className="flex items-center gap-4 flex-1">
                <span className="text-3xl">⚠</span>
                <div>
                  <div className="font-semibold text-sm">
                    {missingToday.length} {missingToday.length === 1 ? "Mitarbeiter" : "Mitarbeiter"} ohne Eintrag heute
                  </div>
                  <div className="h-mono text-paper/65 text-[12px] mt-0.5">
                    {missingToday.map((w) => `${w.firstName} ${w.lastName.charAt(0)}.`).join(" · ")}
                  </div>
                </div>
              </div>
              <button
                onClick={handleRemindAll}
                className="mt-3 lg:mt-0 btn-primary text-[11px] whitespace-nowrap"
              >
                Alle erinnern · Push senden
              </button>
            </div>
          )}

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-8">
            <Stat
              kicker={`Gesamt KW ${week}`}
              value={`${fmtHours(totalMinutes)} h`}
              sub={`${team.length} Mitarbeiter`}
              tone="primary"
            />
            <Stat
              kicker="Wochenstatus"
              value={`${submitted} / ${team.length}`}
              sub="Wochen komplett"
              tone={submitted === team.length ? "good" : "neutral"}
            />
            <Stat
              kicker="Heute aktiv"
              value={`${onSite}`}
              sub={`auf ${new Set(summaries.filter(s => s.currentSite).map(s => s.currentSite)).size} Baustellen`}
            />
            <Stat
              kicker="Abwesend"
              value={`${allEntries.filter(e => e.type !== "work").length}`}
              sub="Krank · Urlaub · Feiertag"
              tone="rust"
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="h-mono text-copper">— Mitarbeiter</h2>
                <div className="flex gap-1.5 text-[12px]">
                  <FilterChip active={filter === "all"}       onClick={() => setFilter("all")}>Alle</FilterChip>
                  <FilterChip active={filter === "submitted"} onClick={() => setFilter("submitted")}>Komplett</FilterChip>
                  <FilterChip active={filter === "open"}      onClick={() => setFilter("open")}>Nachtrag</FilterChip>
                </div>
              </div>

              <ul className="space-y-2">
                {filtered.map((summary) => {
                  const worker = team.find((w) => w.id === summary.workerId);
                  if (!worker) return null;
                  return (
                    <TeamRow
                      key={summary.workerId}
                      summary={summary}
                      worker={worker}
                      entries={allEntries}
                      refDate={refDate}
                      missing={missingToday}
                      onInvite={() => { setPreselectWorker(worker); setShowInvite(true); }}
                    />
                  );
                })}
              </ul>

              <button
                onClick={() => { setPreselectWorker(null); setShowInvite(true); }}
                className="mt-3 w-full bg-bg-2 border border-dashed border-copper/40 rounded-xl px-4 py-3 flex items-center gap-3 active:bg-bg-3 transition-colors text-left"
              >
                <span className="text-2xl">＋</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm">Mitarbeiter einladen</div>
                  <div className="h-mono text-paper/55 text-[11px] mt-0.5">Code per WhatsApp senden · 24 h gültig</div>
                </div>
                <span className="text-copper text-xl">→</span>
              </button>
            </div>

            <div>
              <h2 className="h-mono text-copper mb-3">— Letzte Einträge · KW {week}</h2>
              {liveFeed.length === 0 ? (
                <div className="bg-bg-2 border border-ink/10 rounded-xl px-4 py-6 text-center">
                  <div className="h-mono text-paper/55 text-[11px]">Noch keine Einträge</div>
                  <div className="text-[12px] text-paper/65 mt-1">Sobald jemand Stunden speichert, taucht hier eine Live-Meldung auf.</div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {liveFeed.map((entry) => {
                    const w = allWorkers.find((wo) => wo.id === entry.workerId);
                    return <EntryFeedRow key={entry.id} entry={entry} worker={w} />;
                  })}
                </ul>
              )}
            </div>
          </section>
        </main>
      </div>

      {showInvite && (
        <InviteModal
          team={team}
          preselect={preselectWorker}
          onClose={() => { setShowInvite(false); setPreselectWorker(null); }}
        />
      )}
      {showWorkers && (
        <WorkersModal
          workers={allWorkers}
          onClose={() => setShowWorkers(false)}
          onUpdated={(updated) => {
            setAllWorkers((prev) => prev.map((w) => w.id === updated.id ? updated : w));
            setTeam((prev) => prev.map((w) => w.id === updated.id ? updated : w));
          }}
          onInvite={(worker) => {
            setShowWorkers(false);
            setPreselectWorker(worker);
            setShowInvite(true);
          }}
        />
      )}
    </div>
  );
}

function WorkersModal({
  workers, onClose, onUpdated, onInvite
}: {
  workers: Worker[];
  onClose: () => void;
  onUpdated: (w: Worker) => void;
  onInvite: (w: Worker) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-baseline justify-between mb-4">
          <span className="h-mono text-copper text-[12px]">— Mitarbeiter · {workers.length}</span>
          <button onClick={onClose} className="h-mono text-paper/55 text-[12px]">Schließen</button>
        </div>

        <h2 className="h-display text-2xl mb-5">Stamm-Daten</h2>

        <ul className="space-y-2">
          {workers.map((w) => (
            <WorkerRow key={w.id} worker={w} onUpdated={onUpdated} onInvite={() => onInvite(w)} />
          ))}
        </ul>

        <p className="h-mono text-paper/45 text-[11px] mt-5 text-center leading-relaxed">
          Telefonnummer wird für den WhatsApp-Code-Versand verwendet.<br />
          Verknüpft = Mitarbeiter hat Code eingelöst und ist auf einem Gerät angemeldet.
        </p>
      </div>
    </div>
  );
}

function WorkerRow({
  worker, onUpdated, onInvite
}: {
  worker: Worker;
  onUpdated: (w: Worker) => void;
  onInvite: () => void;
}) {
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateWorkerPhone(worker.id, phone.trim() || null);
      onUpdated({ ...worker, phone: phone.trim() || undefined });
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    if (!confirm(
      `Verknüpfung von ${worker.firstName} ${worker.lastName} mit dem aktuellen Gerät wirklich lösen?\n\n` +
      `Danach kannst du einen neuen Code/QR ausgeben — z.B. wenn das Handy gewechselt wurde.\n\n` +
      `Bisherige Einträge bleiben erhalten.`
    )) return;
    setUnlinking(true);
    setError(null);
    try {
      await unlinkWorker(worker.id);
      onUpdated({ ...worker, linked: false });
    } catch (err: any) {
      setError(err?.message ?? "Verknüpfung konnte nicht gelöst werden");
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <li className="bg-bg-3 rounded-xl p-3.5">
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center font-display font-extrabold text-base flex-shrink-0 ${
          worker.isAdmin
            ? "bg-gradient-to-br from-copper-bright to-copper text-bg-deep"
            : "bg-bg-4 text-copper-bright"
        }`}>
          {worker.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-semibold text-[14px]">{worker.firstName} {worker.lastName}</div>
            {worker.isAdmin && <span className="h-mono text-copper text-[10px]">— ADMIN</span>}
            {worker.linked
              ? <span className="h-mono text-good text-[10px]">● VERKNÜPFT</span>
              : !worker.isAdmin && <span className="h-mono text-paper/45 text-[10px]">○ OFFEN</span>}
          </div>
          <div className="h-mono text-paper/55 text-[11px] mt-0.5">{worker.role}</div>
        </div>
        {!worker.isAdmin && !worker.linked && (
          <button
            onClick={onInvite}
            className="h-mono text-[10px] text-copper hover:underline whitespace-nowrap"
          >
            📱 Code →
          </button>
        )}
        {!worker.isAdmin && worker.linked && (
          <button
            onClick={unlink}
            disabled={unlinking}
            className="h-mono text-[10px] text-rust hover:underline whitespace-nowrap disabled:opacity-50"
            title="Trennung des Mitarbeiters vom aktuell verknüpften Gerät"
          >
            {unlinking ? "Lösche …" : "× Verknüpfung lösen"}
          </button>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-ink/10">
        <div className="flex items-center gap-2">
          <span className="h-mono text-copper text-[10px] flex-shrink-0">— TEL</span>
          {editing ? (
            <>
              <input
                type="tel"
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+49 1520 …"
                className="flex-1 bg-bg-2 border border-copper/40 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:border-copper font-mono"
              />
              <button
                onClick={save}
                disabled={saving}
                className="h-mono text-[10px] text-copper px-2 py-1 disabled:opacity-50"
              >
                {saving ? "…" : "OK"}
              </button>
              <button
                onClick={() => { setPhone(worker.phone ?? ""); setEditing(false); setError(null); }}
                className="h-mono text-[10px] text-paper/55 px-2 py-1"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[13px] font-mono text-paper/85">
                {worker.phone || <span className="text-paper/40 italic">— nicht hinterlegt —</span>}
              </span>
              <button
                onClick={() => setEditing(true)}
                className="h-mono text-[10px] text-copper hover:underline"
              >
                Bearbeiten
              </button>
            </>
          )}
        </div>
        {error && <p className="text-rust text-[11px] mt-1">{error}</p>}
      </div>
    </li>
  );
}

function InviteModal({
  team, preselect, onClose
}: {
  team: Worker[];
  preselect: Worker | null;
  onClose: () => void;
}) {
  const [worker, setWorker] = useState<Worker | null>(preselect ?? team[0] ?? null);
  const [code, setCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // QR-Code rendern, sobald Code da ist
  useEffect(() => {
    if (!code) { setQrDataUrl(null); return; }
    const url = window.location.origin + "/onboarding?code=" + code;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      width: 480,
      margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" }
    })
      .then(setQrDataUrl)
      .catch((err) => console.error("[invite] QR generation failed", err));
  }, [code]);

  async function generate() {
    if (!worker) return;
    setLoading(true);
    setError(null);
    try {
      const c = await createInvitation(worker.id);
      setCode(c);
    } catch (err: any) {
      setError(err?.message ?? "Code konnte nicht erzeugt werden");
    } finally {
      setLoading(false);
    }
  }

  function printQr() {
    if (!qrDataUrl || !worker || !code) return;
    const html = `<!doctype html><html><head><title>${worker.firstName} ${worker.lastName} · Einladung</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; text-align: center; }
        h1 { font-size: 32px; margin: 0 0 4px; }
        .role { color: #6B7280; font-size: 14px; margin-bottom: 28px; }
        img { max-width: 320px; }
        .code { font-family: 'Courier New', monospace; font-size: 28px; letter-spacing: 6px; margin-top: 18px; }
        .hint { color: #6B7280; font-size: 13px; margin-top: 18px; line-height: 1.5; }
      </style></head>
      <body>
        <h1>${worker.firstName} ${worker.lastName}</h1>
        <div class="role">${worker.role}</div>
        <img src="${qrDataUrl}" alt="QR-Code"/>
        <div class="code">${code}</div>
        <div class="hint">QR mit der iPhone-Kamera scannen<br/>oder Code manuell eingeben<br/><br/>24 Stunden gültig</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.onload = () => w.print();
    }
  }

  function whatsAppUrl(): string {
    if (!worker) return "https://wa.me/";
    const appUrl = window.location.origin + "/onboarding?code=" + (code ?? "");
    const msg =
      `👋 Moin ${worker.firstName}!%0A%0A` +
      `Hier dein Anmelde-Code für die Leuschner-App:%0A%0A` +
      `*${code}*%0A%0A` +
      `App öffnen:%0A${encodeURIComponent(appUrl)}%0A%0A` +
      `Code ist 24 h gültig.`;
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    return cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-baseline justify-between mb-4">
          <span className="h-mono text-copper text-[12px]">— Mitarbeiter einladen</span>
          <button onClick={onClose} className="h-mono text-paper/55 text-[12px]">Schließen</button>
        </div>

        <h2 className="h-display text-2xl mb-4">Wer wird eingeladen?</h2>

        {team.length === 0 ? (
          <div className="bg-bg-3 rounded-xl p-5 text-center">
            <p className="h-mono text-paper/55 text-[12px]">— Mitarbeiter wird geladen …</p>
            <p className="text-sm text-paper/65 mt-2">Falls die Liste leer bleibt, ist die DB-Verbindung nicht aktiv.</p>
          </div>
        ) : (
          <div className="space-y-1.5 mb-5 max-h-48 overflow-y-auto">
            {team.map((w) => (
              <button
                key={w.id}
                onClick={() => { setCode(null); setWorker(w); }}
                className={`w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 ${
                  worker && w.id === worker.id ? "bg-copper/15 border border-copper" : "bg-bg-3 border border-transparent"
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-display font-extrabold text-xs ${
                  worker && w.id === worker.id ? "bg-copper text-bg-deep" : "bg-bg-4 text-copper-bright"
                }`}>
                  {w.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{w.firstName} {w.lastName}</div>
                  <div className="h-mono text-paper/55 text-[11px]">{w.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {worker && !code ? (
          <button
            onClick={generate}
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading ? "Erzeuge Code …" : `Code für ${worker.firstName} erzeugen`}
          </button>
        ) : code ? (
          <div className="space-y-4">
            <div className="bg-bg-DEFAULT border-2 border-copper rounded-xl p-5 text-center">
              <div className="h-mono text-copper text-[11px] mb-3">— QR-Code · scannen mit iPhone-Kamera</div>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR-Code für ${worker?.firstName}`}
                  className="mx-auto w-64 h-64 rounded-lg"
                />
              ) : (
                <div className="w-64 h-64 mx-auto bg-bg-2 rounded-lg flex items-center justify-center text-paper/55 text-[12px]">
                  QR wird erzeugt …
                </div>
              )}
              <div className="h-mono text-paper/65 text-[11px] mt-3">— oder Code manuell eingeben</div>
              <div className="font-mono font-bold text-2xl tracking-widest mt-1.5">{code}</div>
              <div className="h-mono text-paper/45 text-[11px] mt-2">24 Stunden gültig</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={printQr}
                disabled={!qrDataUrl}
                className="btn-ghost text-[12px] disabled:opacity-50"
              >
                🖨 Drucken
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="btn-ghost text-[12px]"
              >
                Code kopieren
              </button>
            </div>

            <details className="bg-bg-3 rounded-xl">
              <summary className="px-4 py-3 cursor-pointer h-mono text-copper text-[11px]">
                — Per WhatsApp schicken (optional)
              </summary>
              <div className="px-4 pb-4 pt-2 space-y-3">
                <input
                  type="tel"
                  placeholder="+49 152 …"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper"
                />
                <a
                  href={whatsAppUrl()}
                  target="_blank"
                  rel="noopener"
                  className="block text-center w-full px-4 py-2.5 rounded-lg bg-[#25D366] text-bg-deep font-bold text-[13px]"
                >
                  📱 Per WhatsApp senden
                </a>
              </div>
            </details>
          </div>
        ) : null}

        {error && (
          <p className="text-rust text-[11px] mt-3">{error}</p>
        )}
      </div>
    </div>
  );
}

function NavItem({
  icon, label, active, disabled, onClick, to
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  to?: string;
}) {
  const className = `flex items-center gap-3 px-3 py-2.5 rounded-lg text-left h-mono transition-colors ${
    active
      ? "bg-copper/15 text-copper"
      : disabled
        ? "text-paper/30 cursor-not-allowed"
        : "text-paper/65 hover:bg-ink/5 hover:text-paper"
  }`;
  const content = (
    <>
      <span className="w-4 text-center">{icon}</span>
      <span>{label}</span>
      {disabled && <span className="ml-auto h-mono text-[9px] text-paper/30">bald</span>}
    </>
  );
  if (to && !disabled) {
    return <Link to={to} className={className}>{content}</Link>;
  }
  return (
    <button onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

function Stat({
  kicker, value, sub, tone = "neutral"
}: {
  kicker: string;
  value: string;
  sub?: string;
  tone?: "primary" | "good" | "rust" | "neutral";
}) {
  const border =
    tone === "primary" ? "border-l-copper" :
    tone === "good"    ? "border-l-good" :
    tone === "rust"    ? "border-l-rust" :
    "border-l-ink/15";
  return (
    <div className={`bg-bg-2 rounded-xl border-l-[3px] ${border} px-4 py-4 lg:px-5`}>
      <div className="h-mono text-copper text-[11px]">— {kicker}</div>
      <div className="h-display text-3xl lg:text-4xl mt-1">{value}</div>
      {sub && <div className="text-[11px] text-paper/55 mt-1">{sub}</div>}
    </div>
  );
}

function FilterChip({
  active, onClick, children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-mono px-2.5 py-1 rounded-md transition-colors ${
        active ? "bg-copper text-bg-deep font-bold" : "text-paper/55 hover:text-paper"
      }`}
    >
      {children}
    </button>
  );
}

function TeamRow({
  summary, worker, entries, refDate, missing, onInvite
}: {
  summary: WeeklySummary;
  worker: Worker;
  entries: Entry[];
  refDate: string;
  missing: Worker[];
  onInvite: () => void;
}) {
  const site = summary.currentSite ? siteById(summary.currentSite) : null;
  const completion = (summary.daysFilled / summary.daysExpected) * 100;
  const isMissingToday = missing.some((w) => w.id === worker.id);

  const todayEntry = entries.find(
    (e) => e.workerId === worker.id && e.date === refDate && e.type !== "work"
  ) as { type: "sick" | "vacation" | "holiday" } | undefined;

  return (
    <li className="bg-bg-2 rounded-xl px-4 py-3 grid grid-cols-[44px_1fr_auto_auto] gap-3 lg:gap-4 items-center">
      <div className="w-11 h-11 rounded-full bg-bg-4 text-copper-bright flex items-center justify-center font-display font-extrabold text-base">
        {worker.initials}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{worker.firstName} {worker.lastName}</div>
        <div className="h-mono text-paper/55 text-[11px] mt-0.5">
          {todayEntry
            ? <span className="text-rust">{ABSENCE_LABEL[todayEntry.type].label}</span>
            : site
            ? <><span className="text-good">●</span> auf {site.name}</>
            : worker.role}
        </div>
        <div className="mt-1.5 h-1 bg-bg-3 rounded-full overflow-hidden">
          <div
            className={`h-full ${summary.submitted ? "bg-good" : isMissingToday ? "bg-rust" : "bg-copper"}`}
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>
      <div className="text-right">
        <div className="h-display text-2xl">{fmtHours(summary.minutes)}</div>
        <div className="h-mono text-paper/40 text-[11px]">Std.</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={`h-mono text-[11px] px-2 py-1 rounded-md font-bold ${
          summary.submitted
            ? "bg-good/20 text-good"
            : isMissingToday
            ? "bg-rust/25 text-rust"
            : "bg-copper/20 text-copper"
        }`}>
          {summary.submitted ? "Komplett" : isMissingToday ? "Heute fehlt" : "Nachtrag nötig"}
        </span>
        <button
          onClick={onInvite}
          className="h-mono text-[8px] text-copper hover:underline"
        >
          📱 Code senden
        </button>
      </div>
    </li>
  );
}

function EntryFeedRow({ entry, worker }: { entry: Entry; worker?: Worker }) {
  if (!worker) return null;
  const dateLabel = new Date(entry.date).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

  if (isWorkEntry(entry)) {
    const site = siteById(entry.siteId);
    const min = (entry.endMin - entry.startMin) - entry.pauseMin;
    return (
      <li className="bg-bg-2 rounded-lg px-3 py-2.5 flex gap-3 items-start border border-ink/10">
        <span className="w-2 h-2 rounded-full mt-1.5 bg-copper flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[13px]">{worker.firstName} {worker.lastName.charAt(0)}.</span>
            <span className="h-mono text-paper/55 text-[11px] flex-shrink-0">{dateLabel}</span>
          </div>
          <div className="h-mono text-copper text-[11px] mt-0.5">— {entry.discipline} · {fmtHours(Math.max(0, min))} h</div>
          <div className="text-[12px] text-paper/75 mt-1 leading-snug truncate">
            {site?.name ?? "Baustelle"}
          </div>
        </div>
      </li>
    );
  }

  const meta = ABSENCE_LABEL[entry.type];
  return (
    <li className="bg-bg-2 rounded-lg px-3 py-2.5 flex gap-3 items-start border border-ink/10">
      <span className={`w-2 h-2 rounded-full mt-1.5 ${meta.dot} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-[13px]">{worker.firstName} {worker.lastName.charAt(0)}.</span>
          <span className="h-mono text-paper/55 text-[11px] flex-shrink-0">{dateLabel}</span>
        </div>
        <div className={`h-mono text-[11px] mt-0.5 ${meta.fg}`}>— {meta.label}</div>
        {entry.note && (
          <div className="text-[12px] text-paper/75 mt-1 leading-snug truncate">„{entry.note}"</div>
        )}
      </div>
    </li>
  );
}

const ABSENCE_LABEL = {
  sick:     { label: "🏥 Krank",    dot: "bg-rust",   fg: "text-rust" },
  vacation: { label: "🏖 Urlaub",   dot: "bg-moss",   fg: "text-moss-bright" },
  holiday:  { label: "🎉 Feiertag", dot: "bg-bronze", fg: "text-bronze" }
} as const;
