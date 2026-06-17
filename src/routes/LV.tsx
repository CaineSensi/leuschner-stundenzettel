import { useCallback, useEffect, useRef, useState } from "react";
import BackButton from "../components/BackButton";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import {
  LV_CATEGORIES,
  LV_CAT_ORDER,
  listLvPositions,
  createLvPosition,
  updateLvPosition,
  archiveLvPosition,
  listAliases,
  aliasesOf,
  mergePositionIntoMaster,
  unmergePosition,
  getPriceHistory,
  getUsageCounts,
  getUsageDetail,
} from "../lib/lv";
import type {
  LvAlias,
  LvPriceHistoryEntry,
  LvUsageEntry,
} from "../lib/lv";
import type { LvPosition, LvPositionInput } from "../lib/types";

/* ────────────────────────────────────────────────────────────────────────
   Leistungsverzeichnis · Variante B (Mockup-Freigabe Rick 11.06.2026):
   Desktop = Master-Detail mit drei Spalten — Kategorien links ANGEHEFTET,
   Positions-Liste dunkel in der Mitte, rechts ein PERMANENTER Drawer-Panel
   (heller Verlauf EEF0F2→E2E4E7, Stahl-Kopfband mit ID-Badge und
   Kupfer-Schweißnaht — exakt die Optik des Angebote-Drawers).
   Mobil (<lg) = bekannter Flow: Kategorie-Chips + Karten + echter Drawer.
   ──────────────────────────────────────────────────────────────────────── */

function priceStr(p: LvPosition): string {
  if (p.surcharge) return p.surcharge;
  if (p.price === null) return "–";
  const fmt = p.price % 1 === 0 ? `${p.price}` : p.price.toFixed(2).replace(".", ",");
  return `${fmt} €/${p.unit ?? "?"}`;
}

/* ── Leerer Formular-State ─────────────────────────────────────────────── */
function emptyForm(cat: string): LvPositionInput {
  return {
    id: "",
    cat,
    name: "",
    price: null,
    unit: "",
    surcharge: "",
    shortText: "",
    longText: "",
    zulagen: [],
  };
}

function positionToForm(p: LvPosition): LvPositionInput {
  return {
    id: p.id,
    cat: p.cat,
    name: p.name,
    price: p.price,
    unit: p.unit ?? "",
    surcharge: p.surcharge ?? "",
    shortText: p.shortText ?? "",
    longText: p.longText ?? "",
    zulagen: p.zulagen,
  };
}

/* ── Haupt-Komponente ───────────────────────────────────────────────────── */
export default function LV() {
  const [positions, setPositions] = useState<LvPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* Kategorie-Filter für Chips (Desktop + Mobil). Default = erste Kategorie. */
  const [activeCat, setActiveCat] = useState<string>(LV_CAT_ORDER[0]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sortAZ, setSortAZ] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* Drag & Drop: Position per Ziehen in eine andere Kategorie verschieben.
     Drop-Ziel sind die Kategorie-Reiter oben. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCat, setDragOverCat] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<string | null>(null);
  const moveToastTimer = useRef<number | null>(null);
  const flashMoveToast = useCallback((msg: string) => {
    setMoveToast(msg);
    if (moveToastTimer.current) window.clearTimeout(moveToastTimer.current);
    moveToastTimer.current = window.setTimeout(() => setMoveToast(null), 2600);
  }, []);

  /* Master-Merger + Usage + History (16.06.2026) — Nebenstränge, brauchen kein
     Realtime; werden bei Mount + nach Mutationen frisch geladen. */
  const [aliases, setAliases] = useState<LvAlias[]>([]);
  const [usageCounts, setUsageCounts] = useState<Map<string, number>>(new Map());
  const [mergeForId, setMergeForId] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [unmergeBusy, setUnmergeBusy] = useState<string | null>(null);

  /* Desktop-Spalten brauchen eine feste Resthöhe (interne Scrolls). App-Banner
     (Push/Offline) sitzen im Flow ÜBER der Route — daher eigene Oberkante
     messen. Auf Mobil (<1024px) normale Seiten-Scrollung → Höhe freigeben. */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      if (window.innerWidth >= 1024) {
        el.style.height = `${window.innerHeight - el.getBoundingClientRect().top}px`;
        el.style.overflow = "hidden";
      } else {
        el.style.height = "";
        el.style.overflow = "";
      }
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, []);

  // Nachladbar gemacht (Rick 16.06.: kein manuelles Neuladen mehr). Der erste
  // Fetch beim Mount kann ohne Session-Token laufen (RLS → leer); die Hooks
  // unten holen die Daten nach, sobald die Anmeldung steht / der Tab sichtbar
  // wird, und live bei Katalog-Änderungen.
  const refresh = useCallback(() => {
    listLvPositions()
      .then((data) => {
        setPositions(data);
        setLoading(false);
        setLoadError(null);
        // Auswahl nur beim ersten Mal setzen — eine spätere Aktualisierung darf
        // die aktive Position des Nutzers nicht wegspringen lassen.
        setActiveId((cur) => cur ?? (data.find((p) => p.cat === "ERD") ?? data[0])?.id ?? null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // Nur als Fehler zeigen, wenn wir noch GAR keine Daten haben — sonst
        // einen vorübergehenden Hänger nicht über gute Daten legen.
        setPositions((cur) => { if (cur.length === 0) setLoadError(msg); return cur; });
        setLoading(false);
      });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRealtime("lv", ["lv_positions"], refresh);
  useRefreshOnVisible(refresh);
  useRefreshOnAuth(refresh);

  /* Aliasse separat laden (selten geändert, kein Realtime nötig). */
  const refreshAliases = useCallback(() => {
    listAliases()
      .then((rows) => setAliases(rows))
      .catch(() => { /* still: leere Liste — kein Blocker */ });
  }, []);
  useEffect(() => { refreshAliases(); }, [refreshAliases]);

  /* Usage-Counts nachladen, sobald positions stehen. */
  useEffect(() => {
    if (positions.length === 0) return;
    let cancelled = false;
    getUsageCounts(positions)
      .then((m) => { if (!cancelled) setUsageCounts(m); })
      .catch(() => { /* still: keine Counts statt Crash */ });
    return () => { cancelled = true; };
  }, [positions]);

  const q = search.trim().toLowerCase();
  const matches = (p: LvPosition) =>
    q === "" ||
    p.name.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.shortText ?? "").toLowerCase().includes(q);

  /* Liste: aktive Kategorie + Suche. Suche sucht über alle Kategorien. */
  const listItems = positions
    .filter((p) => (q !== "" || p.cat === activeCat) && matches(p))
    .sort(sortAZ ? (a, b) => a.name.localeCompare(b.name, "de") : undefined);

  const errPositions = positions.filter((p) => p.cat === "ERR");
  const activePos = positions.find((p) => p.id === activeId) ?? null;
  const draggingPos = draggingId ? positions.find((p) => p.id === draggingId) ?? null : null;

  const catCount = (cat: string) => positions.filter((p) => p.cat === cat).length;

  function switchCat(cat: string) {
    setActiveCat(cat);
    setSearch("");
    const first = positions.find((p) => p.cat === cat);
    setActiveId(first?.id ?? null);
    setDeleteConfirm(null);
  }

  /* Position in eine andere Kategorie verschieben (Drag & Drop auf Reiter).
     Nur das cat-Feld wird geändert, die ID bleibt unverändert. Zulagen (ERR)
     bleiben außen vor — die werden über IDs referenziert. Optimistisch mit
     Rollback bei Fehler. */
  async function handleMoveCategory(id: string, newCat: string) {
    const pos = positions.find((p) => p.id === id);
    if (!pos || pos.cat === newCat || pos.cat === "ERR" || newCat === "ERR") return;
    const fromCat = pos.cat;
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, cat: newCat } : p)));
    flashMoveToast(`${id} → ${LV_CATEGORIES[newCat]?.label ?? newCat}`);
    try {
      await updateLvPosition(id, { cat: newCat });
    } catch (err: unknown) {
      setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, cat: fromCat } : p)));
      setSaveError(err instanceof Error ? err.message : "Verschieben fehlgeschlagen.");
      setMoveToast(null);
    }
  }

  /* Neue Position speichern */
  async function handleCreate(input: LvPositionInput) {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createLvPosition(input);
      setPositions((prev) =>
        [...prev, created].sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id))
      );
      setShowNew(false);
      setActiveCat(created.cat);
      setActiveId(created.id);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  /* Position bearbeiten */
  async function handleUpdate(id: string, input: LvPositionInput) {
    setSaving(true);
    setSaveError(null);
    try {
      await updateLvPosition(id, input);
      setPositions((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                name: input.name,
                cat: input.cat,
                price: input.price ?? null,
                unit: input.unit ?? null,
                surcharge: input.surcharge ?? null,
                shortText: input.shortText ?? null,
                longText: input.longText ?? null,
                zulagen: input.zulagen ?? [],
              }
            : p
        )
      );
      setEditId(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  /* Neue Zulage (ERR-Position) direkt aus dem Modal heraus anlegen */
  async function handleCreateZulage(input: LvPositionInput): Promise<LvPosition> {
    const created = await createLvPosition(input);
    setPositions((prev) =>
      [...prev, created].sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id))
    );
    return created;
  }

  /* Merge: aktuelle Position als Alias unter einen Master legen. */
  async function handleMerge(aliasId: string, masterId: string) {
    setMergeBusy(true);
    setMergeError(null);
    try {
      await mergePositionIntoMaster(aliasId, masterId, "manueller Merge");
      setMergeForId(null);
      setActiveId(masterId); // Drawer wechselt auf den Master
      await Promise.all([
        listLvPositions().then(setPositions),
        listAliases().then(setAliases),
      ]);
    } catch (err: unknown) {
      setMergeError(err instanceof Error ? err.message : "Merge fehlgeschlagen.");
    } finally {
      setMergeBusy(false);
    }
  }

  /* Unmerge: Alias-Eintrag entfernen und Position reaktivieren. */
  async function handleUnmerge(aliasId: string) {
    setUnmergeBusy(aliasId);
    setSaveError(null);
    try {
      await unmergePosition(aliasId);
      await Promise.all([
        listLvPositions().then(setPositions),
        listAliases().then(setAliases),
      ]);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Unmerge fehlgeschlagen.");
    } finally {
      setUnmergeBusy(null);
    }
  }

  /* Position archivieren */
  async function handleArchive(id: string) {
    setSaving(true);
    setSaveError(null);
    try {
      await archiveLvPosition(id);
      setPositions((prev) => {
        const next = prev.filter((p) => p.id !== id);
        const fallback = next.find((p) => p.cat === activeCat);
        setActiveId(fallback?.id ?? null);
        return next;
      });
      setDeleteConfirm(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Archivieren fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} className="min-h-screen lg:h-screen flex flex-col">
      {/* ── Stahl-Header ── */}
      <header className="sticky top-0 lg:static z-30 surface-steel safe-top flex-shrink-0">
        <div className="w-full px-5 lg:px-8 pt-4 pb-4">
          <BackButton to="/admin" label="Zur Übersicht" />
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 flex-wrap">
            <div>
              <span className="dd-eyebrow text-copper-bright block">Stammdaten · Preisliste</span>
              <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
                Leistungsverzeichnis
              </h1>
              {!loading && (
                <p className="font-mono text-[11px] mt-1.5 tracking-wide text-steel">
                  {positions.length} Positionen in {Object.keys(LV_CATEGORIES).length} Kategorien
                </p>
              )}
            </div>
            <div className="flex gap-2.5 items-center flex-wrap">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Position suchen …"
                aria-label="Positionen durchsuchen"
                title="Suche nach ID, Name oder Kurztext — sucht über alle Kategorien"
                className="w-full lg:w-[260px] bg-white/10 border border-white/20 rounded-md px-3 py-2 text-[13px] font-sans text-white placeholder:text-white/40 focus:outline-none focus:border-copper-bright transition-colors !min-h-[44px]"
              />
              <button
                onClick={() => { setShowNew(true); setSaveError(null); }}
                aria-label="Neue Position anlegen"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-copper text-white font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-copper-bright transition-colors !min-h-[44px]"
              >
                + Position
              </button>
            </div>
          </div>

          {/* Hinweis beim Ziehen: wohin verschieben? */}
          {draggingId && (
            <p className="font-mono text-[10.5px] text-copper-bright mt-3 -mb-1 tracking-wide animate-pulse">
              ⠿ Auf eine Kategorie ziehen, um „{draggingPos?.name ?? draggingId}" zu verschieben …
            </p>
          )}

          {/* Kategorie-Chips · Desktop + Mobil (zugleich Drop-Ziele für D&D) */}
          <div className="flex gap-1.5 overflow-x-auto board-scroll mt-4 py-0.5 -my-0.5">
            {LV_CAT_ORDER.map((cat) => {
              const isActive = activeCat === cat;
              const isErr = cat === "ERR";
              const canDrop = draggingId != null && !isErr && draggingPos?.cat !== cat;
              const isDropTarget = dragOverCat === cat && canDrop;
              return (
                <button
                  key={cat}
                  onClick={() => switchCat(cat)}
                  aria-pressed={isActive}
                  aria-label={`Kategorie ${LV_CATEGORIES[cat].label}`}
                  onDragOver={(e) => { if (canDrop) { e.preventDefault(); setDragOverCat(cat); } }}
                  onDragLeave={() => setDragOverCat((c) => (c === cat ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId && canDrop) handleMoveCategory(draggingId, cat);
                    setDragOverCat(null);
                  }}
                  title={canDrop ? `Position hierher verschieben → ${LV_CATEGORIES[cat].label}` : undefined}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-display font-extrabold uppercase text-[11.5px] tracking-wide transition-all !min-h-[36px] ${
                    isDropTarget
                      ? "bg-copper text-white ring-2 ring-copper-bright ring-offset-2 ring-offset-[#1A1C1E] scale-105"
                      : isActive
                      ? isErr ? "bg-copper text-white" : "bg-white/20 text-white"
                      : `bg-white/8 text-white/65 hover:bg-white/15 hover:text-white${canDrop ? " ring-1 ring-copper/40" : ""}`
                  }`}
                >
                  {LV_CATEGORIES[cat].label}
                  <span className={`font-mono text-[10px] leading-none px-1.5 py-0.5 rounded-sm ${
                    isActive || isDropTarget ? "bg-black/20 text-white" : "bg-white/10 text-white/45"
                  }`}>
                    {catCount(cat)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Fehler beim Laden ── */}
      {loadError && (
        <div className="mx-5 lg:mx-8 mt-4 bg-rust/15 border border-rust/40 rounded-xl p-4 flex-shrink-0">
          <div className="dd-eyebrow text-rust">Fehler beim Laden</div>
          <p className="text-sm text-paper mt-1">{loadError}</p>
        </div>
      )}

      {/* ════════ 2 Spalten Master-Detail ════════ */}
      <div className="flex flex-1 min-h-0 w-full">

        {/* ── Spalte 1: Positions-Liste · dunkel, kompakt ── */}
        <section className="flex flex-col flex-1 min-w-[280px] bg-[#191B1E] border-r border-white/8 min-h-0">
          <div className="px-4 py-2.5 border-b border-white/8 flex items-center justify-between flex-shrink-0">
            <span className="dd-eyebrow text-copper">
              {q !== "" ? "Suchtreffer" : LV_CATEGORIES[activeCat]?.label ?? activeCat}
              <span className="text-white/35 ml-1.5 normal-case tracking-normal">({listItems.length})</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSortAZ((s) => !s)}
                title={sortAZ ? "Zurück zur Standard-Reihenfolge (Kategorie + ID)" : "Alphabetisch nach Name sortieren"}
                aria-pressed={sortAZ}
                className={`font-mono text-[10px] font-bold tracking-wider px-2 py-1 rounded transition-colors !min-h-[28px] ${
                  sortAZ
                    ? "bg-copper text-white"
                    : "bg-white/8 text-white/45 hover:bg-white/15 hover:text-white"
                }`}
              >
                A–Z
              </button>
              <span className="dd-eyebrow text-steel !text-[9px]" title="Netto-Einheitspreis">Netto-EP</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto board-scroll">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="font-mono text-[11px] text-white/30 animate-pulse">Lädt …</span>
              </div>
            ) : listItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <span className="font-mono text-[11px] text-white/30 uppercase tracking-wider">
                  {q !== "" ? "Keine Treffer" : "Noch keine Positionen"}
                </span>
              </div>
            ) : (
              listItems.map((p) => {
                const isActive = p.id === activeId;
                const confirming = deleteConfirm === p.id;
                const usage = usageCounts.get(p.id) ?? 0;
                return (
                  <div
                    key={p.id}
                    draggable={p.cat !== "ERR"}
                    onDragStart={(e) => {
                      setDraggingId(p.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", p.id);
                    }}
                    onDragEnd={() => { setDraggingId(null); setDragOverCat(null); }}
                    className={`group w-full border-b border-white/6 transition-colors flex items-stretch ${
                      draggingId === p.id ? "opacity-40" : ""
                    } ${isActive ? "bg-white/10 border-l-2 border-l-copper" : "hover:bg-white/5"}`}
                  >
                    {/* Klickbereich: Position auswählen (zugleich Drag-Griff) */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => { setActiveId(p.id); setDeleteConfirm(null); }}
                      onKeyDown={(e) => e.key === "Enter" && setActiveId(p.id)}
                      aria-label={`Position ${p.id} anzeigen: ${p.name}`}
                      aria-pressed={isActive}
                      title={p.cat !== "ERR" ? "Ziehen, um die Kategorie zu wechseln" : undefined}
                      className={`flex-1 text-left px-4 py-3 flex items-baseline gap-3 min-w-0 ${
                        p.cat !== "ERR" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      }`}
                    >
                      <span className="font-mono text-[11px] tracking-wider font-bold text-copper w-[62px] flex-shrink-0">
                        {p.id}
                      </span>
                      <span className="flex-1 font-sans text-[13px] font-semibold text-white/85 leading-snug truncate">
                        {p.name}
                        {q !== "" && (
                          <span className="ml-1.5 font-mono text-[9.5px] text-white/35 uppercase">{p.cat}</span>
                        )}
                      </span>
                      {usage > 0 && (
                        <span
                          className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border border-good/40 bg-good/10 text-good whitespace-nowrap flex-shrink-0"
                          title={`In ${usage} ${usage === 1 ? "Anfrage" : "Anfragen"} verwendet`}
                        >
                          ▸ {usage}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-white/50 whitespace-nowrap flex-shrink-0">
                        {priceStr(p)}
                      </span>
                    </div>
                    {/* Löschen-Aktion */}
                    <div className="flex items-center flex-shrink-0 pr-2">
                      {confirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleArchive(p.id)}
                            disabled={saving}
                            aria-label="Löschen bestätigen"
                            title="Ja, Position löschen"
                            className="font-mono text-[11px] font-bold px-2 py-1 rounded bg-rust text-white hover:bg-red-700 transition-colors disabled:opacity-50 !min-h-[28px]"
                          >
                            {saving ? "…" : "Ja"}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            aria-label="Abbrechen"
                            title="Abbrechen"
                            className="font-mono text-[11px] font-bold px-2 py-1 rounded bg-white/10 text-white/60 hover:bg-white/20 transition-colors !min-h-[28px]"
                          >
                            Nein
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(p.id)}
                          aria-label={`Position ${p.id} löschen`}
                          title="Position löschen"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 font-mono text-[13px] font-bold w-7 h-7 flex items-center justify-center rounded text-white/40 hover:bg-rust/20 hover:text-rust transition-all"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── Spalte 2: Permanenter Drawer-Panel (hell, Stahl-Kopfband) ── */}
        <section
          className="flex flex-col w-[560px] flex-shrink-0 min-h-0"
          style={{
            background: "linear-gradient(180deg, #EEF0F2, #E2E4E7)",
            borderLeft: "1px solid rgba(0,0,0,.1)",
            boxShadow: "-8px 0 30px -10px rgba(0,0,0,.4)",
          }}
        >
          {activePos ? (
            <PanelDetail
              pos={activePos}
              errPositions={errPositions}
              positions={positions}
              aliasesForPos={aliasesOf(activePos.id, aliases)}
              usage={usageCounts.get(activePos.id) ?? 0}
              onEdit={() => { setEditId(activePos.id); setSaveError(null); }}
              deleteConfirm={deleteConfirm}
              onDelete={() => setDeleteConfirm(activePos.id)}
              onDeleteConfirm={() => handleArchive(activePos.id)}
              onDeleteCancel={() => setDeleteConfirm(null)}
              saving={saving}
              onMergeOpen={() => { setMergeForId(activePos.id); setMergeError(null); }}
              onUnmerge={handleUnmerge}
              unmergeBusy={unmergeBusy}
            />
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-3">
              <span className="font-display font-black uppercase text-[13px] tracking-wide text-[#9CA3AF]">
                Position auswählen
              </span>
              <p className="font-mono text-[11px] text-[#9CA3AF] text-center max-w-[220px]">
                Eine Position aus der Liste links anklicken, um Details anzuzeigen.
              </p>
            </div>
          )}
        </section>
      </div>


      {/* ── Fehler beim Speichern (global) ── */}
      {saveError && !showNew && !editId && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] bg-rust/90 text-white px-4 py-2.5 rounded-lg font-sans text-[13px] shadow-lg">
          {saveError}
        </div>
      )}

      {/* ── Toast: Position verschoben ── */}
      {moveToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] bg-copper text-white px-4 py-2.5 rounded-lg font-mono text-[12px] tracking-wide shadow-lg flex items-center gap-2">
          <span aria-hidden="true">↪</span>
          {moveToast} verschoben
        </div>
      )}

      {/* ── Modal: Merge ── */}
      {mergeForId && (() => {
        const src = positions.find((p) => p.id === mergeForId);
        if (!src) return null;
        return (
          <MergeModal
            source={src}
            positions={positions}
            saving={mergeBusy}
            error={mergeError}
            onConfirm={(masterId) => handleMerge(src.id, masterId)}
            onClose={() => { setMergeForId(null); setMergeError(null); }}
          />
        );
      })()}

      {/* ── Modal: Neue Position ── */}
      {showNew && (
        <PositionModal
          title="Neue Position"
          initial={emptyForm(activeCat)}
          errPositions={errPositions}
          saving={saving}
          saveError={saveError}
          onSave={handleCreate}
          onCreateZulage={handleCreateZulage}
          onClose={() => { setShowNew(false); setSaveError(null); }}
        />
      )}

      {/* ── Modal: Bearbeiten ── */}
      {editId && (() => {
        const pos = positions.find((p) => p.id === editId);
        if (!pos) return null;
        return (
          <PositionModal
            title="Position bearbeiten"
            initial={positionToForm(pos)}
            errPositions={errPositions}
            saving={saving}
            saveError={saveError}
            onSave={(input) => handleUpdate(editId, input)}
            onCreateZulage={handleCreateZulage}
            onClose={() => { setEditId(null); setSaveError(null); }}
          />
        );
      })()}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Panel-Detail · Inhalt des permanenten Drawer-Panels (Desktop) —
   Stahl-Kopfband mit Kupfer-Schweißnaht + heller Body (Mockup Variante B)
   ──────────────────────────────────────────────────────────────────────── */
interface DetailProps {
  pos: LvPosition;
  errPositions: LvPosition[];
  positions: LvPosition[];
  aliasesForPos: string[];
  usage: number;
  onEdit: () => void;
  deleteConfirm: string | null;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  saving: boolean;
  onMergeOpen: () => void;
  onUnmerge: (aliasId: string) => void;
  unmergeBusy: string | null;
}

function PanelDetail({
  pos,
  errPositions,
  positions,
  aliasesForPos,
  usage,
  onEdit,
  deleteConfirm,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
  saving,
  onMergeOpen,
  onUnmerge,
  unmergeBusy,
}: DetailProps) {
  const isErr = pos.cat === "ERR";
  const meta = LV_CATEGORIES[pos.cat];
  const zulagen = pos.zulagen
    .map((id) => errPositions.find((e) => e.id === id))
    .filter((e): e is LvPosition => Boolean(e));

  /* Usage-Drill-Down + Preis-Historie (im Drawer geladen, je Mount/Position). */
  const [showUsage, setShowUsage] = useState(false);
  const [usageRows, setUsageRows] = useState<LvUsageEntry[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<LvPriceHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [unmergeConfirm, setUnmergeConfirm] = useState<string | null>(null);

  /* Beim Wechsel der Position: alle Detail-Loads zurücksetzen. */
  useEffect(() => {
    setShowUsage(false); setUsageRows(null);
    setShowHistory(false); setHistoryRows(null);
    setUnmergeConfirm(null);
  }, [pos.id]);

  function toggleUsage() {
    if (showUsage) { setShowUsage(false); return; }
    setShowUsage(true);
    if (usageRows !== null) return;
    setUsageLoading(true);
    getUsageDetail(pos.id, positions)
      .then((rows) => setUsageRows(rows))
      .catch(() => setUsageRows([]))
      .finally(() => setUsageLoading(false));
  }

  function toggleHistory() {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    if (historyRows !== null) return;
    setHistoryLoading(true);
    getPriceHistory(pos.id)
      .then((rows) => setHistoryRows(rows))
      .catch(() => setHistoryRows([]))
      .finally(() => setHistoryLoading(false));
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }
  function fmtPrice(n: number | null): string {
    if (n === null) return "–";
    return n % 1 === 0 ? `${n}` : n.toFixed(2).replace(".", ",");
  }

  return (
    <>
      {/* Stahl-Kopfband · Kupfer-Schweißnaht unten (wie Angebote-Drawer) */}
      <div
        className="flex flex-col gap-2 px-5 py-3.5 flex-shrink-0"
        style={{
          background: "linear-gradient(180deg, #2B2E31, #1A1C1E)",
          boxShadow: "inset 0 -2px 0 #DC6E2D",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-[11px] font-bold tracking-wider px-2.5 py-1 rounded-[5px] whitespace-nowrap flex-shrink-0"
            style={{
              background: "rgba(220,110,45,.22)",
              color: "#E8853F",
              border: "1px solid rgba(220,110,45,.35)",
            }}
            title="Positions-ID aus dem Leistungsverzeichnis"
          >
            {pos.id}
          </span>
          <span className="font-display font-black uppercase text-[15px] text-white leading-tight">
            {pos.name}
          </span>
        </div>

        {/* Aliasse · klein, Stahl-grau, klickbar → unmerge */}
        {aliasesForPos.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] tracking-[.14em] uppercase text-steel">
              Aliasse · {aliasesForPos.length}
            </span>
            {aliasesForPos.map((aid) => {
              const busy = unmergeBusy === aid;
              const confirming = unmergeConfirm === aid;
              if (confirming) {
                return (
                  <span key={aid} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setUnmergeConfirm(null); onUnmerge(aid); }}
                      title={`Alias ${aid} entfernen und Position reaktivieren`}
                      className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border border-rust bg-rust/20 text-white disabled:opacity-50"
                    >
                      {busy ? "…" : `Ja, ${aid}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnmergeConfirm(null)}
                      className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-white/70 hover:bg-white/10"
                    >
                      Abbrechen
                    </button>
                  </span>
                );
              }
              return (
                <button
                  key={aid}
                  type="button"
                  onClick={() => setUnmergeConfirm(aid)}
                  disabled={busy}
                  title={`Klick: Alias ${aid} entfernen und Position reaktivieren (unmerge)`}
                  className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border border-white/15 bg-white/8 text-white/75 hover:bg-white/15 hover:border-copper hover:text-white transition-colors disabled:opacity-50"
                >
                  {aid}
                </button>
              );
            })}
          </div>
        )}

        {/* Verwendet-in-N-Anfragen · Stahl-Link */}
        {usage > 0 && (
          <button
            type="button"
            onClick={toggleUsage}
            className="self-start font-mono text-[10.5px] tracking-wider px-2 py-0.5 rounded border border-good/40 bg-good/10 text-good hover:bg-good/20 transition-colors"
            title="Anfragen auflisten, die diese Position referenzieren"
          >
            Verwendet in {usage} {usage === 1 ? "Anfrage" : "Anfragen"} {showUsage ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* Heller Body */}
      <div className="flex-1 min-h-0 overflow-y-auto board-scroll px-5 py-5">
        {/* Usage-Drill-Down (im Body, damit er scrollt) */}
        {showUsage && (
          <div className="mb-4 rounded-md bg-black/5 border border-steel-line/40 px-3 py-2.5">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-1.5">
              Anfragen mit dieser Position
            </div>
            {usageLoading ? (
              <span className="font-mono text-[11px] text-ink-mute animate-pulse">lädt …</span>
            ) : usageRows && usageRows.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {usageRows.map((u) => (
                  <li key={`${u.cardId}-${u.positionName}`}>
                    <button
                      type="button"
                      onClick={() => { try { window.open(`/?card=${u.cardId}`, "_blank"); } catch { /* still */ } }}
                      className="w-full text-left font-mono text-[11.5px] text-ink-body hover:text-copper transition-colors px-1.5 py-1 rounded hover:bg-white/40"
                      title="Anfrage in neuem Tab öffnen"
                    >
                      <span className="font-bold text-copper">{u.docNumber ?? "—"}</span>
                      <span className="text-ink-mute"> · </span>
                      <span className="text-ink">{u.customerName}</span>
                      <span className="text-ink-mute"> · </span>
                      <span className="italic text-ink-2">"{u.positionName}"</span>
                      <span className="text-ink-mute"> · </span>
                      <span className="uppercase text-ink-mute text-[10px] tracking-wider">{u.stage}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="font-mono text-[11px] text-ink-mute italic">Keine Treffer.</span>
            )}
          </div>
        )}

        {/* Preis groß */}
        <div className="mb-4">
          <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-1" title={isErr ? "Aufschlag auf den Einheitspreis der Grundposition" : "Netto-Einheitspreis — Basis für die Angebotszeile"}>
            {isErr ? "Aufschlag" : "Einheitspreis (netto)"}
          </div>
          <div className="font-mono font-bold text-[26px] text-copper leading-none">
            {isErr ? (pos.surcharge ?? "–") : (
              <>
                {pos.price === null ? "–" : (pos.price % 1 === 0 ? pos.price : pos.price.toFixed(2).replace(".", ","))}
                {pos.price !== null && (
                  <span className="text-[15px] text-ink-2 font-normal"> €/{pos.unit ?? "?"}</span>
                )}
              </>
            )}
          </div>

          {/* Preis-Verlauf-Toggle */}
          <PriceHistoryToggle
            historyRows={historyRows}
            historyLoading={historyLoading}
            showHistory={showHistory}
            onToggle={toggleHistory}
            fmtDate={fmtDate}
            fmtPrice={fmtPrice}
            unit={pos.unit ?? "?"}
          />
        </div>

        {/* Mini-Zellen: Kategorie + Einheit/Genutzt */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="bg-black/5 rounded-md px-3 py-2">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-0.5">Kategorie</div>
            <div className={`font-bold text-[14px] ${isErr ? "text-copper" : "text-ink"}`}>{meta?.label ?? pos.cat}</div>
          </div>
          <div className="bg-black/5 rounded-md px-3 py-2">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-0.5" title="Wie oft wurde diese Position in Angeboten eingesetzt">
              {pos.usedCount > 0 ? "Genutzt" : "Einheit"}
            </div>
            <div className="font-bold text-[14px] text-ink">
              {pos.usedCount > 0 ? `${pos.usedCount}×` : (isErr ? "—" : (pos.unit ?? "–"))}
            </div>
          </div>
        </div>

        {/* Kurztext */}
        {pos.shortText && (
          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-1" title="Kurztext: erscheint als Angebotszeile im PDF">
              Kurztext (Angebot)
            </div>
            <p className="font-sans text-[13.5px] text-ink-body leading-relaxed">{pos.shortText}</p>
          </div>
        )}

        {/* Zulagen-Block (Kupfer) — nur zugewiesene */}
        {!isErr && zulagen.length > 0 && (
          <div
            className="rounded-md px-3.5 py-2.5 mb-4"
            style={{ background: "#FDECD8", border: "1px solid #E8A97A", borderLeft: "3px solid #DC6E2D" }}
          >
            <div className="font-mono text-[10px] tracking-[.14em] uppercase mb-1.5" style={{ color: "#7A3510" }} title="Diese Aufschläge können zusätzlich ausgewiesen werden, wenn die Bedingung auf der Baustelle zutrifft">
              Erschwernis-Zulagen ({zulagen.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {zulagen.map((z) => (
                <span
                  key={z.id}
                  className="font-mono text-[11px] font-bold px-2 py-1 rounded-[5px] cursor-help"
                  style={{ background: "#FFF", border: "1px solid #E8A97A", color: "#7A3510" }}
                  title={`${z.id}: ${z.name}. Aufschlag ${z.surcharge ?? "–"}${z.longText ? ` — ${z.longText}` : ""}`}
                >
                  {z.id} {z.surcharge ?? ""}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Langtext (VOB) */}
        {pos.longText && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-ink-mute mb-1" title="Vollständiger Positionstext nach VOB für Leistungsverzeichnis und Angebots-PDF">
              Positionstext (VOB)
            </div>
            <p className="font-sans text-[12.5px] text-ink-body leading-[1.6] whitespace-pre-line">
              {pos.longText}
            </p>
          </div>
        )}

        {/* Aktionen */}
        <div className="flex items-center gap-2.5 flex-wrap pt-3.5 border-t border-steel-line/40">
          <button
            onClick={onEdit}
            aria-label={`Position ${pos.id} bearbeiten`}
            className="btn-primary !min-h-[44px] !px-5 text-[12px]"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={onMergeOpen}
            aria-label={`Position ${pos.id} mit anderer Position mergen`}
            title="Diese Position als Alias unter eine andere Position legen"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-copper/10 text-copper border border-copper/30 font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-copper/20 transition-colors !min-h-[44px]"
          >
            🔗 Mergen
          </button>
          {deleteConfirm === pos.id ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-sans text-[13px] text-rust font-semibold">Wirklich archivieren?</span>
              <button
                onClick={onDeleteConfirm}
                disabled={saving}
                aria-label="Archivierung bestätigen"
                className="inline-flex items-center px-3.5 py-2 rounded-md bg-rust text-white font-display font-extrabold uppercase tracking-wide text-[11px] hover:bg-red-700 transition-colors !min-h-[44px] disabled:opacity-50"
              >
                {saving ? "Archiviere …" : "Ja, archivieren"}
              </button>
              <button
                onClick={onDeleteCancel}
                aria-label="Archivierung abbrechen"
                className="btn-ghost !min-h-[44px] !px-4 text-[11px]"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              onClick={onDelete}
              aria-label={`Position ${pos.id} archivieren`}
              className="inline-flex items-center px-4 py-2 rounded-md bg-[#FEF2F2] text-rust border border-[#FECACA] font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-[#FECACA] transition-colors !min-h-[44px]"
            >
              Archivieren
            </button>
          )}
        </div>
      </div>
    </>
  );
}


/* ────────────────────────────────────────────────────────────────────────
   Positions-Modal (Neu anlegen + Bearbeiten) · helles App-Modal
   ──────────────────────────────────────────────────────────────────────── */
interface PositionModalProps {
  title: string;
  initial: LvPositionInput;
  errPositions: LvPosition[];
  saving: boolean;
  saveError: string | null;
  onSave: (input: LvPositionInput) => void;
  onCreateZulage: (input: LvPositionInput) => Promise<LvPosition>;
  onClose: () => void;
}

function PositionModal({
  title,
  initial,
  errPositions,
  saving,
  saveError,
  onSave,
  onCreateZulage,
  onClose,
}: PositionModalProps) {
  const [form, setForm] = useState<LvPositionInput>(initial);
  const isErr = form.cat === "ERR";

  /* lokale Zulagen-Liste — wächst wenn neue angelegt werden */
  const [localErr, setLocalErr] = useState<LvPosition[]>(errPositions);

  /* Mini-Formular für neue Zulage */
  const [showNewZ, setShowNewZ] = useState(false);
  const [newZ, setNewZ] = useState({ id: "", name: "", surcharge: "" });
  const [savingZ, setSavingZ] = useState(false);
  const [errorZ, setErrorZ] = useState<string | null>(null);

  /* nächste freie ERR-ID vorschlagen */
  const nextErrId = (() => {
    const nums = localErr
      .map((e) => parseInt(e.id.replace(/\D/g, ""), 10))
      .filter((n) => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `ERR-${String(max + 1).padStart(3, "0")}`;
  })();

  function toggle(zulagenId: string) {
    setForm((prev) => ({
      ...prev,
      zulagen: prev.zulagen?.includes(zulagenId)
        ? prev.zulagen.filter((z) => z !== zulagenId)
        : [...(prev.zulagen ?? []), zulagenId],
    }));
  }

  async function handleSaveNewZulage() {
    setSavingZ(true);
    setErrorZ(null);
    try {
      const created = await onCreateZulage({
        id: newZ.id.trim().toUpperCase(),
        cat: "ERR",
        name: newZ.name.trim(),
        price: null,
        unit: "",
        surcharge: newZ.surcharge.trim(),
        shortText: "",
        longText: "",
        zulagen: [],
      });
      setLocalErr((prev) => [...prev, created]);
      setForm((prev) => ({ ...prev, zulagen: [...(prev.zulagen ?? []), created.id] }));
      setShowNewZ(false);
      setNewZ({ id: "", name: "", surcharge: "" });
    } catch (err: unknown) {
      setErrorZ(err instanceof Error ? err.message : "Fehler beim Anlegen.");
    } finally {
      setSavingZ(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  const inputCls =
    "w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-copper";

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-[70] flex items-end lg:items-center justify-center p-0 lg:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto board-scroll"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="dd-eyebrow text-copper">Leistungsverzeichnis</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modal schließen"
            className="font-sans text-ink-2 text-[13px] hover:text-ink"
          >
            Schließen
          </button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl text-ink mb-5">{title}</h2>

        {/* Kategorie + ID */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">Kategorie</span>
            <select
              value={form.cat}
              onChange={(e) => setForm((p) => ({ ...p, cat: e.target.value }))}
              required
              aria-label="Kategorie auswählen"
              className={`${inputCls} !min-h-[44px]`}
            >
              {LV_CAT_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {LV_CATEGORIES[cat].label} ({cat})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">
              Positions-ID <span className="text-ink-mute font-normal">(z. B. PFL-007)</span>
            </span>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm((p) => ({ ...p, id: e.target.value.toUpperCase() }))}
              required
              placeholder="PFL-007"
              aria-label="Positions-ID"
              className={`${inputCls} font-mono tracking-wider !min-h-[44px]`}
            />
          </label>
        </div>

        {/* Name */}
        <label className="block mb-3">
          <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">Bezeichnung</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            required
            placeholder="Kurzer Positionsname …"
            aria-label="Positionsname"
            className={`${inputCls} !min-h-[44px]`}
          />
        </label>

        {/* Preis oder Aufschlag */}
        {isErr ? (
          <label className="block mb-3">
            <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">
              Aufschlag <span className="text-ink-mute font-normal">(z. B. +15 % oder +12 €/m²)</span>
            </span>
            <input
              type="text"
              value={form.surcharge ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, surcharge: e.target.value }))}
              placeholder="+15 %"
              aria-label="Aufschlag"
              className={`${inputCls} font-mono tracking-wider !min-h-[44px]`}
            />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">
                Festpreis (€) <span className="text-ink-mute font-normal">netto</span>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price ?? ""}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    price: e.target.value === "" ? null : parseFloat(e.target.value),
                  }))
                }
                placeholder="28"
                aria-label="Festpreis"
                className={`${inputCls} font-mono !min-h-[44px]`}
              />
            </label>
            <label className="block">
              <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">Einheit</span>
              <input
                type="text"
                value={form.unit ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                placeholder="m²"
                aria-label="Einheit"
                className={`${inputCls} font-mono !min-h-[44px]`}
              />
            </label>
          </div>
        )}

        {/* Kurztext */}
        <label className="block mb-3">
          <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">Kurztext</span>
          <textarea
            value={form.shortText ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, shortText: e.target.value }))}
            rows={2}
            placeholder="Kurze Leistungsbeschreibung für Angebote …"
            aria-label="Kurztext"
            className={`${inputCls} resize-none leading-relaxed`}
          />
        </label>

        {/* Langtext */}
        <label className="block mb-4">
          <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">
            Langtext (VOB) <span className="text-ink-mute font-normal">vollständige Leistungsbeschreibung</span>
          </span>
          <textarea
            value={form.longText ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, longText: e.target.value }))}
            rows={5}
            placeholder="Detaillierte VOB-konforme Leistungsbeschreibung …"
            aria-label="Langtext VOB"
            className={`${inputCls} resize-y leading-relaxed`}
          />
        </label>

        {/* Zulagen (nur für Arbeits-Positionen) */}
        {!isErr && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="font-sans text-[12.5px] font-bold text-ink-2">
                Zulagen zuweisen{" "}
                <span className="text-ink-mute font-normal">welche Erschwernis-Aufschläge kommen in Frage?</span>
              </span>
              {!showNewZ && (
                <button
                  type="button"
                  onClick={() => {
                    setNewZ({ id: nextErrId, name: "", surcharge: "" });
                    setShowNewZ(true);
                    setErrorZ(null);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-copper/10 text-copper border border-copper/25 font-display font-extrabold uppercase text-[10.5px] tracking-wide hover:bg-copper/20 transition-colors !min-h-[30px]"
                >
                  + Neue Zulage
                </button>
              )}
            </div>

            {/* Mini-Formular: neue Zulage anlegen */}
            {showNewZ && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mb-2 rounded-lg border border-copper/30 bg-[#FFF8F3] px-4 py-3"
              >
                <div className="font-mono text-[10px] tracking-[.14em] uppercase text-copper font-bold mb-2.5">
                  Neue Zulage anlegen
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <label className="block">
                    <span className="font-sans text-[11.5px] font-bold text-ink-2 block mb-1">ID</span>
                    <input
                      type="text"
                      value={newZ.id}
                      onChange={(e) => setNewZ((p) => ({ ...p, id: e.target.value.toUpperCase() }))}
                      required
                      placeholder="ERR-010"
                      className="w-full bg-white border border-steel rounded-md px-2.5 py-1.5 text-[13px] font-mono text-ink focus:outline-none focus:border-copper !min-h-[38px]"
                    />
                  </label>
                  <label className="block">
                    <span className="font-sans text-[11.5px] font-bold text-ink-2 block mb-1">Aufschlag</span>
                    <input
                      type="text"
                      value={newZ.surcharge}
                      onChange={(e) => setNewZ((p) => ({ ...p, surcharge: e.target.value }))}
                      placeholder="+15 %"
                      className="w-full bg-white border border-steel rounded-md px-2.5 py-1.5 text-[13px] font-mono text-ink focus:outline-none focus:border-copper !min-h-[38px]"
                    />
                  </label>
                </div>
                <label className="block mb-2">
                  <span className="font-sans text-[11.5px] font-bold text-ink-2 block mb-1">Bezeichnung</span>
                  <input
                    type="text"
                    value={newZ.name}
                    onChange={(e) => setNewZ((p) => ({ ...p, name: e.target.value }))}
                    required
                    placeholder="z. B. Klei-/Torfboden"
                    className="w-full bg-white border border-steel rounded-md px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-copper !min-h-[38px]"
                  />
                </label>
                {errorZ && (
                  <p className="text-rust text-[11.5px] mb-2">{errorZ}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveNewZulage}
                    disabled={savingZ}
                    className="inline-flex items-center px-3.5 py-1.5 rounded-md bg-copper text-white font-display font-extrabold uppercase text-[11px] tracking-wide hover:bg-copper-bright transition-colors disabled:opacity-50 !min-h-[36px]"
                  >
                    {savingZ ? "Anlegen …" : "Anlegen + zuweisen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewZ(false); setErrorZ(null); }}
                    className="inline-flex items-center px-3 py-1.5 rounded-md bg-black/5 text-ink-2 font-sans text-[12px] hover:bg-black/10 transition-colors !min-h-[36px]"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {localErr.length > 0 ? (
              <div className="border border-steel-line/50 rounded-lg overflow-hidden bg-white">
                {localErr.map((err) => {
                  const checked = form.zulagen?.includes(err.id) ?? false;
                  return (
                    <label
                      key={err.id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-[#F0F1F2] last:border-0 transition-colors ${
                        checked ? "bg-[#FFF8F3]" : "hover:bg-[#FAFAFA]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(err.id)}
                        aria-label={`Zulage ${err.id} aktivieren`}
                        className="w-4 h-4 rounded border-steel text-copper focus:ring-copper/50"
                      />
                      <span className="font-mono text-[11px] tracking-wider text-copper w-[68px] flex-shrink-0 font-bold">
                        {err.id}
                      </span>
                      <span className="flex-1 font-sans text-[13px] text-ink-body leading-snug">{err.name}</span>
                      <span className="font-mono text-[11px] font-bold text-ink-2 whitespace-nowrap">
                        {err.surcharge ?? "–"}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="font-sans text-[12.5px] text-ink-mute italic">
                Noch keine Zulagen angelegt. Mit „+ Neue Zulage" die erste erstellen.
              </p>
            )}
          </div>
        )}

        {/* Fehler */}
        {saveError && (
          <p className="text-rust text-[12.5px] font-sans mb-3 bg-rust/10 border border-rust/20 rounded-md px-3 py-2">
            {saveError}
          </p>
        )}

        {/* Buttons */}
        <div className="flex gap-3 flex-wrap">
          <button
            type="submit"
            disabled={saving}
            aria-label="Position speichern"
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? "Speichert …" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Abbrechen"
            className="btn-ghost flex-none !min-h-[56px] !px-5"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Preis-Verlauf · kleiner Toggle direkt unter dem Preis im Detail-Panel
   ──────────────────────────────────────────────────────────────────────── */
interface PriceHistoryToggleProps {
  historyRows: LvPriceHistoryEntry[] | null;
  historyLoading: boolean;
  showHistory: boolean;
  onToggle: () => void;
  fmtDate: (iso: string) => string;
  fmtPrice: (n: number | null) => string;
  unit: string;
}

function PriceHistoryToggle({
  historyRows, historyLoading, showHistory, onToggle, fmtDate, fmtPrice, unit,
}: PriceHistoryToggleProps) {
  // Wenn noch nicht geladen, gehen wir vom Default „N unbekannt" aus und
  // zeigen den Link aktiv — der Klick lädt und entscheidet dann.
  const n = historyRows?.length ?? null;
  const isEmpty = n === 0;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={isEmpty}
        title={isEmpty ? "noch keine Änderungen geloggt" : "Preis-Verlauf für diese Position"}
        className={`font-mono text-[10.5px] tracking-wider px-2 py-0.5 rounded border transition-colors ${
          isEmpty
            ? "border-steel-line/40 bg-black/5 text-ink-mute cursor-not-allowed"
            : "border-steel-line/60 bg-white text-ink-2 hover:border-copper hover:text-copper"
        }`}
      >
        📊 Preis-Verlauf {n !== null ? `(${n})` : ""} {!isEmpty ? (showHistory ? "▲" : "▼") : ""}
      </button>
      {showHistory && (
        <div className="mt-2 rounded-md bg-black/5 border border-steel-line/40 px-3 py-2">
          {historyLoading ? (
            <span className="font-mono text-[11px] text-ink-mute animate-pulse">lädt …</span>
          ) : historyRows && historyRows.length > 0 ? (
            <table className="w-full text-left">
              <tbody>
                {historyRows.map((h) => (
                  <tr key={h.id} className="border-b border-steel-line/20 last:border-0">
                    <td className="font-mono text-[11px] text-ink-mute py-1 pr-2 whitespace-nowrap">
                      {fmtDate(h.changedAt)}
                    </td>
                    <td className="font-mono text-[11.5px] text-ink py-1 pr-2 whitespace-nowrap">
                      {fmtPrice(h.oldPrice)} → <span className="font-bold text-copper">{fmtPrice(h.newPrice)}</span>
                      <span className="text-ink-mute"> €/{unit}</span>
                    </td>
                    {h.reason && (
                      <td className="font-sans text-[11px] text-ink-2 italic py-1 pl-1">{h.reason}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span className="font-mono text-[11px] text-ink-mute italic">noch keine Änderungen geloggt</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Merge-Modal · aktuelle Position als Alias unter einen Master legen
   ──────────────────────────────────────────────────────────────────────── */
interface MergeModalProps {
  source: LvPosition;
  positions: LvPosition[];
  saving: boolean;
  error: string | null;
  onConfirm: (masterId: string) => void;
  onClose: () => void;
}

function MergeModal({ source, positions, saving, error, onConfirm, onClose }: MergeModalProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const q = search.trim().toLowerCase();
  const candidates = positions
    .filter((p) => p.cat === source.cat && p.id !== source.id)
    .filter((p) =>
      q === "" ||
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const target = selected ? positions.find((p) => p.id === selected) ?? null : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-[80] flex items-end lg:items-center justify-center p-0 lg:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto board-scroll"
      >
        <div className="flex items-center justify-between mb-4">
          <span className="dd-eyebrow text-copper">Master-Merger</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modal schließen"
            className="font-sans text-ink-2 text-[13px] hover:text-ink"
          >
            Schließen
          </button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl text-ink mb-2">Position mergen</h2>
        <p className="font-sans text-[13px] text-ink-2 mb-4">
          <span className="font-mono font-bold text-copper">{source.id}</span>
          <span className="text-ink-mute"> · </span>
          <span className="text-ink">{source.name}</span>
          <span className="text-ink-mute"> wird zum Alias der ausgewählten Master-Position.</span>
        </p>

        {/* Searchbox */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Master-Position suchen (nur ${LV_CATEGORIES[source.cat]?.label ?? source.cat}) …`}
          aria-label="Master-Position suchen"
          className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-copper mb-3 !min-h-[44px]"
        />

        {/* Kandidaten-Liste */}
        <div className="border border-steel-line/50 rounded-lg overflow-hidden bg-white mb-4 max-h-[40vh] overflow-y-auto board-scroll">
          {candidates.length === 0 ? (
            <p className="font-sans text-[12.5px] text-ink-mute italic p-4">
              {q !== "" ? "Keine Treffer." : "Keine weiteren Positionen in dieser Kategorie."}
            </p>
          ) : (
            candidates.map((p) => {
              const isSel = selected === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelected(p.id); setConfirm(false); }}
                  aria-pressed={isSel}
                  className={`w-full text-left flex items-baseline gap-3 px-4 py-2.5 border-b border-[#F0F1F2] last:border-0 transition-colors ${
                    isSel ? "bg-[#FFF8F3] border-l-2 border-l-copper" : "hover:bg-[#FAFAFA]"
                  }`}
                >
                  <span className="font-mono text-[11px] tracking-wider font-bold text-copper w-[68px] flex-shrink-0">
                    {p.id}
                  </span>
                  <span className="flex-1 font-sans text-[13px] text-ink-body leading-snug truncate">
                    {p.name}
                  </span>
                  <span className="font-mono text-[11px] text-ink-2 whitespace-nowrap">
                    {priceStr(p)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Confirm-Hinweis + Aktion */}
        {target && (
          <div className="rounded-lg border border-copper/30 bg-[#FFF8F3] px-4 py-3 mb-3">
            <div className="font-mono text-[10px] tracking-[.14em] uppercase text-copper font-bold mb-1.5">
              Bestätigung
            </div>
            <p className="font-sans text-[13px] text-ink-body leading-relaxed">
              <span className="font-mono font-bold text-copper">{source.id}</span> wird in{" "}
              <span className="font-mono font-bold text-copper">{target.id}</span> gemergt. Preis wird ggf. auf MAX(
              {source.id}, {target.id}) gesetzt. Reversibel über Alias-Badge entfernen.
            </p>
          </div>
        )}

        {error && (
          <p className="text-rust text-[12.5px] font-sans mb-3 bg-rust/10 border border-rust/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => { if (target) { if (confirm) onConfirm(target.id); else setConfirm(true); } }}
            disabled={!target || saving}
            aria-label="Diese Position als Master setzen"
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? "Merge läuft …" : confirm ? "Wirklich? Endgültig mergen" : "Diese Position als Master setzen"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Abbrechen"
            className="btn-ghost flex-none !min-h-[56px] !px-5"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
