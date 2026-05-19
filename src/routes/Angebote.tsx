import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  STAGES, listCards, createCard, updateCardStage, deleteCard,
  type PipelineCard, type Stage
} from "../lib/pipeline";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { isBackendConnected } from "../lib/supabase";

const STAGE_META: Record<Stage, { dot: string; accent: string; hint: string }> = {
  "Anfrage":     { dot: "bg-ink-mute",      accent: "border-l-ink-mute",      hint: "app-eigen" },
  "Angebot":     { dot: "bg-copper",        accent: "border-l-copper",        hint: "sevDesk-Order" },
  "Auftrag":     { dot: "bg-copper-bright", accent: "border-l-copper-bright", hint: "Baustelle angelegt" },
  "In Arbeit":   { dot: "bg-bronze",        accent: "border-l-bronze",        hint: "Stunden laufen" },
  "Abgerechnet": { dot: "bg-good",          accent: "border-l-good",          hint: "Rechnung bezahlt" }
};

function eur(n?: number): string {
  if (n == null) return "—";
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Tage bis valid_until; negativ = abgelaufen. */
function daysLeft(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export default function Angebote() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const dragId = useRef<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setCards(await listCards());
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);
  useRealtime("pipeline", ["pipeline_cards"], refresh);
  useRefreshOnVisible(refresh);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      c.customerName.toLowerCase().includes(q) ||
      (c.docNumber ?? "").toLowerCase().includes(q) ||
      (c.place ?? "").toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q)
    );
  }, [cards, search]);

  const byStage = (s: Stage) => filtered.filter((c) => c.stage === s);

  async function moveTo(card: PipelineCard, stage: Stage) {
    if (card.stage === stage) return;
    // optimistisch
    setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, stage } : c));
    try {
      await updateCardStage(card.id, stage);
    } catch (err: any) {
      setError(err?.message ?? "Verschieben fehlgeschlagen");
      refresh();
    }
  }

  async function remove(card: PipelineCard) {
    if (!confirm(`Karte „${card.customerName}" wirklich löschen?`)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    try {
      await deleteCard(card.id);
    } catch (err: any) {
      setError(err?.message ?? "Löschen fehlgeschlagen");
      refresh();
    }
  }

  // KPIs
  const sumStage = (s: Stage) =>
    byStage(s).reduce((t, c) => t + (c.valueEur ?? c.planEur ?? 0), 0);
  const margin = (() => {
    const done = cards.filter((c) => c.stage === "Abgerechnet" && c.planEur && c.actualEur);
    if (!done.length) return null;
    const avg = done.reduce((t, c) =>
      t + ((c.planEur! - c.actualEur!) / c.planEur!), 0) / done.length;
    return avg * 100;
  })();
  const expired = cards.filter(
    (c) => c.stage === "Angebot" && (daysLeft(c.validUntil) ?? 99) < 0
  ).length;

  return (
    <div className="h-screen flex flex-col bg-bg-DEFAULT safe-top">
      <header className="bg-bg-DEFAULT border-b border-ink/10 px-5 lg:px-10 pt-4 pb-3">
        <button
          onClick={() => navigate("/admin")}
          className="h-mono text-paper/55 text-[11px] hover:text-copper transition-colors mb-3 flex items-center gap-2"
        >
          <span>←</span><span>Zurück zum Dashboard</span>
        </button>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="h-mono text-copper text-[11px]">Vertrieb</span>
            <h1 className="h-display text-2xl lg:text-3xl mt-1">Angebote</h1>
            <span className={`h-mono text-[11px] mt-1 block ${isBackendConnected() ? "text-good" : "text-paper/40"}`}>
              {isBackendConnected()
                ? `● Live · ${cards.length} Vorgänge`
                : "○ Demo-Modus · Beispieldaten"}
            </span>
          </div>
          <button onClick={() => setCreating(true)} className="btn-primary text-[12px]">
            ＋ Neue Anfrage
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen: Kunde, AN-Nr., Ort …"
            className="flex-1 min-w-[200px] px-3.5 py-2 bg-bg-2 border-2 border-ink/15 rounded-lg text-sm focus:outline-none focus:border-copper"
          />
          <div className="hidden md:flex gap-4 text-right">
            <Kpi label="Angebote offen" value={eur(sumStage("Angebot"))} />
            <Kpi label="Aufträge" value={eur(sumStage("Auftrag"))} />
            <Kpi label="In Arbeit (Plan)" value={eur(sumStage("In Arbeit"))} />
            {margin != null && (
              <Kpi label="Ø Marge" value={`${margin >= 0 ? "+" : ""}${margin.toFixed(1)} %`}
                   tone={margin >= 0 ? "good" : "rust"} />
            )}
            {expired > 0 && <Kpi label="abgelaufen" value={String(expired)} tone="rust" />}
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-10 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 grid place-items-center h-mono text-paper/55 text-[12px]">
          Wird geladen …
        </div>
      ) : (
        <div className="flex-1 flex gap-3 px-5 lg:px-10 py-4 overflow-x-auto">
          {STAGES.map((stage) => {
            const list = byStage(stage);
            const sum = list.reduce((t, c) => t + (c.valueEur ?? c.planEur ?? 0), 0);
            const meta = STAGE_META[stage];
            return (
              <div
                key={stage}
                className="flex-shrink-0 w-[300px] flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const c = cards.find((x) => x.id === dragId.current);
                  if (c) moveTo(c, stage);
                  dragId.current = null;
                }}
              >
                <div className="flex items-center justify-between px-3 py-2.5 bg-bg-deep text-bg-2 rounded-t-xl">
                  <div className="font-display text-[15px] uppercase tracking-wide flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                    {stage}
                  </div>
                  <span className="h-mono text-[11px] bg-paper-2 px-2 py-0.5 rounded-full">
                    {list.length}
                  </span>
                </div>
                <div className="h-mono text-[11px] px-3 py-1.5 bg-bg-deep text-copper-bright border-t border-paper-3/40">
                  {stage === "Anfrage"
                    ? "noch nicht beziffert"
                    : sum > 0 ? <>Σ <b>{eur(sum)}</b></> : "—"}
                </div>
                <div className="flex-1 bg-bg-3 rounded-b-xl p-2.5 overflow-y-auto flex flex-col gap-2.5 min-h-[140px]">
                  {list.length === 0 ? (
                    <div className="h-mono text-paper/35 text-[11px] text-center py-8">
                      leer
                    </div>
                  ) : (
                    list.map((c) => (
                      <CardView
                        key={c.id}
                        card={c}
                        accent={meta.accent}
                        onDragStart={() => { dragId.current = c.id; }}
                        onPrev={() => {
                          const i = STAGES.indexOf(c.stage);
                          if (i > 0) moveTo(c, STAGES[i - 1]);
                        }}
                        onNext={() => {
                          const i = STAGES.indexOf(c.stage);
                          if (i < STAGES.length - 1) moveTo(c, STAGES[i + 1]);
                        }}
                        onDelete={() => remove(c)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await createCard(input);
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "rust" }) {
  return (
    <div>
      <div className={`h-display text-xl leading-none ${
        tone === "good" ? "text-good" : tone === "rust" ? "text-rust" : ""
      }`}>{value}</div>
      <div className="h-mono text-paper/45 text-[10px] mt-0.5">{label}</div>
    </div>
  );
}

function CardView({
  card, accent, onDragStart, onPrev, onNext, onDelete
}: {
  card: PipelineCard;
  accent: string;
  onDragStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete: () => void;
}) {
  const dl = card.stage === "Angebot" ? daysLeft(card.validUntil) : null;
  const ageTone =
    dl == null ? "" : dl < 0 ? "text-rust font-bold" : dl <= 7 ? "text-copper font-bold" : "text-paper/45";
  const ageText =
    dl == null ? null : dl < 0 ? "Gültigkeit abgelaufen" : `gültig noch ${dl} Tg.`;
  const pct =
    card.planEur && card.actualEur ? Math.min(100, (card.actualEur / card.planEur) * 100) : null;
  const barColor = pct == null ? "" : pct > 95 ? "bg-rust" : pct >= 80 ? "bg-bronze" : "bg-good";
  const i = STAGES.indexOf(card.stage);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`bg-bg-2 border border-ink/10 ${accent} border-l-4 rounded-lg p-3 cursor-grab active:cursor-grabbing`}
    >
      <div className="flex items-start justify-between gap-2">
        {card.docNumber
          ? <span className="h-mono text-[11px] font-bold bg-bg-deep text-bg-2 px-1.5 py-0.5 rounded">{card.docNumber}</span>
          : <span className="h-mono text-[11px] font-bold bg-copper text-bg-deep px-1.5 py-0.5 rounded">NEU</span>}
        <button onClick={onDelete} className="h-mono text-[11px] text-paper/30 hover:text-rust leading-none">✕</button>
      </div>

      <div className="font-semibold text-[14px] mt-2">{card.customerName}</div>
      {card.place && <div className="h-mono text-paper/55 text-[11px] mt-0.5">{card.place}</div>}
      {card.description && (
        <div className="text-[12.5px] text-paper/75 mt-1.5 leading-snug">{card.description}</div>
      )}

      <div className={`font-display text-lg mt-2 ${card.valueEur == null ? "text-paper/35 !text-[13px]" : ""}`}>
        {card.valueEur != null ? eur(card.valueEur) : "noch nicht beziffert"}
      </div>

      {pct != null && (
        <div className="mt-2">
          <div className="flex justify-between h-mono text-[10px] text-paper/55 mb-1">
            <span>Plan / Ist</span><span>{Math.round(pct)} %</span>
          </div>
          <div className="h-1.5 bg-bg-4 rounded-full overflow-hidden">
            <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {card.openPoints && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.openPoints.split(" · ").map((p, idx) => (
            <span key={idx} className="h-mono text-[10px] px-2 py-0.5 rounded-full bg-bg-3 border border-ink/10 text-paper/65">
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-ink/10">
        <div className="flex gap-1">
          <button
            onClick={onPrev} disabled={i === 0}
            className="h-mono text-[12px] w-6 h-6 rounded bg-bg-3 disabled:opacity-25 hover:bg-bg-4"
            title="Stufe zurück"
          >‹</button>
          <button
            onClick={onNext} disabled={i === STAGES.length - 1}
            className="h-mono text-[12px] w-6 h-6 rounded bg-bg-3 disabled:opacity-25 hover:bg-bg-4"
            title="Stufe weiter"
          >›</button>
        </div>
        {ageText && <span className={`h-mono text-[10px] ${ageTone}`}>{ageText}</span>}
      </div>
    </div>
  );
}

function CreateModal({
  onClose, onSave
}: {
  onClose: () => void;
  onSave: (input: {
    customerName: string; place?: string; description?: string;
    valueEur?: number | null; openPoints?: string; stage?: Stage;
  }) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState("");
  const [place, setPlace] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!customerName.trim()) { setErr("Kundenname fehlt"); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        customerName,
        place: place || undefined,
        description: description || undefined,
        valueEur: value ? Number(value.replace(",", ".")) : null,
        stage: "Anfrage"
      });
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-4">
          <span className="h-mono text-copper text-[12px]">Pipeline</span>
          <button onClick={onClose} className="h-mono text-paper/55 text-[12px]">Schließen</button>
        </div>
        <h2 className="h-display text-2xl mb-5">Neue Anfrage</h2>

        <div className="space-y-3">
          <Field label="Kunde *">
            <input autoFocus value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper" />
          </Field>
          <Field label="Ort / Adresse">
            <input value={place} onChange={(e) => setPlace(e.target.value)}
              className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper" />
          </Field>
          <Field label="Beschreibung">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper resize-none" />
          </Field>
          <Field label="Geschätztes Volumen € (optional)">
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              placeholder="z. B. 9333.74"
              className="w-full bg-bg-DEFAULT border border-ink/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-copper font-mono" />
          </Field>
        </div>

        {err && <p className="text-rust text-[12px] mt-3">{err}</p>}

        <button onClick={save} disabled={saving} className="btn-primary w-full mt-5 disabled:opacity-50">
          {saving ? "Speichere …" : "Anfrage anlegen"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="h-mono text-paper/55 text-[11px] block mb-1">{label}</span>
      {children}
    </label>
  );
}
