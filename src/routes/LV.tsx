import { useEffect, useRef, useState } from "react";
import BackButton from "../components/BackButton";
import {
  LV_CATEGORIES,
  LV_CAT_ORDER,
  listLvPositions,
  createLvPosition,
  updateLvPosition,
  archiveLvPosition,
} from "../lib/lv";
import type { LvPosition, LvPositionInput } from "../lib/types";

/* ────────────────────────────────────────────────────────────────────────
   Leistungsverzeichnis · 3-spaltige Master-Detail-Ansicht
   Stahl-und-Beton-Design-System · Copper-Akzente für ERR-Zulagen
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
  const [activeCat, setActiveCat] = useState<string>("PFL");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    listLvPositions()
      .then((data) => {
        setPositions(data);
        setLoading(false);
        const first = data.find((p) => p.cat === "PFL");
        if (first) setActiveId(first.id);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        setLoading(false);
      });
  }, []);

  const filtered = positions.filter(
    (p) =>
      p.cat === activeCat &&
      (search === "" ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase()))
  );
  const errPositions = positions.filter((p) => p.cat === "ERR");
  const activePos = positions.find((p) => p.id === activeId) ?? null;

  /* Zähler je Kategorie (ohne archived) */
  const catCount = (cat: string) => positions.filter((p) => p.cat === cat).length;

  /* Neue Position speichern */
  async function handleCreate(input: LvPositionInput) {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createLvPosition(input);
      setPositions((prev) => [...prev, created].sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id)));
      setActiveCat(created.cat);
      setActiveId(created.id);
      setShowNew(false);
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

  /* Position archivieren */
  async function handleArchive(id: string) {
    setSaving(true);
    setSaveError(null);
    try {
      await archiveLvPosition(id);
      setPositions((prev) => prev.filter((p) => p.id !== id));
      setActiveId(null);
      setDeleteConfirm(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Archivieren fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  /* Wenn Kategorie wechselt, ersten Eintrag selektieren */
  function switchCat(cat: string) {
    setActiveCat(cat);
    setSearch("");
    const first = positions.find((p) => p.cat === cat);
    setActiveId(first?.id ?? null);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[1700px] mx-auto px-5 lg:px-10 xl:px-14 pt-4 pb-4">
          <BackButton to="/admin" label="Zur Übersicht" />
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 flex-wrap">
            <div>
              <span className="dd-eyebrow text-copper-bright block">Stammdaten</span>
              <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
                Leistungsverzeichnis
              </h1>
              {!loading && (
                <p className="font-mono text-[11px] mt-1.5 tracking-wide text-steel">
                  {positions.length} Positionen in {Object.keys(LV_CATEGORIES).length} Kategorien
                </p>
              )}
            </div>
            <button
              onClick={() => { setShowNew(true); setSaveError(null); }}
              aria-label="Neue Position anlegen"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-copper text-white font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-copper-bright transition-colors !min-h-[56px]"
            >
              + Neue Position
            </button>
          </div>
        </div>
      </header>

      {/* ── Fehler beim Laden ── */}
      {loadError && (
        <div className="mx-5 lg:mx-10 mt-4 bg-rust/15 border border-rust/40 rounded-xl p-4">
          <div className="dd-eyebrow text-rust">Fehler beim Laden</div>
          <p className="text-sm text-paper mt-1">{loadError}</p>
        </div>
      )}

      {/* ── 3-Spalten-Layout ── */}
      <div className="flex flex-1 overflow-hidden max-w-[1700px] w-full mx-auto">

        {/* ── Linke Spalte: Kategorien (200 px) ── */}
        <aside className="hidden lg:flex flex-col w-[200px] flex-shrink-0 surface-steel border-r border-white/10 py-4">
          <p className="dd-eyebrow text-steel px-4 mb-3">Kategorien</p>
          <nav className="flex flex-col gap-0.5 px-2">
            {LV_CAT_ORDER.map((cat) => {
              const meta = LV_CATEGORIES[cat];
              const isErr = cat === "ERR";
              const isActive = activeCat === cat;
              return (
                <button
                  key={cat}
                  onClick={() => switchCat(cat)}
                  aria-label={`Kategorie ${meta.label}`}
                  aria-pressed={isActive}
                  className={`relative flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-left transition-colors ${
                    isActive
                      ? isErr
                        ? "bg-copper/20 text-copper-bright"
                        : "bg-white/12 text-white"
                      : "text-white/60 hover:bg-white/6 hover:text-white/85"
                  }`}
                >
                  {/* Akzentlinie links bei aktivem Eintrag */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                      style={{ background: isErr ? "#DC6E2D" : "#DC6E2D" }}
                    />
                  )}
                  <span
                    className={`font-display font-black uppercase text-[13px] tracking-wide leading-none ${
                      isErr ? (isActive ? "text-copper-bright" : "text-copper/70") : ""
                    }`}
                  >
                    {meta.label}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded-sm leading-none ${
                      isActive
                        ? isErr ? "bg-copper/30 text-copper-bright" : "bg-white/15 text-white"
                        : "bg-white/8 text-white/40"
                    }`}
                  >
                    {catCount(cat)}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Mittlere Spalte: Positions-Liste (320 px) ── */}
        <section className="hidden lg:flex flex-col w-[320px] flex-shrink-0 bg-[#191B1E] border-r border-white/8 overflow-hidden">
          {/* Suchfeld */}
          <div className="px-3 py-3 border-b border-white/8">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suche: ID oder Name ..."
              aria-label="Positionen durchsuchen"
              className="w-full bg-white/6 border border-white/12 rounded-md px-3 py-2 text-[13px] font-sans text-white placeholder:text-white/30 focus:outline-none focus:border-copper/60 transition-colors"
            />
          </div>

          {/* Kategorie-Header (mobile: Tab-Leiste) */}
          <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between">
            <span className="dd-eyebrow text-copper">
              {LV_CATEGORIES[activeCat]?.label ?? activeCat}
            </span>
            <span className="font-mono text-[10px] text-white/40">
              {filtered.length} Pos.
            </span>
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="font-mono text-[11px] text-white/30 animate-pulse">Lädt ...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <span className="font-mono text-[11px] text-white/30 uppercase tracking-wider">
                  {search ? "Keine Treffer" : "Noch keine Positionen"}
                </span>
                {!search && (
                  <button
                    onClick={() => { setShowNew(true); setSaveError(null); }}
                    className="dd-eyebrow text-copper hover:underline mt-1"
                  >
                    + Erste Position anlegen
                  </button>
                )}
              </div>
            ) : (
              filtered.map((p) => {
                const isActive = p.id === activeId;
                const isErr = p.cat === "ERR";
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    aria-label={`Position ${p.id} auswählen: ${p.name}`}
                    aria-pressed={isActive}
                    className={`w-full text-left px-4 py-3.5 border-b border-white/6 transition-colors ${
                      isActive
                        ? "bg-white/10 border-l-2 border-l-copper"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="font-mono text-[11px] tracking-wider font-bold leading-none"
                        style={{ color: isErr ? "#DC6E2D" : "#DC6E2D" }}
                      >
                        {p.id}
                      </span>
                      <span className="font-mono text-[10.5px] text-white/45 whitespace-nowrap leading-none">
                        {priceStr(p)}
                      </span>
                    </div>
                    <div className="mt-1.5 font-sans text-[13px] font-semibold text-white/85 leading-snug line-clamp-2">
                      {p.name}
                    </div>
                    {p.zulagen.length > 0 && (
                      <div className="mt-1.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-copper/15 text-copper-bright font-mono text-[9.5px] tracking-wider uppercase">
                          {p.zulagen.length} Zulage{p.zulagen.length !== 1 ? "n" : ""}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* ── Mobile: Kategorie-Tabs + Liste ── */}
        <div className="lg:hidden flex flex-col flex-1 overflow-hidden">
          {/* Kategorie-Tabs */}
          <div className="flex overflow-x-auto bg-[#191B1E] border-b border-white/8 px-3 py-2 gap-1.5">
            {LV_CAT_ORDER.map((cat) => {
              const meta = LV_CATEGORIES[cat];
              const isActive = activeCat === cat;
              return (
                <button
                  key={cat}
                  onClick={() => switchCat(cat)}
                  aria-label={`Kategorie ${meta.label}`}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-md font-display font-black uppercase text-[11px] tracking-wide transition-colors ${
                    isActive
                      ? cat === "ERR" ? "bg-copper text-white" : "bg-white/15 text-white"
                      : "text-white/50 hover:text-white/75"
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          {/* Suche */}
          <div className="px-3 py-2 bg-[#191B1E] border-b border-white/8">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suche ..."
              aria-label="Positionen durchsuchen"
              className="w-full bg-white/6 border border-white/12 rounded-md px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-copper/60"
            />
          </div>
          {/* Mobile: Liste + Detail in einem Scroll */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map((p) => (
              <div
                key={p.id}
                className={`border-b border-white/6 ${p.id === activeId ? "bg-white/8" : ""}`}
              >
                <button
                  className="w-full text-left px-4 py-3"
                  onClick={() => setActiveId(p.id === activeId ? null : p.id)}
                  aria-label={`Position ${p.id} Details`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-copper-bright tracking-wider">{p.id}</span>
                    <span className="font-mono text-[10.5px] text-white/40">{priceStr(p)}</span>
                  </div>
                  <div className="mt-1 font-sans text-[14px] font-semibold text-white/85">{p.name}</div>
                </button>
                {p.id === activeId && (
                  <DetailPanel
                    pos={p}
                    errPositions={errPositions}
                    onEdit={() => { setEditId(p.id); setSaveError(null); }}
                    onDelete={() => setDeleteConfirm(p.id)}
                    deleteConfirm={deleteConfirm}
                    onDeleteConfirm={() => handleArchive(p.id)}
                    onDeleteCancel={() => setDeleteConfirm(null)}
                    saving={saving}
                    className="px-4 pb-4"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Rechte Spalte: Detail-Panel (flex 1) ── */}
        <section className="hidden lg:flex flex-col flex-1 bg-white overflow-y-auto">
          {activePos ? (
            <DetailPanel
              pos={activePos}
              errPositions={errPositions}
              onEdit={() => { setEditId(activePos.id); setSaveError(null); }}
              onDelete={() => setDeleteConfirm(activePos.id)}
              deleteConfirm={deleteConfirm}
              onDeleteConfirm={() => handleArchive(activePos.id)}
              onDeleteCancel={() => setDeleteConfirm(null)}
              saving={saving}
            />
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-3">
              <span className="font-display font-black uppercase text-[13px] tracking-wide text-[#9CA3AF]">
                Position auswählen
              </span>
              <p className="font-mono text-[11px] text-[#C9CCCF] text-center max-w-[200px]">
                Eine Position aus der Liste links anklicken, um Details anzuzeigen.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ── Fehler beim Speichern (global, unter Header) ── */}
      {saveError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-rust/90 text-white px-4 py-2.5 rounded-lg font-sans text-[13px] shadow-lg">
          {saveError}
        </div>
      )}

      {/* ── Modal: Neue Position ── */}
      {showNew && (
        <PositionModal
          title="Neue Position"
          initial={emptyForm(activeCat)}
          errPositions={errPositions}
          saving={saving}
          saveError={saveError}
          onSave={handleCreate}
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
            onClose={() => { setEditId(null); setSaveError(null); }}
          />
        );
      })()}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Detail-Panel
   ──────────────────────────────────────────────────────────────────────── */
interface DetailPanelProps {
  pos: LvPosition;
  errPositions: LvPosition[];
  onEdit: () => void;
  onDelete: () => void;
  deleteConfirm: string | null;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  saving: boolean;
  className?: string;
}

function DetailPanel({
  pos,
  errPositions,
  onEdit,
  onDelete,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
  saving,
  className = "",
}: DetailPanelProps) {
  const isErr = pos.cat === "ERR";
  const meta = LV_CATEGORIES[pos.cat];

  /* Tooltip-State für Zulage-Hover */
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  return (
    <article className={`p-6 lg:p-8 ${className}`}>
      {/* ── Kategorie-Badge + ID ── */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <span
          className="inline-flex items-center px-2.5 py-1 rounded font-mono text-[10px] tracking-wider uppercase font-bold"
          style={{
            background: isErr ? "rgba(220,110,45,0.12)" : "rgba(60,70,80,0.10)",
            color: isErr ? "#DC6E2D" : "#6A6E72",
            border: `1px solid ${isErr ? "rgba(220,110,45,0.25)" : "rgba(100,110,120,0.18)"}`,
          }}
        >
          {meta?.label ?? pos.cat}
        </span>
        <span className="font-mono text-[13px] font-bold tracking-wider" style={{ color: "#DC6E2D" }}>
          {pos.id}
        </span>
      </div>

      {/* ── Name ── */}
      <h2 className="font-display font-black uppercase text-xl lg:text-2xl text-[#1A1C1F] leading-tight mb-5">
        {pos.name}
      </h2>

      {/* ── Preis-Meta-Grid ── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {isErr ? (
          <MetaCell label="Aufschlag" value={pos.surcharge ?? "–"} mono copper />
        ) : (
          <>
            <MetaCell label="Festpreis" value={priceStr(pos)} mono copper />
            <MetaCell label="Einheit" value={pos.unit ?? "–"} mono />
          </>
        )}
        <MetaCell label="Kategorie" value={pos.cat} mono />
        {pos.usedCount > 0 && (
          <MetaCell label="Genutzt" value={`${pos.usedCount}x`} mono />
        )}
      </div>

      {/* ── Kurztext ── */}
      {pos.shortText && (
        <div className="mb-4">
          <h3 className="dd-eyebrow text-[#6A6E72] mb-1.5">Kurztext</h3>
          <p className="text-[14px] text-[#2A2D31] leading-relaxed font-sans">{pos.shortText}</p>
        </div>
      )}

      {/* ── Langtext ── */}
      {pos.longText && (
        <div className="mb-5">
          <h3 className="dd-eyebrow text-[#6A6E72] mb-1.5">Langtext (VOB)</h3>
          <p className="text-[13.5px] text-[#3A3E42] leading-relaxed font-sans whitespace-pre-line">
            {pos.longText}
          </p>
        </div>
      )}

      {/* ── Zulagen-Tabelle ── */}
      {!isErr && (
        <div className="mb-6">
          <h3 className="dd-eyebrow text-[#6A6E72] mb-2">
            Erschwernis-Zulagen ({errPositions.length})
          </h3>
          <div className="border border-[#E5E7EA] rounded-lg overflow-hidden relative">
            {errPositions.map((err, idx) => {
              const isChecked = pos.zulagen.includes(err.id);
              const isTooltipVisible = tooltipId === err.id;
              return (
                <div
                  key={err.id}
                  className={`flex items-center gap-3 px-4 py-2.5 border-b border-[#F0F1F2] last:border-0 transition-colors ${
                    isChecked ? "bg-[#FFF8F3]" : idx % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"
                  }`}
                  onMouseEnter={() => setTooltipId(err.id)}
                  onMouseLeave={() => setTooltipId(null)}
                >
                  {/* Checkbox (optisch, keine Klick-Funktion im Detail-View) */}
                  <span
                    aria-hidden
                    className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${
                      isChecked
                        ? "bg-copper border-copper"
                        : "bg-white border-[#D1D5DB]"
                    }`}
                  >
                    {isChecked && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white fill-current">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="font-mono text-[11px] tracking-wider text-copper-bright w-[68px] flex-shrink-0 font-bold">
                    {err.id}
                  </span>
                  <span className="flex-1 text-[13px] text-[#2A2D31] font-sans leading-snug">
                    {err.name}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[#6A6E72] whitespace-nowrap">
                    {err.surcharge ?? "–"}
                  </span>

                  {/* Floating Tooltip */}
                  {isTooltipVisible && err.longText && (
                    <div
                      ref={tooltipRef}
                      role="tooltip"
                      className="absolute left-full top-0 ml-2 z-20 w-72 p-3.5 rounded-lg shadow-2xl text-left pointer-events-none"
                      style={{
                        background: "#1A1C1F",
                        border: "1px solid rgba(220,110,45,0.4)",
                      }}
                    >
                      <div className="font-mono text-[10px] tracking-wider text-copper-bright mb-1.5 uppercase">{err.id}</div>
                      <div className="font-sans font-bold text-[12.5px] text-white mb-1.5 leading-snug">{err.name}</div>
                      <p className="font-sans text-[11.5px] text-[#C9CCCF] leading-relaxed">{err.longText}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Aktions-Buttons ── */}
      <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-[#E5E7EA]">
        <button
          onClick={onEdit}
          aria-label={`Position ${pos.id} bearbeiten`}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-md bg-[#1A1C1F] text-white font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-[#DC6E2D] transition-colors !min-h-[56px]"
        >
          Bearbeiten
        </button>

        {deleteConfirm === pos.id ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-sans text-[13px] text-[#B91C1C] font-semibold">
              Wirklich archivieren?
            </span>
            <button
              onClick={onDeleteConfirm}
              disabled={saving}
              aria-label="Archivierung bestätigen"
              className="inline-flex items-center px-3 py-2.5 rounded-md bg-[#B91C1C] text-white font-display font-extrabold uppercase tracking-wide text-[11px] hover:bg-red-700 transition-colors !min-h-[56px] disabled:opacity-50"
            >
              {saving ? "Archiviere ..." : "Ja, archivieren"}
            </button>
            <button
              onClick={onDeleteCancel}
              aria-label="Archivierung abbrechen"
              className="inline-flex items-center px-3 py-2.5 rounded-md bg-[#F0F1F2] text-[#3A3E42] font-display font-extrabold uppercase tracking-wide text-[11px] hover:bg-[#E5E7EA] transition-colors !min-h-[56px]"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <button
            onClick={onDelete}
            aria-label={`Position ${pos.id} archivieren`}
            className="inline-flex items-center px-4 py-3 rounded-md bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-[#FECACA] transition-colors !min-h-[56px]"
          >
            Archivieren
          </button>
        )}
      </div>
    </article>
  );
}

/* ── Kleine Metadaten-Zelle ──────────────────────────────────────────────── */
function MetaCell({
  label,
  value,
  mono = false,
  copper = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copper?: boolean;
}) {
  return (
    <div className="bg-[#F8F9FA] rounded-lg px-3 py-2.5">
      <div className="font-mono text-[9.5px] tracking-wider text-[#9CA3AF] uppercase mb-1">{label}</div>
      <div
        className={`text-[14px] font-bold leading-none ${
          mono ? "font-mono" : "font-sans"
        } ${copper ? "text-copper" : "text-[#1A1C1F]"}`}
      >
        {value}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Positions-Modal (Neu anlegen + Bearbeiten)
   ──────────────────────────────────────────────────────────────────────── */
interface PositionModalProps {
  title: string;
  initial: LvPositionInput;
  errPositions: LvPosition[];
  saving: boolean;
  saveError: string | null;
  onSave: (input: LvPositionInput) => void;
  onClose: () => void;
}

function PositionModal({
  title,
  initial,
  errPositions,
  saving,
  saveError,
  onSave,
  onClose,
}: PositionModalProps) {
  const [form, setForm] = useState<LvPositionInput>(initial);
  const isErr = form.cat === "ERR";

  function toggle(zulagenId: string) {
    setForm((prev) => ({
      ...prev,
      zulagen: prev.zulagen?.includes(zulagenId)
        ? prev.zulagen.filter((z) => z !== zulagenId)
        : [...(prev.zulagen ?? []), zulagenId],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end lg:items-center justify-center p-0 lg:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-baseline justify-between mb-4">
          <span className="dd-eyebrow text-copper">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modal schließen"
            className="dd-eyebrow text-ink-2 hover:text-white transition-colors"
          >
            Schließen
          </button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl text-white mb-5">{title}</h2>

        {/* Kategorie + ID */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="dd-eyebrow text-steel block mb-1.5">Kategorie</label>
            <select
              value={form.cat}
              onChange={(e) => setForm((p) => ({ ...p, cat: e.target.value }))}
              required
              aria-label="Kategorie auswählen"
              className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-sans focus:outline-none focus:border-copper/60 !min-h-[44px]"
            >
              {LV_CAT_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {LV_CATEGORIES[cat].label} ({cat})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="dd-eyebrow text-steel block mb-1.5">
              Positions-ID
              <span className="text-white/30 ml-1">(z.B. PFL-007)</span>
            </label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm((p) => ({ ...p, id: e.target.value.toUpperCase() }))}
              required
              placeholder="PFL-007"
              aria-label="Positions-ID"
              className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-mono tracking-wider focus:outline-none focus:border-copper/60 !min-h-[44px]"
            />
          </div>
        </div>

        {/* Name */}
        <div className="mb-3">
          <label className="dd-eyebrow text-steel block mb-1.5">Bezeichnung</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            required
            placeholder="Kurzer Positionsname ..."
            aria-label="Positionsname"
            className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-sans focus:outline-none focus:border-copper/60 !min-h-[44px]"
          />
        </div>

        {/* Preis oder Aufschlag */}
        {isErr ? (
          <div className="mb-3">
            <label className="dd-eyebrow text-steel block mb-1.5">
              Aufschlag
              <span className="text-white/30 ml-1">(z.B. +15% oder +€12/m²)</span>
            </label>
            <input
              type="text"
              value={form.surcharge ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, surcharge: e.target.value }))}
              placeholder="+15%"
              aria-label="Aufschlag"
              className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-mono tracking-wider focus:outline-none focus:border-copper/60 !min-h-[44px]"
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="dd-eyebrow text-steel block mb-1.5">
                Festpreis (€)
                <span className="text-white/30 ml-1">ohne Mehrwertsteuer</span>
              </label>
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
                className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-mono focus:outline-none focus:border-copper/60 !min-h-[44px]"
              />
            </div>
            <div>
              <label className="dd-eyebrow text-steel block mb-1.5">Einheit</label>
              <input
                type="text"
                value={form.unit ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                placeholder="m²"
                aria-label="Einheit"
                className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-mono focus:outline-none focus:border-copper/60 !min-h-[44px]"
              />
            </div>
          </div>
        )}

        {/* Kurztext */}
        <div className="mb-3">
          <label className="dd-eyebrow text-steel block mb-1.5">Kurztext</label>
          <textarea
            value={form.shortText ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, shortText: e.target.value }))}
            rows={2}
            placeholder="Kurze Leistungsbeschreibung für Angebote ..."
            aria-label="Kurztext"
            className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-sans focus:outline-none focus:border-copper/60 resize-none leading-relaxed"
          />
        </div>

        {/* Langtext */}
        <div className="mb-4">
          <label className="dd-eyebrow text-steel block mb-1.5">
            Langtext (VOB)
            <span className="text-white/30 ml-1">vollständige Leistungsbeschreibung</span>
          </label>
          <textarea
            value={form.longText ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, longText: e.target.value }))}
            rows={5}
            placeholder="Detaillierte VOB-konforme Leistungsbeschreibung ..."
            aria-label="Langtext VOB"
            className="w-full bg-bg-3 border border-white/15 rounded-md px-3 py-2.5 text-[13px] text-white font-sans focus:outline-none focus:border-copper/60 resize-y leading-relaxed"
          />
        </div>

        {/* Zulagen (nur für Nicht-ERR-Positionen) */}
        {!isErr && errPositions.length > 0 && (
          <div className="mb-5">
            <h3 className="dd-eyebrow text-steel mb-2">
              Zulagen zuweisen
              <span className="text-white/30 ml-1">welche Erschwernis-Aufschläge kommen in Frage?</span>
            </h3>
            <div className="border border-white/12 rounded-lg overflow-hidden">
              {errPositions.map((err) => {
                const checked = form.zulagen?.includes(err.id) ?? false;
                return (
                  <label
                    key={err.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-white/6 last:border-0 transition-colors ${
                      checked ? "bg-copper/10" : "hover:bg-white/4"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(err.id)}
                      aria-label={`Zulage ${err.id} aktivieren`}
                      className="w-4 h-4 rounded border-white/30 bg-bg-3 text-copper focus:ring-copper/50"
                    />
                    <span className="font-mono text-[11px] tracking-wider text-copper-bright w-[68px] flex-shrink-0 font-bold">
                      {err.id}
                    </span>
                    <span className="flex-1 text-[13px] text-white/75 font-sans leading-snug">{err.name}</span>
                    <span className="font-mono text-[11px] font-bold text-white/40 whitespace-nowrap">
                      {err.surcharge ?? "–"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Fehler */}
        {saveError && (
          <p className="text-rust text-[12px] font-sans mb-3 bg-rust/10 border border-rust/20 rounded-md px-3 py-2">
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
            {saving ? "Speichert ..." : "Speichern"}
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
