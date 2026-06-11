import { useEffect, useState } from "react";
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
   Leistungsverzeichnis · App-konformer Flow:
   Stahl-Header + Kategorie-Chips → dd-card-Kacheln im Grid (wie Baustellen)
   → Detail im dd-drawer von rechts (wie Angebote). Anlegen/Bearbeiten im
   hellen Modal (App-Standard). Normale Seiten-Scrollung.
   ──────────────────────────────────────────────────────────────────────── */

function priceStr(p: LvPosition): string {
  if (p.surcharge) return p.surcharge;
  if (p.price === null) return "–";
  const fmt = p.price % 1 === 0 ? `${p.price}` : p.price.toFixed(2).replace(".", ",");
  return `${fmt} €/${p.unit ?? "?"}`;
}

/* Akzentfarbe der Karten-Kante (--c der dd-card): Zulagen kupfern, Rest Stahl */
function catAccent(cat: string): string {
  return cat === "ERR" ? "#DC6E2D" : "#8B9197";
}

/* ── Leerer Formular-State ─────────────────────────────────────────────── */
function emptyForm(cat: string): LvPositionInput {
  return {
    id: "",
    cat: cat === "ALLE" ? "PFL" : cat,
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
  const [activeCat, setActiveCat] = useState<string>("ALLE");
  const [drawerId, setDrawerId] = useState<string | null>(null);
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
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        setLoading(false);
      });
  }, []);

  const q = search.trim().toLowerCase();
  const matches = (p: LvPosition) =>
    q === "" ||
    p.name.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.shortText ?? "").toLowerCase().includes(q);

  const visibleCats = activeCat === "ALLE" ? [...LV_CAT_ORDER] : [activeCat];
  const grouped = visibleCats
    .map((cat) => ({
      cat,
      items: positions.filter((p) => p.cat === cat && matches(p)),
    }))
    .filter((g) => g.items.length > 0);
  const visibleCount = grouped.reduce((n, g) => n + g.items.length, 0);

  const errPositions = positions.filter((p) => p.cat === "ERR");
  const drawerPos = positions.find((p) => p.id === drawerId) ?? null;

  const catCount = (cat: string) =>
    cat === "ALLE" ? positions.length : positions.filter((p) => p.cat === cat).length;

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
      setDrawerId(created.id);
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
      setDeleteConfirm(null);
      setDrawerId(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Archivieren fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen safe-bottom">
      {/* ── Stahl-Header · konsistent mit Baustellen/Angebote ── */}
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[2400px] mx-auto px-5 lg:px-10 xl:px-14 pt-4 pb-4">
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-copper text-white font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-copper-bright transition-colors !min-h-[44px]"
            >
              + Neue Position
            </button>
          </div>

          {/* Filter-Zeile: Kategorie-Chips + Suche */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <div className="flex gap-1.5 overflow-x-auto board-scroll py-0.5 -my-0.5 flex-1 min-w-0">
              {["ALLE", ...LV_CAT_ORDER].map((cat) => {
                const isActive = activeCat === cat;
                const isErr = cat === "ERR";
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCat(cat)}
                    aria-pressed={isActive}
                    aria-label={`Kategorie ${cat === "ALLE" ? "Alle" : LV_CATEGORIES[cat].label}`}
                    className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-display font-extrabold uppercase text-[11.5px] tracking-wide transition-colors !min-h-[36px] ${
                      isActive
                        ? isErr
                          ? "bg-copper text-white"
                          : "bg-white/20 text-white"
                        : "bg-white/8 text-white/65 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    {cat === "ALLE" ? "Alle" : LV_CATEGORIES[cat].label}
                    <span className={`font-mono text-[10px] leading-none px-1.5 py-0.5 rounded-sm ${
                      isActive ? "bg-black/20 text-white" : "bg-white/10 text-white/45"
                    }`}>
                      {catCount(cat)}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suche: ID, Name, Kurztext …"
              aria-label="Positionen durchsuchen"
              className="w-full lg:w-[280px] flex-shrink-0 bg-white/10 border border-white/20 rounded-md px-3 py-2 text-[13px] font-sans text-white placeholder:text-white/40 focus:outline-none focus:border-copper-bright transition-colors !min-h-[40px]"
            />
          </div>
        </div>
      </header>

      {/* ── Inhalt ── */}
      <main className="w-full max-w-[2400px] mx-auto px-5 lg:px-10 xl:px-14 py-6">
        {loadError && (
          <div className="bg-rust/15 border border-rust/40 rounded-xl p-4 mb-5">
            <div className="dd-eyebrow text-rust">Fehler beim Laden</div>
            <p className="text-sm text-paper mt-1">{loadError}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="font-mono text-[12px] text-white/40 animate-pulse">Lädt …</span>
          </div>
        ) : visibleCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="font-mono text-[12px] text-white/40 uppercase tracking-wider">
              {search ? "Keine Treffer" : "Noch keine Positionen"}
            </span>
            {!search && (
              <button
                onClick={() => { setShowNew(true); setSaveError(null); }}
                className="dd-eyebrow text-copper-bright hover:underline mt-1"
              >
                + Erste Position anlegen
              </button>
            )}
          </div>
        ) : (
          grouped.map(({ cat, items }) => (
            <section key={cat} className="mb-8 last:mb-0">
              <div className="flex items-baseline gap-2.5 mb-3">
                <h2 className={`dd-eyebrow ${cat === "ERR" ? "text-copper-bright" : "text-steel"}`}>
                  {LV_CATEGORIES[cat]?.label ?? cat}
                </h2>
                <span className="font-mono text-[10px] text-white/35">{items.length} Pos.</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3">
                {items.map((p) => (
                  <PositionCard
                    key={p.id}
                    pos={p}
                    onOpen={() => { setDrawerId(p.id); setDeleteConfirm(null); }}
                    onEdit={() => { setEditId(p.id); setSaveError(null); }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* ── Detail-Drawer (wie Angebote/Anfragen) ── */}
      {drawerPos && (
        <PositionDrawer
          pos={drawerPos}
          errPositions={errPositions}
          onClose={() => { setDrawerId(null); setDeleteConfirm(null); }}
          onEdit={() => { setEditId(drawerPos.id); setSaveError(null); }}
          deleteConfirm={deleteConfirm}
          onDelete={() => setDeleteConfirm(drawerPos.id)}
          onDeleteConfirm={() => handleArchive(drawerPos.id)}
          onDeleteCancel={() => setDeleteConfirm(null)}
          saving={saving}
        />
      )}

      {/* ── Fehler beim Speichern (global) ── */}
      {saveError && !showNew && !editId && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] bg-rust/90 text-white px-4 py-2.5 rounded-lg font-sans text-[13px] shadow-lg">
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
   Positions-Kachel · dd-card wie im Baustellen-Grid
   ──────────────────────────────────────────────────────────────────────── */
function PositionCard({
  pos,
  onOpen,
  onEdit,
}: {
  pos: LvPosition;
  onOpen: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className="dd-card is-click p-4"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={{ ["--c" as any]: catAccent(pos.cat) }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="h-mono text-copper text-[11px] font-bold tracking-wider">{pos.id}</span>
        <span className="h-mono text-ink-2 text-[11px] whitespace-nowrap font-bold">{priceStr(pos)}</span>
      </div>
      <div className="font-display text-lg uppercase tracking-tight leading-tight mt-1">
        {pos.name}
      </div>
      {pos.shortText && (
        <p className="font-sans text-[12.5px] text-ink-2 leading-snug mt-1.5 line-clamp-2">
          {pos.shortText}
        </p>
      )}
      {(pos.zulagen.length > 0 || pos.usedCount > 0) && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {pos.zulagen.length > 0 && (
            <span className="dd-chip !text-[11px]">
              {pos.zulagen.length} Zulage{pos.zulagen.length !== 1 ? "n" : ""}
            </span>
          )}
          {pos.usedCount > 0 && (
            <span className="dd-chip !text-[11px]">Genutzt {pos.usedCount}×</span>
          )}
        </div>
      )}
      <div className="flex gap-2 mt-3 pt-3 border-t border-ink/10" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEdit} className="btn-ghost text-[11px] flex-1">Bearbeiten</button>
        <button onClick={onOpen} className="btn-ghost text-[11px] flex-1">Details</button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Detail-Drawer · dd-drawer von rechts wie im Angebote-Board
   ──────────────────────────────────────────────────────────────────────── */
interface PositionDrawerProps {
  pos: LvPosition;
  errPositions: LvPosition[];
  onClose: () => void;
  onEdit: () => void;
  deleteConfirm: string | null;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  saving: boolean;
}

function PositionDrawer({
  pos,
  errPositions,
  onClose,
  onEdit,
  deleteConfirm,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
  saving,
}: PositionDrawerProps) {
  const isErr = pos.cat === "ERR";
  const meta = LV_CATEGORIES[pos.cat];
  const [tooltipId, setTooltipId] = useState<string | null>(null);

  return (
    <>
      <div className="dd-scrim on" onClick={onClose} />
      <aside
        className="dd-drawer on"
        role="dialog"
        aria-modal="true"
        aria-label="Positions-Detail"
        style={{ width: "min(720px, 100%)" }}
      >
        {/* Stahl-Kopf */}
        <div className="surface-steel px-5 lg:px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono font-bold text-[13px] bg-white/15 text-white px-2.5 py-1 rounded-md tracking-wider">
              {pos.id}
            </span>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="bg-white/10 border border-white/20 text-white w-9 h-9 rounded-md grid place-items-center hover:bg-white/20 text-[17px]"
            >✕</button>
          </div>
          <div className="font-display font-black uppercase text-[24px] lg:text-[28px] text-white mt-3 leading-tight">
            {pos.name}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            <div className="font-sans text-[13px] text-steel">
              Kategorie <b className={isErr ? "text-copper-bright" : "text-white"}>{meta?.label ?? pos.cat}</b>
            </div>
            <div className="font-sans text-[13px] text-steel">
              {isErr ? "Aufschlag" : "Festpreis"} <b className="text-white">{priceStr(pos)}</b>
            </div>
            {pos.usedCount > 0 && (
              <div className="font-sans text-[13px] text-steel">
                Genutzt <b className="text-white">{pos.usedCount}×</b>
              </div>
            )}
          </div>
        </div>

        {/* Heller Body */}
        <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-6 board-scroll">
          {pos.shortText && (
            <div className="mb-5">
              <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2">
                Kurztext
              </div>
              <p className="font-sans text-[14.5px] text-ink-body leading-relaxed">{pos.shortText}</p>
            </div>
          )}

          {pos.longText && (
            <div className="mb-5">
              <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2">
                Langtext (VOB)
              </div>
              <p className="font-sans text-[13.5px] text-ink-body leading-relaxed whitespace-pre-line">
                {pos.longText}
              </p>
            </div>
          )}

          {/* Zulagen-Tabelle (nur Arbeits-Positionen) */}
          {!isErr && errPositions.length > 0 && (
            <div className="mb-6">
              <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5">
                Erschwernis-Zulagen ({errPositions.length})
              </div>
              {/* overflow-visible, damit der Zeilen-Tooltip nicht geclippt wird;
                  Rundung an erster/letzter Zeile */}
              <div className="border border-steel-line/50 rounded-lg relative bg-white">
                {errPositions.map((err) => {
                  const isChecked = pos.zulagen.includes(err.id);
                  const isTooltipVisible = tooltipId === err.id;
                  return (
                    <div
                      key={err.id}
                      className={`relative flex items-center gap-3 px-4 py-2.5 border-b border-[#F0F1F2] last:border-0 first:rounded-t-lg last:rounded-b-lg transition-colors ${
                        isChecked ? "bg-[#FFF8F3]" : "bg-white"
                      }`}
                      onMouseEnter={() => setTooltipId(err.id)}
                      onMouseLeave={() => setTooltipId(null)}
                    >
                      {/* Checkbox (optisch, Zuweisung wird im Bearbeiten-Modal geändert) */}
                      <span
                        aria-hidden
                        className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${
                          isChecked ? "bg-copper border-copper" : "bg-white border-[#D1D5DB]"
                        }`}
                      >
                        {isChecked && (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="font-mono text-[11px] tracking-wider text-copper w-[68px] flex-shrink-0 font-bold">
                        {err.id}
                      </span>
                      <span className="flex-1 font-sans text-[13px] text-ink-body leading-snug">
                        {err.name}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-ink-2 whitespace-nowrap">
                        {err.surcharge ?? "–"}
                      </span>

                      {/* Tooltip — an der Zeile verankert, klappt darunter auf */}
                      {isTooltipVisible && err.longText && (
                        <div
                          role="tooltip"
                          className="absolute right-2 top-full -mt-1 z-30 w-72 max-w-[calc(100%-16px)] p-3.5 rounded-lg shadow-2xl text-left pointer-events-none"
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

          {/* Aktionen */}
          <div className="flex items-center gap-3 flex-wrap pt-4 border-t border-steel-line/40">
            <button
              onClick={onEdit}
              aria-label={`Position ${pos.id} bearbeiten`}
              className="btn-primary !min-h-[48px] !px-5 text-[12px]"
            >
              Bearbeiten
            </button>

            {deleteConfirm === pos.id ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-sans text-[13px] text-rust font-semibold">
                  Wirklich archivieren?
                </span>
                <button
                  onClick={onDeleteConfirm}
                  disabled={saving}
                  aria-label="Archivierung bestätigen"
                  className="inline-flex items-center px-4 py-2.5 rounded-md bg-rust text-white font-display font-extrabold uppercase tracking-wide text-[11px] hover:bg-red-700 transition-colors !min-h-[48px] disabled:opacity-50"
                >
                  {saving ? "Archiviere …" : "Ja, archivieren"}
                </button>
                <button
                  onClick={onDeleteCancel}
                  aria-label="Archivierung abbrechen"
                  className="btn-ghost !min-h-[48px] !px-4 text-[11px]"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                onClick={onDelete}
                aria-label={`Position ${pos.id} archivieren`}
                className="inline-flex items-center px-4 py-2.5 rounded-md bg-[#FEF2F2] text-rust border border-[#FECACA] font-display font-extrabold uppercase tracking-wide text-[12px] hover:bg-[#FECACA] transition-colors !min-h-[48px]"
              >
                Archivieren
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Positions-Modal (Neu anlegen + Bearbeiten) · helles App-Modal wie im
   Angebote-Board (bg-bg-2, dunkle Schrift, weiße Inputs)
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
        {!isErr && errPositions.length > 0 && (
          <div className="mb-5">
            <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-2">
              Zulagen zuweisen <span className="text-ink-mute font-normal">welche Erschwernis-Aufschläge kommen in Frage?</span>
            </span>
            <div className="border border-steel-line/50 rounded-lg overflow-hidden bg-white">
              {errPositions.map((err) => {
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
