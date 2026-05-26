import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import Logo from "../components/Logo";
import {
  listWorkers, listAllEntries, listSites,
  listAssignmentsForCompany, createInvitation,
  updateWorkerPhone, unlinkWorker
} from "../lib/api";
import { listCards, type PipelineCard, type Stage } from "../lib/pipeline";
import { listInquiries, type Inquiry } from "../lib/inquiries";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { isBackendConnected } from "../lib/supabase";
import { currentUser, signOutFully } from "../lib/auth";
import { isoWeek, todayIso, weekDays, fmtHours, workMinutes } from "../lib/utils";
import { isWorkEntry, type Entry, type Site, type Worker, type Assignment } from "../lib/types";
import { BuiltByDollart } from "../components/Logo";
import InfoTip from "../components/InfoTip";

/* Erklär-Texte je Modul/Stage. Sollen für jemand klingen, der die
 * App zum ersten Mal sieht: kurz, konkret, ohne Insider-Slang.
 * Sidebar hat keine Tooltips mehr (User-Entscheidung 21.05.2026). */
const STAGE_HINT: Record<string, string> = {
  "Anfrage":     "Roh eingegangen, noch nicht beziffert. Liegt in der Inbox, wartet auf Aufmaß/Bewertung.",
  "Angebot":     "Angebot in Vorbereitung in sevDesk. Material- und Lohn-Positionen werden kalkuliert.",
  "Versendet":   "Angebot ist beim Kunden raus. Nach 7 Tagen ohne Antwort wird zum Nachfassen erinnert.",
  "Auftrag":     "Kunde hat zugesagt, Baustelle ist angelegt, Auftragsnummer vergeben.",
  "In Arbeit":   "Mitarbeiter sind dran, Stunden werden gebucht. Sichtbar in der Zeiterfassung.",
  "Abgerechnet": "Rechnung in sevDesk ist gestellt und bezahlt — der Vorgang ist abgeschlossen.",
};

/* ────────────────────────────────────────────────────────────────────────
   Admin-Dashboard · Konzept 9 „Module-Grid"
   Allgemeiner Betriebs-Überblick: Belegschaft · Angebote · Baustellen ·
   Finanzen · Aktionen · Wetter/Termine. Stunden = 1 Modul, Details im
   Zeiterfassung-Tab. Schriftart/Look 1:1 aus Angebote-Tab.
   ──────────────────────────────────────────────────────────────────────── */

export default function Admin() {
  const navigate = useNavigate();
  const me = currentUser();
  // Rolle dynamisch aus dem worker-role-Feld: Leuschner & Wilken = Inhaber,
  // Rick (Doll(ART)) = Admin/Coder, sonstige Admins = Admin.
  const roleSuffix = (() => {
    if (!me) return "Admin";
    const r = (me.role ?? "").toLowerCase();
    if (/inhaber|geschäftsführer|gesellschafter/.test(r)) return "Inhaber";
    if (/büro|verwaltung|coder|doll/.test(r)) return "Admin · Doll(ART)";
    return "Admin";
  })();
  const adminLabel = me ? `${me.firstName.charAt(0)}. ${me.lastName} · ${roleSuffix}` : "Admin";

  const today = todayIso();
  const { year, week } = isoWeek(new Date());
  const days = weekDays(year, week).slice(0, 5);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [assignmentsToday, setAssignmentsToday] = useState<Assignment[]>([]);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [showWorkers, setShowWorkers] = useState(false);
  const [preselectWorker, setPreselectWorker] = useState<Worker | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [w, s, e, a, c, inq] = await Promise.all([
          listWorkers(),
          listSites().catch(() => [] as Site[]),
          listAllEntries(days[0], days[days.length - 1]).catch(() => [] as Entry[]),
          listAssignmentsForCompany(today, today).catch(() => [] as Assignment[]),
          listCards({ archived: false }).catch(() => [] as PipelineCard[]),
          listInquiries({ onlyOpen: true }).catch(() => [] as Inquiry[])
        ]);
        if (cancelled) return;
        setWorkers(w);
        setSites(s);
        setEntries(e);
        setAssignmentsToday(a);
        setInquiries(inq);
        setCards(c);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message ?? "Verbindung fehlgeschlagen");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useRealtime("admin-dashboard", ["workers", "entries", "assignments", "sites", "pipeline_cards", "inquiries"],
    () => setRefreshKey((k) => k + 1));
  useRefreshOnVisible(() => setRefreshKey((k) => k + 1));

  const team = useMemo(() => workers.filter((w) => !w.isAdmin), [workers]);

  // Heute · wer ist wo unterwegs (heutige Einträge + Tagesplan)
  const todayLive = useMemo(() => {
    const list: { worker: Worker; site?: Site; status: "live" | "vacation" | "sick" | "planned" | "off" }[] = [];
    for (const w of team) {
      const todayEntry = entries.find((e) => e.workerId === w.id && e.date === today);
      if (todayEntry && isWorkEntry(todayEntry)) {
        list.push({ worker: w, site: sites.find((s) => s.id === todayEntry.siteId), status: "live" });
      } else if (todayEntry && todayEntry.type === "vacation") {
        list.push({ worker: w, status: "vacation" });
      } else if (todayEntry && todayEntry.type === "sick") {
        list.push({ worker: w, status: "sick" });
      } else {
        const plan = assignmentsToday.find((a) => a.workerId === w.id);
        list.push({
          worker: w,
          site: plan ? sites.find((s) => s.id === plan.siteId) : undefined,
          status: plan ? "planned" : "off"
        });
      }
    }
    return list;
  }, [team, entries, sites, assignmentsToday, today]);

  const liveCount = todayLive.filter((r) => r.status === "live").length;
  const plannedCount = todayLive.filter((r) => r.status === "planned").length;

  // Stunden-Snapshot KW
  const weekMinutesAll = entries.reduce((s, e) => s + workMinutes(e), 0);
  const gaps = useMemo(() => {
    let count = 0;
    for (const w of team) {
      for (const d of days) {
        if (d > today) continue;
        const e = entries.find((x) => x.workerId === w.id && x.date === d);
        if (!e) count += 1;
      }
    }
    return count;
  }, [team, days, entries, today]);

  // Pipeline-Counts
  const stageCount = (stage: Stage) => cards.filter((c) => c.stage === stage).length;
  const sumStage = (stage: Stage) =>
    cards.filter((c) => c.stage === stage).reduce((t, c) => t + (c.valueEur ?? c.planEur ?? 0), 0);
  const pipelineValue = cards.reduce(
    (t, c) => t + (c.stage !== "Abgerechnet" ? (c.valueEur ?? c.planEur ?? 0) : 0),
    0
  );
  const versendetOverdue = cards.filter((c) => {
    if (c.stage !== "Versendet" || !c.sentAt) return false;
    return (Date.now() - new Date(c.sentAt).getTime()) / 86_400_000 >= 7;
  }).length;
  const releasesOpen = cards.filter((c) => c.stage === "Angebot" && !c.freigabe?.releasedAt).length;

  // Baustellen-Status: aktive (Einträge dieser Woche) vs. ruhend
  const activeSiteIds = new Set(
    entries.filter(isWorkEntry).map((e) => e.siteId).filter((id): id is string => !!id)
  );
  const activeSites = sites.filter((s) => activeSiteIds.has(s.id));
  const restingSites = sites.filter((s) => !activeSiteIds.has(s.id));

  // Aktionen: cross-bereich
  const actions = useMemo(() => {
    const list: { kind: "gap" | "release" | "followup" | "address"; severity: "r" | "c" | "g"; title: string; sub: string; href?: string }[] = [];
    if (gaps > 0) {
      list.push({
        kind: "gap", severity: "r",
        title: `${gaps} Stunden-Lücke${gaps === 1 ? "" : "n"} diese Woche`,
        sub: "Mitarbeiter ohne Eintrag · Push erinnern oder nachtragen",
        href: "/admin/zeiterfassung"
      });
    }
    if (releasesOpen > 0) {
      list.push({
        kind: "release", severity: "c",
        title: `${releasesOpen} Angebot${releasesOpen === 1 ? "" : "e"} zur Freigabe`,
        sub: "Chef-Freigabe nötig bevor versendet werden kann",
        href: "/admin/angebote"
      });
    }
    if (versendetOverdue > 0) {
      list.push({
        kind: "followup", severity: "c",
        title: `${versendetOverdue} Angebot${versendetOverdue === 1 ? "" : "e"} nachfassen`,
        sub: "Seit >7 Tagen versendet, keine Kundenrückmeldung",
        href: "/admin/angebote"
      });
    }
    const noAddr = sites.filter((s) => !s.street || !s.city).length;
    if (noAddr > 0) {
      list.push({
        kind: "address", severity: "g",
        title: `${noAddr} Baustelle${noAddr === 1 ? "" : "n"} ohne vollständige Adresse`,
        sub: "Aus sevDesk übernehmen oder manuell ergänzen",
        href: "/admin/sites"
      });
    }
    return list;
  }, [gaps, releasesOpen, versendetOverdue, sites]);

  async function handleLogout() {
    await signOutFully();
    navigate("/buero", { replace: true });
  }

  return (
    <div className="min-h-screen safe-top safe-bottom">
      <div className="lg:flex">
        {/* SIDEBAR · konsolidiert auf 5 Top-Einträge */}
        <aside className="hidden lg:flex flex-col w-60 surface-steel px-5 py-6 sticky top-0 h-screen">
          {/* Logo · groß und fett, füllt die Sidebar-Breite spürbar aus */}
          <Logo tone="light" size="default" className="block" />
          <p className="dd-eyebrow text-steel mt-2">{adminLabel}</p>

          <nav className="mt-10 flex flex-col gap-1">
            <SbItem icon="●" label="Übersicht" active />
            <SbItem icon="◷" label="Zeiterfassung" to="/admin/zeiterfassung" />
            <SbItem icon="⌂" label="Baustellen" to="/admin/sites" />
            <SbItem icon="◇" label="Angebote" to="/admin/angebote" />
            <SbItem icon="✉" label="Anfragen" to="/admin/anfragen" />
            <SbItem icon="◯" label="Mitarbeiter" onClick={() => setShowWorkers(true)} />
            <div className="h-px bg-white/8 my-3" />
            <SbItem icon="▮" label="Auswertung" disabled />
          </nav>

          {/* Footer-Block · Abmelden + Doll(ART)-Brand */}
          <div className="mt-auto flex flex-col gap-4">
            <button onClick={handleLogout} className="dd-eyebrow text-steel text-left hover:text-copper-bright transition-colors">
              ← Abmelden
            </button>
            <div className="pt-3 border-t border-white/10">
              <BuiltByDollart />
            </div>
          </div>
        </aside>

        <main className="flex-1 w-full">
          {/* Mobile-Header */}
          <header className="lg:hidden px-5 py-4 flex items-center justify-between bg-bg-2 border-b border-steel-line/40">
            <div>
              <Logo />
              <p className="dd-eyebrow text-ink-mute mt-1">{adminLabel}</p>
            </div>
            <button onClick={handleLogout} className="dd-eyebrow text-ink-mute">Abmelden</button>
          </header>

          {/* STAHL-HEADER · konsistent mit allen anderen Admin-Routen */}
          <header className="sticky top-0 z-30 surface-steel px-5 lg:px-10 xl:px-14 pt-5 pb-5 safe-top">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 flex-wrap">
              <div>
                <span className="dd-eyebrow text-copper-bright block">
                  {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })} · KW {week}
                </span>
                <h1 className="font-display font-black uppercase text-2xl lg:text-3xl xl:text-4xl text-white leading-none mt-1.5">
                  Übersicht · So läuft dein Betrieb
                </h1>
                {!loading && (
                  <p className={`font-mono text-[11.5px] mt-2 tracking-wide ${isBackendConnected() ? "text-moss-bright" : "text-steel"}`}>
                    {isBackendConnected()
                      ? `● Live · ${liveCount} Mitarbeiter aktiv · ${activeSites.length} Baustelle${activeSites.length === 1 ? "" : "n"} · ${cards.length} Vorgänge`
                      : "○ Mock-Modus"}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link
                  to="/admin/anfrage-neu"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-white/10 border border-white/25 text-white text-[12px] font-display font-extrabold uppercase tracking-wide hover:bg-white/20 hover:border-copper-bright transition-colors !min-h-[44px]"
                  title="Neue Kundenanfrage in die Eingangsbox einfügen — Mail/Telefon/WhatsApp-Text reinpasten, KI strukturiert die Felder"
                >
                  ＋ Anfrage
                </Link>
                <button
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-white/10 border border-white/25 text-white text-[12px] font-display font-extrabold uppercase tracking-wide hover:bg-white/20 hover:border-copper-bright transition-colors !min-h-[44px]"
                  title="PDF-Export der aktuellen Wochen-Übersicht — kommt noch"
                >PDF</button>
                <Link
                  to="/admin/zeiterfassung?tab=datev"
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-copper text-white text-[12px] font-display font-extrabold uppercase tracking-wide hover:bg-copper-bright transition-colors !min-h-[44px]"
                  title="DATEV-Stundenexport: CSV für den Steuerberater (alle Mitarbeiter, alle Lohnarten der Woche)"
                >
                  DATEV ↗
                </Link>
              </div>
            </div>
          </header>

          {/* Module-Grid · jetzt mit eigenem Padding-Wrapper */}
          <div className="px-5 py-6 lg:px-10 xl:px-14 lg:py-8">

          {loadError && (
            <div className="mb-5 bg-rust/15 border border-rust/40 rounded-xl p-4">
              <div className="dd-eyebrow text-rust">Fehler beim Laden</div>
              <p className="text-sm text-paper mt-1">{loadError}</p>
            </div>
          )}

          {/* MODULE-GRID */}
          <div className="grid grid-cols-12 gap-4 lg:gap-5">
            {/* ── PIPELINE · volle Breite oben ────────────────────────────── */}
            <Module
              span="full"
              eyebrow="Pipeline"
              title="Angebote · Geld in der Mache"
              moreLabel="Alle ansehen"
              moreTo="/admin/angebote"
              hint="Übersicht aller offenen Vorgänge in den 6 Stufen. Die Zahl in jeder Stufe = wie viele Karten gerade dort liegen. Klick auf 'Alle ansehen' öffnet das Kanban-Board."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2">
                {(() => {
                  // Aktive Stage = die mit den meisten Karten, "Abgerechnet" ausgenommen
                  const stages = ["Anfrage","Angebot","Versendet","Auftrag","In Arbeit"] as const;
                  let active: string = "";
                  let max = -1;
                  for (const s of stages) {
                    const v = stageCount(s);
                    if (v > max) { max = v; active = s; }
                  }
                  if (max <= 0) active = "";
                  return (
                    <div className="flex items-stretch border border-white/10 rounded-lg overflow-hidden shadow-[0_8px_22px_-12px_rgba(0,0,0,.6)]">
                      <PipeStage label="Anfrage"     value={stageCount("Anfrage")}     active={active === "Anfrage"} />
                      <PipeStage label="Angebot"     value={stageCount("Angebot")}     active={active === "Angebot"} />
                      <PipeStage label="Versendet"   value={stageCount("Versendet")}   active={active === "Versendet"} />
                      <PipeStage label="Auftrag"     value={stageCount("Auftrag")}     active={active === "Auftrag"} />
                      <PipeStage label="In Arbeit"   value={stageCount("In Arbeit")}   active={active === "In Arbeit"} />
                      <PipeStage label="Abgerechnet" value={stageCount("Abgerechnet")} />
                    </div>
                  );
                })()}
                <div className="mt-3 flex justify-between items-center flex-wrap gap-3 font-mono text-[11.5px] tracking-wide text-ink-2">
                  <span>
                    Σ in der Pipeline ~
                    <b className="font-display font-black text-base text-ink ml-1">{fmtEur(pipelineValue)}</b>
                    <span className="text-ink-mute"> · </span>
                    <b className="font-display font-black text-base text-ink">{cards.length}</b> Vorgänge
                  </span>
                  {versendetOverdue > 0 && (
                    <span className="text-rust font-bold">
                      <b className="font-display font-black text-base">{versendetOverdue}</b> Angebot{versendetOverdue === 1 ? "" : "e"} länger als 7 Tage ohne Antwort
                    </span>
                  )}
                </div>
              </div>
            </Module>

            {/* ── BELEGSCHAFT · 1/3 ──────────────────────────────────────── */}
            <Module
              span="third"
              eyebrow="Belegschaft"
              title="Heute auf der Baustelle"
              moreLabel="Zeiterfassung →"
              moreTo="/admin/zeiterfassung"
              hint="Wer ist heute wo. Live aktualisiert aus den Tageseinträgen — kein Eintrag bedeutet 'kein Plan heute'."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2 space-y-2">
                {loading ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Lädt …</div>
                ) : todayLive.length === 0 ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Kein Mitarbeiter im Team</div>
                ) : todayLive.map((row) => (
                  <CrewRow key={row.worker.id} row={row} />
                ))}
              </div>
            </Module>

            {/* ── BAUSTELLEN · 1/3 ───────────────────────────────────────── */}
            <Module
              span="third"
              eyebrow="Baustellen"
              title={`${activeSites.length} aktiv${restingSites.length > 0 ? " · " + restingSites.length + " ruht" : ""}`}
              moreLabel="Alle →"
              moreTo="/admin/sites"
              hint="Aktive Baustellen sind die, auf denen diese Woche Stunden gebucht wurden. 'Ruht' = im System, aber gerade kein Mitarbeiter dran."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2 space-y-2">
                {loading ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Lädt …</div>
                ) : sites.slice(0, 4).length === 0 ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Noch keine Baustellen</div>
                ) : sites.slice(0, 4).map((s) => {
                  const active = activeSiteIds.has(s.id);
                  return (
                    <Link
                      key={s.id}
                      to={`/admin/sites/${s.id}`}
                      className="flex items-center justify-between gap-3 py-1.5 border-b border-ink/8 last:border-0 hover:bg-bg-2/40 -mx-1 px-1 rounded"
                    >
                      <div className="min-w-0">
                        {s.projectNumber && (
                          <div className="font-mono text-[10px] tracking-wider text-copper leading-none">Auftrag {s.projectNumber}</div>
                        )}
                        <div className="text-[13px] font-bold text-ink truncate mt-0.5">{s.name}</div>
                        <div className="font-mono text-[10px] tracking-wide text-ink-mute uppercase mt-0.5 truncate">{s.city || s.street || "Adresse offen"}</div>
                      </div>
                      <span className={`font-mono text-[10px] tracking-wider px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 ${
                        active ? "bg-good/15 text-good" : "bg-bg-3 text-ink-mute"
                      }`}>
                        {active ? "aktiv" : "ruht"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Module>

            {/* ── FINANZEN · 1/3 · Stub mit echtem Frame ──────────────────── */}
            <Module
              span="third"
              eyebrow="Finanzen"
              title="Geld diese Woche"
              moreLabel="sevDesk ↗"
              moreTo="/admin/angebote"
              hint="Drei Zahlen auf einen Blick: bereits berechnet, schon raus aber noch nicht bezahlt, und insgesamt in der Mache. Werte stammen aus sevDesk."
            >
              <div className="px-4 lg:px-5 pb-4 pt-3 grid grid-cols-3 gap-3">
                <Kpi label="abgerechnet KW" value={fmtEur(sumStage("Abgerechnet"))} tone="good" />
                <Kpi label="offen brutto" value={fmtEur(sumStage("Versendet") + sumStage("Angebot"))} />
                <Kpi label="Σ Pipeline" value={fmtEur(pipelineValue)} tone="copper" />
                <div className="col-span-3 font-mono text-[10.5px] tracking-wider text-ink-mute uppercase pt-2 border-t border-ink/8">
                  Zahlen aus sevDesk-Pipeline · Mahnungs-Modul folgt
                </div>
              </div>
            </Module>

            {/* ── ANFRAGEN-INBOX · 1/2 ────────────────────────────────────── */}
            <Module
              span="half"
              eyebrow="Inbox · Vertrieb"
              title={inquiries.length === 0
                ? "Inbox leer"
                : `${inquiries.length} offene Anfrage${inquiries.length === 1 ? "" : "n"}`}
              moreLabel="Alle Anfragen →"
              moreTo="/admin/anfragen"
              hint="Neue Kundenanfragen, die du noch nicht beantwortet hast. KI macht aus rohem Mail-/WhatsApp-Text strukturierte Felder. Roter Strich = hohe Priorität."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2 space-y-2">
                {loading ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Lädt …</div>
                ) : inquiries.length === 0 ? (
                  <div className="text-center py-5">
                    <div className="font-display font-black uppercase text-[15px] text-good tracking-tight">✓ alle bearbeitet</div>
                    <div className="font-mono text-[10.5px] tracking-wider text-ink-mute uppercase mt-1.5 mb-3">
                      keine offenen Anfragen
                    </div>
                    <Link to="/admin/anfrage-neu" className="btn-ghost !min-h-[36px] !px-3 text-[11px] inline-flex items-center">
                      ＋ Anfrage einfügen
                    </Link>
                  </div>
                ) : (
                  <>
                    {inquiries.slice(0, 4).map((i) => {
                      const prioColor = i.priority === "hoch" ? "#B91C1C" : i.priority === "niedrig" ? "#9CA3AF" : "#6A6E72";
                      const status = i.status === "in_arbeit" ? "in Arbeit" : "offen";
                      return (
                        <Link
                          key={i.id}
                          to="/admin/anfragen"
                          className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-bg-2 transition-colors"
                        >
                          <span className="w-1 h-10 rounded-sm flex-shrink-0 mt-0.5" style={{ background: prioColor }} />
                          <div className="flex-1 min-w-0">
                            <div className="font-sans font-bold text-[13px] text-ink truncate">
                              {i.customerName || <span className="italic text-ink-2">ohne Namen</span>}
                            </div>
                            <div className="font-mono text-[10px] text-ink-2 truncate">
                              {status} · {i.source} · {new Date(i.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                              {i.city && ` · ${i.city}`}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                    {inquiries.length > 4 && (
                      <div className="font-mono text-[10.5px] text-ink-mute text-center pt-1">
                        … und {inquiries.length - 4} weitere
                      </div>
                    )}
                  </>
                )}
              </div>
            </Module>

            {/* ── HEUTE ZU TUN · 1/2 ──────────────────────────────────────── */}
            <Module
              span="half"
              eyebrow="Heute zu tun"
              title={`${actions.length} Sache${actions.length === 1 ? "" : "n"} warten auf dich`}
              moreLabel="Alle Aktionen →"
              moreTo="/admin/angebote"
              hint="Automatisch erkannte 'Du-musst-was-tun'-Punkte: fehlende Stunden, Angebote zur Freigabe, überfällige Nachfass-Mails, unvollständige Adressen. Klick auf eine Zeile springt direkt zur Lösung."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2 space-y-2">
                {loading ? (
                  <div className="font-mono text-[11px] text-ink-mute text-center py-4">Lädt …</div>
                ) : actions.length === 0 ? (
                  <div className="text-center py-6">
                    <div className="font-display font-black uppercase text-base text-good tracking-tight">✓ Inbox leer</div>
                    <div className="font-mono text-[10.5px] tracking-wider text-ink-mute uppercase mt-1.5">
                      keine offenen Aktionen · Kaffee verdient
                    </div>
                  </div>
                ) : actions.map((a, i) => (
                  <ActionRow key={i} action={a} />
                ))}
              </div>
            </Module>

            {/* ── STUNDEN-SNAPSHOT · 1/4 ──────────────────────────────────── */}
            <Module
              span="quarter"
              eyebrow="Stunden"
              title={`KW ${week} · Snapshot`}
              moreLabel="Zeiterfassung →"
              moreTo="/admin/zeiterfassung"
              hint="Schnell-Zahlen zur aktuellen Woche: bisher gebuchte Stunden, wer gerade live arbeitet, wie viele Lücken im Wochenplan sind."
            >
              <div className="px-4 lg:px-5 pb-4 pt-3 grid grid-cols-3 gap-3">
                <Kpi label={`Σ bis ${todayShort(today)}`} value={`${fmtHours(weekMinutesAll)} h`} />
                <Kpi label="aktiv jetzt" value={`${liveCount}${plannedCount > 0 ? ` / ${liveCount + plannedCount}` : ""}`} tone="good" />
                <Kpi label="Lücken" value={String(gaps)} tone={gaps > 0 ? "rust" : "neutral"} />
              </div>
            </Module>

            {/* ── WETTER · 1/4 · live via Buienradar ──────────────────────── */}
            <LiveWeatherModule />
            {/* end Wetter */}

            {/* ── TERMINE · 1/2 ───────────────────────────────────────────── */}
            <Module
              span="half"
              eyebrow="Termine"
              title="Diese Woche"
              moreLabel="Kalender ↗"
              hint="Materiallieferungen, Aufmaß-Termine, Behördentermine. Anbindung an einen echten Kalender (Google/iCloud) folgt."
            >
              <div className="px-4 lg:px-5 pb-4 pt-2 space-y-2">
                <DateRow when="Fr 22.05. · 08:00" what="Materiallieferung Borgmann" where="Bunde · Hauptstr. 17" />
                <DateRow when="Mo 25.05. · 14:00" what="Aufmaß Diakoniestation" where="Weener" />
                <div className="font-mono text-[10px] tracking-wider text-ink-mute uppercase pt-2 border-t border-ink/8">
                  Platzhalter · Kalender-Modul folgt
                </div>
              </div>
            </Module>
          </div>

          {/* QUICK-AKTION: Mitarbeiter einladen */}
          <div className="mt-7 pt-5 border-t border-ink/10 flex items-center justify-between gap-4 flex-wrap">
            <p className="font-mono text-[11.5px] tracking-wide text-ink-mute uppercase">
              {team.length} Mitarbeiter im Team · {team.filter((w) => !w.linked).length} ohne Verknüpfung
            </p>
            <button
              onClick={() => { setPreselectWorker(null); setShowInvite(true); }}
              className="btn-ghost !min-h-[44px] !px-5 text-[12px]"
            >
              ＋ Mitarbeiter einladen
            </button>
          </div>
          </div>{/* /Module-Grid-Wrapper */}
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
          workers={workers}
          onClose={() => setShowWorkers(false)}
          onUpdated={(updated) => {
            setWorkers((prev) => prev.map((w) => w.id === updated.id ? updated : w));
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

/* ──────── kleine Building-Blocks ──────── */

function SbItem({ icon, label, active, disabled, onClick, to, hint }: {
  icon: string; label: string; active?: boolean; disabled?: boolean;
  onClick?: () => void; to?: string; hint?: string;
}) {
  // Größer, fetter, gut lesbar im Sidebar-Kontext — Display-Schrift wie das
  // Logo, klare Hierarchie zwischen aktivem und inaktivem Item.
  const cls = `flex items-center gap-3 px-3 py-3 rounded-lg text-left font-display font-black uppercase text-[15px] tracking-[0.04em] leading-none transition-colors ${
    active ? "bg-copper/22 text-copper-bright"
    : disabled ? "text-white/30 cursor-not-allowed"
    : "text-white/70 hover:bg-white/5 hover:text-white"
  }`;
  const content = (
    <>
      <span className="w-5 text-center text-[17px] leading-none flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}><InfoTip text={hint} placement="right" tone="light" size={16} /></span>}
      {disabled && <span className="ml-auto font-mono text-[9px] text-white/25 lowercase tracking-wider">bald</span>}
    </>
  );
  // KEIN title-Attribut — InfoTip im content macht das schon, sonst doppeltes Fenster
  if (to && !disabled) return <Link to={to} className={cls}>{content}</Link>;
  return <button onClick={onClick} disabled={disabled} className={cls}>{content}</button>;
}

function Module({ span, eyebrow, title, moreLabel, moreTo, hint, children }: {
  span: "full" | "half" | "third" | "quarter";
  eyebrow: string; title: string;
  moreLabel?: string; moreTo?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const spanCls =
    span === "full"    ? "col-span-12" :
    span === "half"    ? "col-span-12 lg:col-span-6" :
    span === "third"   ? "col-span-12 sm:col-span-6 lg:col-span-4" :
    /* quarter */        "col-span-12 sm:col-span-6 lg:col-span-3";
  return (
    <section
      className={`${spanCls} dd-card overflow-hidden shadow-[0_2px_8px_rgba(15,17,20,0.06),0_8px_24px_rgba(15,17,20,0.04)] hover:shadow-[0_4px_12px_rgba(15,17,20,0.10),0_12px_32px_rgba(15,17,20,0.06)] transition-shadow duration-200`}
      style={{ ["--c" as any]: "#DC6E2D" }}
    >
      <header className="px-4 lg:px-5 pt-3.5 pb-2.5 flex items-end justify-between gap-3 border-b border-ink/8 relative">
        <div className="min-w-0">
          <div className="dd-eyebrow text-copper flex items-center">
            {eyebrow}
            {hint && <InfoTip text={hint} placement="bottom" tone="copper" />}
          </div>
          <h3 className="font-display font-black uppercase text-[17px] tracking-tight text-ink leading-none mt-1 truncate">{title}</h3>
        </div>
        {moreLabel && (moreTo
          ? <Link to={moreTo} className="font-mono text-[10.5px] tracking-wider text-ink-2 hover:text-copper uppercase whitespace-nowrap">{moreLabel}</Link>
          : <span className="font-mono text-[10.5px] tracking-wider text-ink-mute uppercase whitespace-nowrap">{moreLabel}</span>
        )}
        {/* Kupfer-Akzentstreifen unten am Header */}
        <span aria-hidden className="absolute left-0 right-0 bottom-0 h-[1.5px] bg-gradient-to-r from-copper via-copper to-transparent opacity-50" />
      </header>
      {children}
    </section>
  );
}

/* Pipeline-Stage · K1 Stahl-Skala (dunkle Header-Variante).
 * Grauverlauf vom hellsten Stahl (Anfrage) bis tiefen Anthrazit (Abgerechnet),
 * die aktive Stage wird in Kupfer hervorgehoben. */
const K1_STAGE_BG: Record<string, string> = {
  "Anfrage":     "#2B2E31",
  "Angebot":     "#363A3D",
  "Versendet":   "#42464A",
  "Auftrag":     "#4E5359",
  "In Arbeit":   "#5B5F64",
  "Abgerechnet": "#686D72",
};

function PipeStage({ label, value, active = false }: { label: string; value: number; active?: boolean }) {
  const bg = active ? "#DC6E2D" : K1_STAGE_BG[label] ?? "#42464A";
  const fg = active ? "#FFFFFF" : "#E7E9EB";
  const labelTone = active ? "rgba(255,255,255,0.85)" : "rgba(231,233,235,0.6)";
  const hint = STAGE_HINT[label];
  return (
    <div
      className="flex-1 px-3 py-3 border-r border-white/10 last:border-0 transition-colors relative"
      style={{ background: bg }}
    >
      <div className="font-mono text-[9.5px] tracking-wider uppercase flex items-center leading-none" style={{ color: labelTone }}>
        {label}
        {hint && <InfoTip text={hint} placement="bottom" tone="light" size={14} />}
      </div>
      <div className="font-display font-black text-2xl leading-none tabular-nums mt-1.5" style={{ color: fg }}>
        {String(value).padStart(2, "0")}
      </div>
      {active && (
        <span aria-hidden className="absolute left-0 right-0 bottom-0 h-[2px] bg-copper-bright" />
      )}
    </div>
  );
}

function CrewRow({ row }: { row: { worker: Worker; site?: Site; status: "live" | "vacation" | "sick" | "planned" | "off" } }) {
  const { worker: w, site, status } = row;
  const colorRing = status === "live" ? "border-good"
                  : status === "vacation" ? "border-moss"
                  : status === "sick" ? "border-rust"
                  : status === "planned" ? "border-copper" : "border-steel-line";
  const label = status === "live"      ? site?.name ?? "auf der Baustelle"
              : status === "vacation"  ? "Urlaub"
              : status === "sick"      ? "Krank"
              : status === "planned"   ? `geplant: ${site?.name ?? "Baustelle"}`
              :                          "kein Plan heute";
  const tone  = status === "live"      ? "text-good"
              : status === "vacation"  ? "text-moss-bright"
              : status === "sick"      ? "text-rust"
              : status === "planned"   ? "text-copper" : "text-ink-mute";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className={`w-9 h-9 rounded-full bg-bg-deep text-copper-bright font-display font-black text-[11px] flex items-center justify-center border-2 ${colorRing}`}>
        {w.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink truncate">{w.firstName} {w.lastName.charAt(0)}.</div>
        <div className={`font-mono text-[10px] tracking-wider uppercase mt-0.5 truncate ${tone}`}>{label}</div>
      </div>
    </div>
  );
}

function ActionRow({ action }: { action: { kind: string; severity: "r" | "c" | "g"; title: string; sub: string; href?: string } }) {
  const dotCls = action.severity === "r" ? "bg-rust"
              : action.severity === "g" ? "bg-good"
              : "bg-copper";
  const inner = (
    <div className="flex items-start gap-3 py-2 border-b border-ink/8 last:border-0">
      <span className={`w-2 h-2 rounded-full ${dotCls} mt-1.5 flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink leading-snug">{action.title}</div>
        <div className="text-[11.5px] text-ink-body leading-snug mt-0.5">{action.sub}</div>
      </div>
      {action.href && <span className="font-mono text-[10px] tracking-wider text-copper uppercase font-bold whitespace-nowrap self-center">→</span>}
    </div>
  );
  return action.href
    ? <Link to={action.href} className="block hover:bg-bg-2/40 -mx-1 px-1 rounded">{inner}</Link>
    : inner;
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "copper" | "rust" }) {
  const fg = tone === "good" ? "text-good" : tone === "copper" ? "text-copper" : tone === "rust" ? "text-rust" : "text-ink";
  return (
    <div>
      <div className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase">{label}</div>
      <div className={`font-display font-black text-xl leading-none tabular-nums mt-1 ${fg}`}>{value}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   LiveWeatherModule · Buienradar-API für Weener / Leuschner
   ──────────────────────────────────────────────────────────────────────
   Holt /api/weather (Cloudflare-Function proxiet Buienradar), zeigt
   heute prominent + 3 Folge-Tage. Loading + Error sind explizit. */

interface WeatherCurrent {
  temperature: number; feelsLike: number;
  windSpeed: number; windBft: number; windDirection: string;
  humidity: number; precipitation: number;
  weather: string; emoji: string; iconCode: string;
  timestamp: string;
}
interface WeatherDayItem {
  date: string; minT: number; maxT: number;
  rainChance: number; sunChance: number; windBft: number; windDirection: string;
  rainMmMin: number; rainMmMax: number;
  weather: string; emoji: string; iconCode: string;
}
interface WeatherPayload {
  station: { name: string; lat: number; lng: number; distanceKm: number };
  current: WeatherCurrent;
  forecast: WeatherDayItem[];
  summary: string;
  fetchedAt: string;
}

function LiveWeatherModule() {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/weather?lat=53.17&lng=7.36")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d as WeatherPayload); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  const dayLabel = (iso: string, idx: number): string => {
    if (idx === 0) return "Heute";
    if (idx === 1) return "Morgen";
    const d = new Date(iso);
    const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    return names[d.getDay()];
  };

  return (
    <Module
      span="quarter"
      eyebrow={data?.station ? `Wetter · ${data.station.name}` : "Wetter · Weener"}
      title="Aktuell + 3 Tage"
      moreLabel="Buienradar ↗"
      hint="Live-Wetter via Buienradar. Station-Wahl: nächstgelegene NL-Grenzstation (Nieuw Beerta ist die nächste zu Weener)."
    >
      {error && !data && (
        <div className="px-4 lg:px-5 pb-4 pt-3 text-[12px] text-rust font-mono">
          Wetter-API nicht erreichbar ({error})
        </div>
      )}
      {!data && !error && (
        <div className="px-4 lg:px-5 pb-4 pt-3 text-[12px] text-ink-mute font-mono">
          Lade Buienradar …
        </div>
      )}
      {data && (
        <>
          {/* Aktuell prominent */}
          <div className="px-4 lg:px-5 pt-3 pb-2 flex items-center gap-3">
            <span className="text-3xl leading-none" title={data.current.weather}>{data.current.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="font-display font-black text-2xl leading-none tabular-nums">
                {Math.round(data.current.temperature)}°
                <span className="text-[12px] text-ink-mute font-mono ml-1.5">gefühlt {Math.round(data.current.feelsLike)}°</span>
              </div>
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-mute mt-0.5 truncate">
                {data.current.weather} · Wind {data.current.windDirection} {data.current.windBft} Bft
              </div>
            </div>
          </div>

          {/* 3-Tage-Forecast (Skip Index 0 = heute, der ist schon oben) */}
          <div className="px-4 lg:px-5 pb-3 pt-2 flex gap-2">
            {data.forecast.slice(0, 4).map((day, idx) => (
              <WeatherDay
                key={day.date}
                d={dayLabel(day.date, idx)}
                t={`${Math.round(day.minT)}/${Math.round(day.maxT)}°`}
                icon={day.emoji}
                sub={day.rainChance >= 30 ? `${day.rainChance}% Regen` : day.weather.length > 14 ? day.weather.slice(0, 12) + "…" : day.weather}
                today={idx === 0}
              />
            ))}
          </div>

          <div className="px-4 lg:px-5 pb-3 -mt-1 font-mono text-[10px] tracking-wider text-ink-mute uppercase">
            Quelle Buienradar · {data.station.name} ({data.station.distanceKm} km) · {new Date(data.current.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
          </div>
        </>
      )}
    </Module>
  );
}

function WeatherDay({ d, t, icon, sub, today: isToday }: { d: string; t: string; icon: string; sub: string; today?: boolean }) {
  return (
    <div className={`flex-1 text-center py-2 rounded-md border ${isToday ? "border-copper bg-copper/8" : "border-steel-line/40 bg-bg-3/40"}`}>
      <div className={`font-mono text-[9.5px] tracking-wider uppercase ${isToday ? "text-copper font-bold" : "text-ink-mute"}`}>{d}</div>
      <div className="text-xl mt-1 leading-none" style={{ color: isToday ? "#DC6E2D" : "#3E7196" }}>{icon}</div>
      <div className="font-display font-black text-base tabular-nums mt-1 leading-none">{t}</div>
      <div className="font-mono text-[9px] tracking-wide uppercase text-ink-mute mt-1">{sub}</div>
    </div>
  );
}

function DateRow({ when, what, where }: { when: string; what: string; where: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-ink/8 last:border-0">
      <span className="w-2 h-2 rounded-full bg-copper mt-1.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink leading-snug">{what}</div>
        <div className="font-mono text-[10px] tracking-wider text-ink-mute uppercase mt-0.5">{when} · {where}</div>
      </div>
    </div>
  );
}

/* ──────── Helpers ──────── */

function fmtEur(n: number): string {
  if (!n || n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k €`;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

function todayShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
}

/* ────────────────────────────────────────────────────────────────────────
   Modals (unverändert aus Vorgänger-Admin, nur Imports angepasst)
   ──────────────────────────────────────────────────────────────────────── */

function WorkersModal({ workers, onClose, onUpdated, onInvite }: {
  workers: Worker[]; onClose: () => void;
  onUpdated: (w: Worker) => void; onInvite: (w: Worker) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-4">
          <span className="dd-eyebrow text-copper">Mitarbeiter · {workers.length}</span>
          <button onClick={onClose} className="dd-eyebrow text-ink-2">Schließen</button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl mb-5">Stamm-Daten</h2>
        <ul className="space-y-2">
          {workers.map((w) => (
            <WorkerRow key={w.id} worker={w} onUpdated={onUpdated} onInvite={() => onInvite(w)} />
          ))}
        </ul>
        <p className="dd-eyebrow text-ink-mute mt-5 text-center leading-relaxed">
          Telefon für WhatsApp-Code · Verknüpft = auf Gerät angemeldet
        </p>
      </div>
    </div>
  );
}

function WorkerRow({ worker, onUpdated, onInvite }: {
  worker: Worker; onUpdated: (w: Worker) => void; onInvite: () => void;
}) {
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      await updateWorkerPhone(worker.id, phone.trim() || null);
      onUpdated({ ...worker, phone: phone.trim() || undefined });
      setEditing(false);
    } catch (err: any) { setError(err?.message ?? "Speichern fehlgeschlagen"); }
    finally { setSaving(false); }
  }

  async function unlink() {
    if (!confirm(`Verknüpfung von ${worker.firstName} ${worker.lastName} lösen?`)) return;
    setUnlinking(true); setError(null);
    try {
      await unlinkWorker(worker.id);
      onUpdated({ ...worker, linked: false });
    } catch (err: any) { setError(err?.message ?? "Lösen fehlgeschlagen"); }
    finally { setUnlinking(false); }
  }

  return (
    <li className="bg-bg-3 rounded-xl p-3.5">
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center font-display font-black text-base flex-shrink-0 ${
          worker.isAdmin ? "bg-gradient-to-br from-copper-bright to-copper text-bg-deep" : "bg-bg-4 text-copper-bright"
        }`}>{worker.initials}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-bold text-[14px]">{worker.firstName} {worker.lastName}</div>
            {worker.isAdmin && <span className="dd-eyebrow text-copper">ADMIN</span>}
            {worker.linked
              ? <span className="dd-eyebrow text-good">● VERKNÜPFT</span>
              : !worker.isAdmin && <span className="dd-eyebrow text-ink-mute">○ OFFEN</span>}
          </div>
          <div className="dd-eyebrow text-ink-2 mt-0.5">{worker.role}</div>
        </div>
        {!worker.isAdmin && !worker.linked && (
          <button onClick={onInvite} className="dd-eyebrow text-copper hover:underline whitespace-nowrap">📱 Code →</button>
        )}
        {!worker.isAdmin && worker.linked && (
          <button onClick={unlink} disabled={unlinking}
                  className="dd-eyebrow text-rust hover:underline whitespace-nowrap disabled:opacity-50">
            {unlinking ? "Lösche …" : "× Verknüpfung lösen"}
          </button>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-ink/10">
        <div className="flex items-center gap-2">
          <span className="dd-eyebrow text-copper flex-shrink-0">TEL</span>
          {editing ? (
            <>
              <input type="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
                     placeholder="+49 1520 …"
                     className="flex-1 bg-bg-2 border border-copper/40 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:border-copper font-mono" />
              <button onClick={save} disabled={saving} className="dd-eyebrow text-copper px-2 py-1 disabled:opacity-50">{saving ? "…" : "OK"}</button>
              <button onClick={() => { setPhone(worker.phone ?? ""); setEditing(false); setError(null); }} className="dd-eyebrow text-ink-2 px-2 py-1">✕</button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[13px] font-mono text-ink-body">
                {worker.phone || <span className="text-ink-mute italic">nicht hinterlegt</span>}
              </span>
              <button onClick={() => setEditing(true)} className="dd-eyebrow text-copper hover:underline">Bearbeiten</button>
            </>
          )}
        </div>
        {error && <p className="text-rust text-[11px] mt-1">{error}</p>}
      </div>
    </li>
  );
}

function InviteModal({ team, preselect, onClose }: { team: Worker[]; preselect: Worker | null; onClose: () => void; }) {
  const [worker, setWorker] = useState<Worker | null>(preselect ?? team[0] ?? null);
  const [code, setCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) { setQrDataUrl(null); return; }
    const url = window.location.origin + "/onboarding?code=" + code;
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", width: 480, margin: 1, color: { dark: "#000000", light: "#FFFFFF" } })
      .then(setQrDataUrl)
      .catch((err) => console.error("[invite] QR generation failed", err));
  }, [code]);

  async function generate() {
    if (!worker) return;
    setLoading(true); setError(null);
    try { setCode(await createInvitation(worker.id)); }
    catch (err: any) { setError(err?.message ?? "Code-Erzeugung fehlgeschlagen"); }
    finally { setLoading(false); }
  }

  function whatsAppUrl(): string {
    if (!worker) return "https://wa.me/";
    const appUrl = window.location.origin + "/onboarding?code=" + (code ?? "");
    const msg = `👋 Moin ${worker.firstName}!%0A%0AHier dein Anmelde-Code für die Leuschner-App:%0A%0A*${code}*%0A%0AApp öffnen:%0A${encodeURIComponent(appUrl)}%0A%0ACode ist 24 h gültig.`;
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    return cleanPhone ? `https://wa.me/${cleanPhone}?text=${msg}` : `https://wa.me/?text=${msg}`;
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-4">
          <span className="dd-eyebrow text-copper">Mitarbeiter einladen</span>
          <button onClick={onClose} className="dd-eyebrow text-ink-2">Schließen</button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl mb-4">Wer wird eingeladen?</h2>
        {team.length === 0 ? (
          <div className="bg-bg-3 rounded-xl p-5 text-center">
            <p className="dd-eyebrow text-ink-2">Mitarbeiter wird geladen …</p>
          </div>
        ) : (
          <div className="space-y-1.5 mb-5 max-h-48 overflow-y-auto">
            {team.map((w) => (
              <button key={w.id} onClick={() => { setCode(null); setWorker(w); }}
                      className={`w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 ${
                worker && w.id === worker.id ? "bg-copper/15 border border-copper" : "bg-bg-3 border border-transparent"
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-display font-black text-xs ${
                  worker && w.id === worker.id ? "bg-copper text-bg-deep" : "bg-bg-4 text-copper-bright"
                }`}>{w.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{w.firstName} {w.lastName}</div>
                  <div className="dd-eyebrow text-ink-2">{w.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {worker && !code ? (
          <button onClick={generate} disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? "Erzeuge Code …" : `Code für ${worker.firstName} erzeugen`}
          </button>
        ) : code ? (
          <div className="space-y-4">
            <div className="bg-bg-DEFAULT border-2 border-copper rounded-xl p-5 text-center">
              <div className="dd-eyebrow text-copper mb-3">QR-Code · scannen mit iPhone-Kamera</div>
              {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="mx-auto w-64 h-64 rounded-lg" />
                         : <div className="w-64 h-64 mx-auto bg-bg-2 rounded-lg flex items-center justify-center text-ink-2">QR …</div>}
              <div className="dd-eyebrow text-ink-2 mt-3">oder Code manuell eingeben</div>
              <div className="font-mono font-bold text-2xl tracking-widest mt-1.5">{code}</div>
              <div className="dd-eyebrow text-ink-mute mt-2">24 Stunden gültig</div>
            </div>
            <details className="bg-bg-3 rounded-xl">
              <summary className="px-4 py-3 cursor-pointer dd-eyebrow text-copper">Per WhatsApp schicken</summary>
              <div className="px-4 pb-4 pt-2 space-y-3">
                <input type="tel" placeholder="+49 152 …" value={phone} onChange={(e) => setPhone(e.target.value)}
                       className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper" />
                <a href={whatsAppUrl()} target="_blank" rel="noopener"
                   className="block text-center w-full px-4 py-2.5 rounded-lg bg-[#25D366] text-bg-deep font-bold text-[13px]">
                  📱 Per WhatsApp senden
                </a>
              </div>
            </details>
          </div>
        ) : null}
        {error && <p className="text-rust text-[11px] mt-3">{error}</p>}
      </div>
    </div>
  );
}
