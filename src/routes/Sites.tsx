import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  archiveSite, createSite, listAllSites, unarchiveSite, updateSite,
  listAllEntries, listAssignmentsForCompany, listWorkers
} from "../lib/api";
import { listCards } from "../lib/pipeline";
import { listInquiries, type Inquiry } from "../lib/inquiries";
import { supabase } from "../lib/supabase";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import {
  withTimeout, todayIso, isoWeek, weekDays, dayName, shortDate
} from "../lib/utils";
import SiteEditor from "../components/SiteEditor";
import BackButton from "../components/BackButton";
import { DISCIPLINE_LABEL, isWorkEntry } from "../lib/types";
import type { Site, Worker, Assignment, Entry } from "../lib/types";

type SiteRow = Site & { archived?: boolean };

/** Kanban-Spalten = Aktivitäts-Status, abgeleitet aus echten Daten
 *  (heutige Ist-Stunden + veröffentlichter Wochenplan). Baustellen tragen
 *  selbst KEINEN Status-Wert — deshalb wird hier nicht gezogen/verschoben,
 *  sondern der Status folgt automatisch dem Wochenplan.
 *  "anfrage" = eigene Spalte für Baustellen mit verknüpfter offener Anfrage. */
type ColKey = "anfrage" | "heute" | "woche" | "aktiv";

const COLUMNS: { key: ColKey; label: string; color: string; hint: string }[] = [
  { key: "anfrage", label: "Anfragebaustellen",   color: "#DC6E2D", hint: "aus Anfrage angelegt · Angebot noch offen" },
  { key: "heute",   label: "Heute vor Ort",        color: "#DC6E2D", hint: "Mitarbeiter heute auf der Baustelle" },
  { key: "woche",   label: "Diese Woche geplant",  color: "#1F7A3D", hint: "im Wochenplan eingetragen" },
  { key: "aktiv",   label: "Aktiv",                color: "#8B9197", hint: "angelegt · derzeit kein Einsatz" },
];

/** Sortier-Optionen (Favoriten bleiben immer oben gepinnt). */
type SortKey = "az" | "za" | "ort" | "auftrag";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "az",      label: "Name A–Z" },
  { key: "za",      label: "Name Z–A" },
  { key: "ort",     label: "Ort A–Z" },
  { key: "auftrag", label: "Auftragsnr." },
];

const SORT_FNS: Record<SortKey, (a: SiteRow, b: SiteRow) => number> = {
  az:  (a, b) => a.name.localeCompare(b.name, "de"),
  za:  (a, b) => b.name.localeCompare(a.name, "de"),
  ort: (a, b) =>
    (a.city || "").localeCompare(b.city || "", "de") ||
    a.name.localeCompare(b.name, "de"),
  auftrag: (a, b) =>
    (a.projectNumber || "~").localeCompare(b.projectNumber || "~", "de", { numeric: true }) ||
    a.name.localeCompare(b.name, "de"),
};

/** Abgeleiteter Zustand einer Baustelle für das Board. */
type Activity = {
  status: ColKey;
  todayCrew: Worker[];     // wer heute hier ist/war (Ist + geplant)
  nextDay?: string;        // nächster geplanter Tag (ISO) ab heute, diese Woche
  weekDaysCount: number;   // Anzahl geplanter Tage in dieser Woche
};

export default function Sites() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [sortBy, setSortBy] = useState<SortKey>("az");
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [inquiryBySite, setInquiryBySite] = useState<Record<string, Inquiry>>({});

  // Verhindert, dass ein langsamer (z. B. tokenloser) Fetch ein neueres,
  // volles Ergebnis überschreibt: nur das Resultat des jüngsten Aufrufs zählt.
  const reqSeq = useRef(0);

  async function refresh() {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Token VOR dem Laden sicherstellen/erneuern. Ohne gültiges Token liefert
      // RLS eine leere Liste OHNE Fehler — die Baustellen blieben dann leer, bis
      // man die Seite manuell neu lädt. getSession() erneuert ein abgelaufenes
      // Token automatisch, solange der Refresh-Token gültig ist.
      if (supabase) await supabase.auth.getSession();
      const today = todayIso();
      const { year, week } = isoWeek(new Date());
      const days = weekDays(year, week);
      // Baustellen sind Pflicht; Aktivitäts-Daten sind „nice to have" — fällt
      // eine Quelle aus, landet die Baustelle einfach in „Aktiv" statt das
      // ganze Board zu blockieren.
      const [data, ents, asgs, wks, cards, inqs] = await Promise.all([
        withTimeout(listAllSites(true), 8000, "Baustellen"),
        listAllEntries(today, today).catch(() => [] as Entry[]),
        listAssignmentsForCompany(days[0], days[days.length - 1]).catch(() => [] as Assignment[]),
        listWorkers().catch(() => [] as Worker[]),
        listCards().catch(() => []),
        listInquiries({ onlyOpen: true }).catch(() => [] as Inquiry[]),
      ]);
      if (seq !== reqSeq.current) return; // ein neuerer Refresh ist unterwegs
      setSites(data);
      setEntries(ents);
      setAssignments(asgs);
      setWorkers(wks);
      // Anfragen-Map: siteId → Inquiry (über Karte als Zwischenschritt)
      const cardBySiteId = new Map(cards.filter((c) => c.siteId).map((c) => [c.siteId!, c]));
      const inqByCardId = new Map(inqs.filter((i) => i.pipelineCardId).map((i) => [i.pipelineCardId!, i]));
      const ibySite: Record<string, Inquiry> = {};
      for (const [siteId, card] of cardBySiteId) {
        const inq = inqByCardId.get(card.id);
        if (inq) ibySite[siteId] = inq;
      }
      setInquiryBySite(ibySite);
    } catch (err: any) {
      if (seq !== reqSeq.current) return;
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Echtzeit-Updates: Baustellen-Stammdaten + Planung + Ist-Stunden — so wandert
  // eine Baustelle automatisch nach „Heute vor Ort", sobald die Crew eincheckt.
  useRealtime("sites-admin", ["sites", "assignments", "entries"], refresh);
  useRefreshOnVisible(refresh);
  // Auth-Session war beim ersten Fetch evtl. noch nicht da → nachladen, sobald sie kommt
  useRefreshOnAuth(refresh);

  const today = todayIso();

  const workersById = useMemo(() => {
    const m = new Map<string, Worker>();
    for (const w of workers) m.set(w.id, w);
    return m;
  }, [workers]);

  // Aktivitäts-Status je Baustelle aus Ist-Stunden + Wochenplan ableiten.
  const activityBySite = useMemo(() => {
    const todayCrewIds = new Map<string, Set<string>>();
    const weekDaysBySite = new Map<string, Set<string>>();
    const nextDayBySite = new Map<string, string>();

    const addCrew = (siteId: string, workerId: string) => {
      if (!todayCrewIds.has(siteId)) todayCrewIds.set(siteId, new Set());
      todayCrewIds.get(siteId)!.add(workerId);
    };

    // Ist-Stunden von heute → wer war/ist real vor Ort
    for (const e of entries) {
      if (!isWorkEntry(e) || e.date !== today || !e.siteId) continue;
      addCrew(e.siteId, e.workerId);
    }
    // Veröffentlichte Planung dieser Woche
    for (const a of assignments) {
      if (!a.siteId || !a.publishedAt) continue;
      if (!weekDaysBySite.has(a.siteId)) weekDaysBySite.set(a.siteId, new Set());
      weekDaysBySite.get(a.siteId)!.add(a.date);
      if (a.date === today) addCrew(a.siteId, a.workerId);
      if (a.date >= today) {
        const cur = nextDayBySite.get(a.siteId);
        if (!cur || a.date < cur) nextDayBySite.set(a.siteId, a.date);
      }
    }

    const m = new Map<string, Activity>();
    for (const s of sites) {
      const crewIds = todayCrewIds.get(s.id);
      const wdays = weekDaysBySite.get(s.id);
      const todayCrew = crewIds
        ? ([...crewIds].map((id) => workersById.get(id)).filter(Boolean) as Worker[])
        : [];
      let status: ColKey = "aktiv";
      if (crewIds && crewIds.size > 0) status = "heute";
      else if (wdays && wdays.size > 0) status = "woche";
      m.set(s.id, {
        status,
        todayCrew,
        nextDay: nextDayBySite.get(s.id),
        weekDaysCount: wdays ? wdays.size : 0,
      });
    }
    return m;
  }, [sites, entries, assignments, workersById, today]);

  // Favoriten bleiben immer oben, darunter greift die gewählte Sortierung.
  const cmp = (a: SiteRow, b: SiteRow) =>
    (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || SORT_FNS[sortBy](a, b);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sites
      .filter((s) => {
        if (showArchived ? !s.archived : s.archived) return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.street.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          (s.projectNumber ?? "").toLowerCase().includes(q)
        );
      })
      .sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, search, showArchived, sortBy]);

  const byCol = (key: ColKey) => {
    if (key === "anfrage") return visible.filter((s) => !!inquiryBySite[s.id]);
    // Anfragebaustellen erscheinen exklusiv in der "anfrage"-Spalte
    return visible.filter(
      (s) => !inquiryBySite[s.id] && (activityBySite.get(s.id)?.status ?? "aktiv") === key
    );
  };

  const activeCount = sites.filter((s) => !s.archived).length;
  const archivedCount = sites.filter((s) => s.archived).length;
  const heuteCount = sites.filter(
    (s) => !s.archived && activityBySite.get(s.id)?.status === "heute"
  ).length;
  const wocheCount = sites.filter(
    (s) => !s.archived && activityBySite.get(s.id)?.status === "woche"
  ).length;

  // gemeinsame Karten-Handler (Board + Liste)
  const onArchiveSite = async (site: SiteRow) => {
    if (!confirm(`„${site.name}" archivieren? Sie taucht dann nicht mehr im Wochenplan auf.`)) return;
    await archiveSite(site.id).catch((e) => setError(e?.message));
    refresh();
  };
  const onUnarchiveSite = async (site: SiteRow) => {
    await unarchiveSite(site.id).catch((e) => setError(e?.message));
    refresh();
  };
  const onToggleStarSite = async (site: SiteRow) => {
    await updateSite(site.id, { starred: !site.starred }).catch((e) => setError(e?.message));
    refresh();
  };

  const showBoard = !showArchived && layout === "board";

  return (
    <div className="min-h-screen flex flex-col safe-bottom bg-bg-DEFAULT">
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[2400px] mx-auto px-5 lg:px-10 xl:px-14 pt-4 pb-4">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright">Stammdaten</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">Baustellen</h1>
            <span className="font-sans text-[12px] text-steel mt-1 block">
              {activeCount} aktiv
              {heuteCount > 0 ? ` · ${heuteCount} heute vor Ort` : ""}
              {wocheCount > 0 ? ` · ${wocheCount} diese Woche` : ""}
              {archivedCount > 0 ? ` · ${archivedCount} archiviert` : ""}
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="btn-primary !min-h-[44px] text-[12px]"
          >
            ＋ Neue Baustelle
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen: Name, Auftragsnr., Adresse …"
            className="flex-1 min-w-[200px] px-3.5 py-2.5 bg-white/[0.08] border-[1.5px] border-white/20 rounded-lg text-sm text-white placeholder:text-steel focus:outline-none focus:border-copper-bright"
          />
          {!showArchived && (
            <div className="flex gap-1 text-[11px] bg-white/[0.06] border border-white/15 rounded-full p-0.5">
              <button
                onClick={() => setLayout("board")}
                className={`px-3 py-1.5 rounded-full font-mono uppercase ${layout === "board" ? "bg-copper-bright text-bg-deep font-bold" : "text-steel hover:text-white"}`}
                title="Kanban-Board nach Status"
              >
                Board
              </button>
              <button
                onClick={() => setLayout("list")}
                className={`px-3 py-1.5 rounded-full font-mono uppercase ${layout === "list" ? "bg-copper-bright text-bg-deep font-bold" : "text-steel hover:text-white"}`}
                title="Klassische Kachel-Liste"
              >
                Liste
              </button>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="font-mono uppercase text-steel hidden sm:inline">Sortieren</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] border-[1.5px] border-white/20 text-[12px] text-white font-mono focus:outline-none focus:border-copper-bright cursor-pointer [&>option]:text-ink [&>option]:bg-white"
              title="Sortier-Reihenfolge (Favoriten bleiben oben)"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5 text-[11px]">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1.5 rounded-full font-mono uppercase ${!showArchived ? "bg-copper-bright text-bg-deep font-bold" : "border border-white/20 text-steel hover:text-white"}`}
            >
              Aktiv
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1.5 rounded-full font-mono uppercase ${showArchived ? "bg-copper-bright text-bg-deep font-bold" : "border border-white/20 text-steel hover:text-white"} disabled:opacity-40`}
              disabled={archivedCount === 0}
            >
              Archiv ({archivedCount})
            </button>
          </div>
        </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-8 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 grid place-items-center h-mono text-ink-2 text-[12px]">Wird geladen …</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="h-mono text-ink-2 text-[12px]">
            {showArchived ? "Keine archivierten Baustellen" : "Keine Baustelle gefunden"}
          </div>
          {!showArchived && search === "" && (
            <button onClick={() => setCreating(true)} className="btn-primary text-[12px] mt-4">
              Erste Baustelle anlegen
            </button>
          )}
        </div>
      ) : showBoard ? (
        /* ===== KANBAN-BOARD (Status aus Ist-Stunden + Wochenplan) ===== */
        <div className="flex-1 flex gap-3.5 px-5 lg:px-10 xl:px-14 py-6 overflow-x-auto board-scroll w-full max-w-[2400px] mx-auto">
          {COLUMNS.map((col) => {
            const list = byCol(col.key);
            const isAnfrageSpalte = col.key === "anfrage";
            return (
              <section
                key={col.key}
                className={`flex-1 basis-0 min-w-[280px] flex flex-col rounded-xl ${
                  isAnfrageSpalte
                    ? "bg-copper/5 border-2 border-copper/35"
                    : "bg-white/30 border border-steel-line/45"
                }`}
              >
                <header className={`rounded-t-[11px] px-3.5 py-3 flex items-center justify-between gap-2 ${
                  isAnfrageSpalte ? "bg-copper/15" : "surface-steel"
                }`}>
                  <div className={`font-display font-extrabold uppercase text-[14.5px] tracking-wide flex items-center gap-2.5 whitespace-nowrap ${
                    isAnfrageSpalte ? "text-copper-bright" : "text-white"
                  }`}>
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: col.color, boxShadow: "0 0 0 3px rgba(255,255,255,.10)" }}
                    />
                    {col.label}
                  </div>
                  <span className={`font-mono font-bold text-[12px] px-2.5 py-0.5 rounded-full min-w-[26px] text-center ${
                    isAnfrageSpalte ? "bg-copper text-white" : "bg-white/15 text-white"
                  }`}>
                    {list.length}
                  </span>
                </header>
                <div className="px-3.5 py-2 bg-bg-deep/95 border-b border-steel-line/40">
                  <span className="font-sans text-[11.5px] text-steel">{col.hint}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-[140px] board-scroll">
                  {list.length === 0 ? (
                    <div className={`font-sans text-[12.5px] text-center py-8 ${
                      isAnfrageSpalte ? "text-copper/40 italic" : "text-ink-2"
                    }`}>
                      {isAnfrageSpalte ? "keine offenen Anfragen" : "keine Baustellen"}
                    </div>
                  ) : (
                    list.map((site) => (
                      <BoardCard
                        key={site.id}
                        site={site}
                        activity={activityBySite.get(site.id)}
                        inquiry={inquiryBySite[site.id] ?? null}
                        color={col.color}
                        onOpen={() => navigate(`/admin/sites/${site.id}`)}
                        onEdit={() => setEditing(site)}
                        onArchive={() => onArchiveSite(site)}
                        onToggleStar={() => onToggleStarSite(site)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        /* ===== KLASSISCHE LISTE (aktiv: Kacheln · Archiv: immer Liste) ===== */
        <main className="px-5 lg:px-10 xl:px-14 py-6 w-full max-w-[2400px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7 gap-3">
            {visible.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                onOpen={() => navigate(`/admin/sites/${site.id}`)}
                onEdit={() => setEditing(site)}
                onArchive={() => onArchiveSite(site)}
                onUnarchive={() => onUnarchiveSite(site)}
                onToggleStar={() => onToggleStarSite(site)}
              />
            ))}
          </div>
        </main>
      )}

      {creating && (
        <SiteEditor
          title="Neue Baustelle"
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await createSite(input);
            setCreating(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <SiteEditor
          title="Baustelle bearbeiten"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await updateSite(editing.id, input);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Board-Karte: kompakt, mit heutiger Crew bzw. nächstem geplanten Einsatz. */
function BoardCard({
  site, activity, inquiry, color, onOpen, onEdit, onArchive, onToggleStar
}: {
  site: SiteRow;
  activity?: Activity;
  inquiry?: Inquiry | null;
  color: string;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className="dd-card is-click p-3.5"
      style={{ ["--c" as any]: site.starred ? "#DC6E2D" : color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            {inquiry && (
              <span className="font-mono font-bold text-[9.5px] tracking-widest uppercase text-white bg-copper px-1.5 py-0.5 rounded">
                ANFRAGE
              </span>
            )}
            {site.projectNumber && (
              <span className="h-mono text-copper text-[11px]">Auftrag {site.projectNumber}</span>
            )}
          </div>
          <div className="font-display text-[17px] uppercase tracking-tight leading-tight flex items-center gap-1.5">
            {site.starred && <span className="text-copper text-[13px]">★</span>}
            <span className="break-words">{site.name}</span>
          </div>
          {(site.street || site.city) && (
            <div className="h-mono text-ink-2 text-[11px] mt-1">
              {site.street}{site.city ? ` · ${site.city}` : ""}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          className={`flex-shrink-0 w-7 h-7 rounded-md grid place-items-center text-[15px] ${site.starred ? "text-copper" : "text-ink-mute hover:text-ink-2"}`}
          title={site.starred ? "Stern entfernen" : "Als Favorit markieren"}
        >
          {site.starred ? "★" : "☆"}
        </button>
      </div>

      {site.disciplines?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {site.disciplines.map((d) => (
            <span key={d} className="font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-deep/10 text-ink-2">
              {DISCIPLINE_LABEL[d]}
            </span>
          ))}
        </div>
      )}

      {activity?.status === "heute" && activity.todayCrew.length > 0 && (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-ink/10">
          <span className="dd-eyebrow text-copper whitespace-nowrap">Heute vor Ort</span>
          <div className="flex -space-x-1.5">
            {activity.todayCrew.slice(0, 5).map((w) => (
              <span
                key={w.id}
                title={`${w.firstName} ${w.lastName}`.trim()}
                className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-white border-2 border-white"
                style={{ background: "#2B2E31" }}
              >
                {w.initials}
              </span>
            ))}
            {activity.todayCrew.length > 5 && (
              <span className="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold text-ink-2 border-2 border-white bg-bg-2">
                +{activity.todayCrew.length - 5}
              </span>
            )}
          </div>
        </div>
      )}

      {activity?.status === "woche" && activity.nextDay && (
        <div className="mt-2.5 pt-2.5 border-t border-ink/10 h-mono text-[11px] text-good">
          Nächster Einsatz · {dayName(activity.nextDay)} {shortDate(activity.nextDay)}
          {activity.weekDaysCount > 1 ? ` · ${activity.weekDaysCount} Tage` : ""}
        </div>
      )}

      {site.geo && (
        <div className="h-mono text-ink-mute text-[10px] mt-2">
          GPS · {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}
        </div>
      )}

      <div className="flex gap-2 mt-3 pt-3 border-t border-ink/10" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEdit} className="btn-ghost text-[11px] flex-1">Bearbeiten</button>
        <button onClick={onArchive} className="btn-ghost text-[11px] text-rust">Archivieren</button>
      </div>
    </div>
  );
}

function SiteCard({
  site, onOpen, onEdit, onArchive, onUnarchive, onToggleStar
}: {
  site: SiteRow;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={`dd-card is-click p-4 ${site.archived ? "opacity-60" : ""}`}
      style={{ ["--c" as any]: site.archived ? "#A9AEB3" : site.starred ? "#DC6E2D" : "#8B9197" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {site.projectNumber && (
            <div className="h-mono text-copper text-[11px]">Auftrag {site.projectNumber}</div>
          )}
          <div className="font-display text-lg uppercase tracking-tight leading-tight">{site.name}</div>
          {(site.street || site.city) && (
            <div className="h-mono text-ink-2 text-[11px] mt-1">
              {site.street}{site.city ? ` · ${site.city}` : ""}
            </div>
          )}
          {site.geo && (
            <div className="h-mono text-ink-mute text-[10px] mt-1">
              GPS · {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}
            </div>
          )}
        </div>
        {!site.archived && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
            className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-lg ${site.starred ? "text-copper" : "text-ink-mute hover:text-ink-2"}`}
            title={site.starred ? "Stern entfernen" : "Als Favorit markieren"}
          >
            {site.starred ? "★" : "☆"}
          </button>
        )}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-ink/10" onClick={(e) => e.stopPropagation()}>
        {site.archived ? (
          <button onClick={onUnarchive} className="btn-ghost text-[11px] flex-1">
            Wiederherstellen
          </button>
        ) : (
          <>
            <button onClick={onEdit} className="btn-ghost text-[11px] flex-1">Bearbeiten</button>
            <button onClick={onArchive} className="btn-ghost text-[11px] text-rust">Archivieren</button>
          </>
        )}
      </div>
    </div>
  );
}
