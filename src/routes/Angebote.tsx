import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  STAGES, listCards, createCard, updateCardStage, deleteCard,
  archiveCard, unarchiveCard, linkOrCreateSiteForCard, FOLLOWUP_DAYS,
  type PipelineCard, type Stage
} from "../lib/pipeline";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { isBackendConnected } from "../lib/supabase";

// Stufen-Logik · Farbe = Stahl-&-Beton-Tokens, Hinweis = was die Stufe bedeutet
const STAGE_META: Record<Stage, { color: string; hint: string }> = {
  "Anfrage":     { color: "#6A6E72", hint: "app-eigen, noch nicht beziffert" },
  "Angebot":     { color: "#DC6E2D", hint: "sevDesk-Order, in Arbeit" },
  "Versendet":   { color: "#C9852F", hint: "raus beim Kunden, nach 7 Tagen nachfassen" },
  "Auftrag":     { color: "#E8853F", hint: "Baustelle angelegt" },
  "In Arbeit":   { color: "#8C6E45", hint: "Stunden laufen" },
  "Abgerechnet": { color: "#1F7A3D", hint: "Rechnung bezahlt" }
};

/** Tage seit Versand; >= FOLLOWUP_DAYS und noch in „Versendet" = nachfassen. */
function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

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

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Angebote() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; siteId?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"aktiv" | "archiv">("aktiv");
  const [detail, setDetail] = useState<PipelineCard | null>(null);
  const dragId = useRef<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setCards(await listCards({ archived: view === "archiv" }));
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); refresh(); /* eslint-disable-next-line */ }, [view]);
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
    setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, stage } : c));
    setDetail((d) => d && d.id === card.id ? { ...d, stage } : d);
    try {
      await updateCardStage(card.id, stage);
      // Automatik: beim Wechsel auf „Auftrag" Baustelle verknüpfen/anlegen
      if (stage === "Auftrag") {
        try {
          const r = await linkOrCreateSiteForCard({ ...card, stage });
          if (r) {
            setNotice({
              msg: r.created
                ? `Baustelle „${r.siteName}" automatisch angelegt`
                : `Mit bestehender Baustelle „${r.siteName}" verknüpft`,
              siteId: r.siteId
            });
            refresh();
          }
        } catch (e: any) {
          setError(
            "Stufe gesetzt, aber Baustelle anlegen fehlgeschlagen: " +
              (e?.message ?? "unbekannt")
          );
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Verschieben fehlgeschlagen");
      refresh();
    }
  }

  async function remove(card: PipelineCard) {
    if (!confirm(`Vorgang „${card.customerName}" wirklich löschen?`)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setDetail((d) => d && d.id === card.id ? null : d);
    try {
      await deleteCard(card.id);
    } catch (err: any) {
      setError(err?.message ?? "Löschen fehlgeschlagen");
      refresh();
    }
  }

  async function archive(card: PipelineCard) {
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setDetail((d) => d && d.id === card.id ? null : d);
    try {
      await archiveCard(card.id);
    } catch (err: any) {
      setError(err?.message ?? "Archivieren fehlgeschlagen");
      refresh();
    }
  }

  async function unarchive(card: PipelineCard) {
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setDetail((d) => d && d.id === card.id ? null : d);
    try {
      await unarchiveCard(card.id);
    } catch (err: any) {
      setError(err?.message ?? "Zurückholen fehlgeschlagen");
      refresh();
    }
  }

  // KPIs (nur aktives Board)
  const sumStage = (s: Stage) =>
    byStage(s).reduce((t, c) => t + (c.valueEur ?? c.planEur ?? 0), 0);
  const expired = cards.filter(
    (c) => c.stage === "Angebot" && (daysLeft(c.validUntil) ?? 99) < 0
  ).length;

  const isArchiv = view === "archiv";

  return (
    <div className="min-h-screen flex flex-col safe-top">
      {/* ---- App-Bar (Stahl-Oberfläche) ---- */}
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4">
        <button
          onClick={() => navigate("/admin")}
          className="dd-eyebrow text-steel hover:text-copper-bright transition-colors mb-2 flex items-center gap-2"
        >
          <span aria-hidden>←</span><span>Zurück zum Dashboard</span>
        </button>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Vertrieb · Pipeline</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              {isArchiv ? "Angebote · Archiv" : "Angebote"}
            </h1>
            <span className={`font-mono text-[11.5px] mt-1.5 block tracking-wide ${
              isBackendConnected() ? "text-moss-bright" : "text-steel"
            }`}>
              {isBackendConnected()
                ? `● Live · ${cards.length} ${isArchiv ? "archiviert" : "Vorgänge"}`
                : "○ Demo-Modus · Beispieldaten"}
            </span>
          </div>
          {!isArchiv && (
            <div className="hidden md:flex gap-7 flex-wrap">
              <Kpi label="Angebote offen" value={eur(sumStage("Angebot"))} />
              <Kpi label="Aufträge" value={eur(sumStage("Auftrag"))} />
              <Kpi label="In Arbeit (Plan)" value={eur(sumStage("In Arbeit"))} />
              {expired > 0 && <Kpi label="abgelaufen" value={String(expired)} tone="rust" />}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px] flex items-center gap-2.5 bg-white/[0.08] border-[1.5px] border-white/20 rounded-lg px-3.5 py-2.5">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" className="text-steel flex-shrink-0">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen: Kunde, AN-Nr., Ort …"
              aria-label="Suche"
              className="flex-1 bg-transparent border-0 text-[14px] text-white placeholder:text-steel focus:outline-none"
            />
          </div>
          <button
            onClick={() => setView(isArchiv ? "aktiv" : "archiv")}
            className="btn-ghost !min-h-[44px] !px-4 text-[12px]"
          >
            {isArchiv ? "→ Aktives Board" : "Archiv ansehen"}
          </button>
          {!isArchiv && (
            <button onClick={() => setCreating(true)} className="btn-primary !min-h-[44px] text-[12px]">
              ＋ Neue Anfrage
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust font-sans">
          {error}
        </div>
      )}

      {notice && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-3 bg-moss/10 border border-moss/40 rounded-lg flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13.5px] text-good font-sans font-bold">
            ✓ {notice.msg}
          </span>
          <div className="flex items-center gap-2">
            {notice.siteId && (
              <button
                onClick={() => navigate(`/admin/sites/${notice.siteId}`)}
                className="font-display font-extrabold uppercase text-[12px] tracking-wide px-3.5 py-2 rounded-md text-white"
                style={{ background: "linear-gradient(180deg,#2F8C4E,#1F7A3D)" }}
              >
                Baustelle öffnen
              </button>
            )}
            <button
              onClick={() => setNotice(null)}
              className="font-sans text-[12.5px] text-ink-2 hover:text-ink px-2"
            >
              schließen
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 grid place-items-center font-mono text-ink-2 text-[13px]">
          Wird geladen …
        </div>
      ) : isArchiv ? (
        <ArchivList cards={filtered} onOpen={setDetail} onUnarchive={unarchive} />
      ) : (
        <div className="flex-1 flex gap-3.5 px-4 lg:px-8 py-5 overflow-x-auto board-scroll">
          {STAGES.map((stage) => {
            const list = byStage(stage);
            const sum = list.reduce((t, c) => t + (c.valueEur ?? c.planEur ?? 0), 0);
            const meta = STAGE_META[stage];
            return (
              <section
                key={stage}
                className="flex-1 basis-0 min-w-[270px] flex flex-col bg-white/30 rounded-xl border border-steel-line/45"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const c = cards.find((x) => x.id === dragId.current);
                  if (c) moveTo(c, stage);
                  dragId.current = null;
                }}
              >
                <header
                  className="surface-steel rounded-t-[11px] px-3.5 py-3 flex items-center justify-between gap-2"
                >
                  <div className="font-display font-extrabold uppercase text-[14.5px] tracking-wide text-white flex items-center gap-2.5 whitespace-nowrap">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: meta.color, boxShadow: "0 0 0 3px rgba(255,255,255,.10)" }} />
                    {stage}
                  </div>
                  <span className="font-mono font-bold text-[12px] bg-white/15 text-white px-2.5 py-0.5 rounded-full min-w-[26px] text-center">
                    {list.length}
                  </span>
                </header>
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-bg-deep/95 border-b border-steel-line/40">
                  <span className="font-sans text-[11.5px] text-steel">{meta.hint}</span>
                  <span className="font-mono font-bold text-[12px] text-copper-bright whitespace-nowrap">
                    {stage === "Anfrage"
                      ? "noch nicht beziffert"
                      : sum > 0 ? `Σ ${eur(sum)}` : "—"}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-[140px] board-scroll">
                  {list.length === 0 ? (
                    <div className="font-sans text-ink-2 text-[12.5px] text-center py-8">
                      keine Vorgänge
                    </div>
                  ) : (
                    list.map((c) => (
                      <CardView
                        key={c.id}
                        card={c}
                        color={meta.color}
                        onOpen={() => setDetail(c)}
                        onDragStart={() => { dragId.current = c.id; }}
                        onArchive={() => archive(c)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {detail && (
        <DetailDrawer
          card={detail}
          onClose={() => setDetail(null)}
          onPrev={() => {
            const i = STAGES.indexOf(detail.stage);
            if (i > 0) moveTo(detail, STAGES[i - 1]);
          }}
          onNext={() => {
            const i = STAGES.indexOf(detail.stage);
            if (i < STAGES.length - 1) moveTo(detail, STAGES[i + 1]);
          }}
          onArchive={() => archive(detail)}
          onUnarchive={() => unarchive(detail)}
          onDelete={() => remove(detail)}
        />
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

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "rust" }) {
  return (
    <div className="text-right">
      <div className={`font-display font-extrabold text-[19px] leading-none tabular-nums ${
        tone === "rust" ? "text-[#F08A8A]" : "text-white"
      }`}>{value}</div>
      <div className="font-mono text-[10.5px] tracking-wider uppercase text-steel mt-1">{label}</div>
    </div>
  );
}

function CardView({
  card, color, onOpen, onDragStart, onArchive
}: {
  card: PipelineCard;
  color: string;
  onOpen: () => void;
  onDragStart: () => void;
  onArchive: () => void;
}) {
  const dl = card.stage === "Angebot" ? daysLeft(card.validUntil) : null;
  const expired = dl != null && dl < 0;
  const pct =
    card.planEur && card.actualEur ? Math.min(100, (card.actualEur / card.planEur) * 100) : null;
  const barColor = pct == null ? "" : pct > 95 ? "#B91C1C" : pct >= 80 ? "#8C6E45" : "#1F7A3D";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Vorgang ${card.docNumber ?? card.customerName} öffnen`}
      className={`dd-card is-click p-3.5 ${expired ? "dd-alert" : ""}`}
      style={{ ["--c" as any]: color }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        {card.docNumber
          ? <span className="font-mono font-bold text-[12px] bg-bg-deep text-bg-2 px-2 py-0.5 rounded">{card.docNumber}</span>
          : <span className="font-mono font-bold text-[12px] bg-copper text-white px-2 py-0.5 rounded">NEU</span>}
        <div className="flex items-center gap-2">
          {expired && (
            <span className="font-mono font-bold text-[10.5px] tracking-wider text-white bg-rust px-2 py-0.5 rounded">
              ABGELAUFEN
            </span>
          )}
          <span className="font-mono text-[11px] text-ink-2 whitespace-nowrap" title="Vorgang angelegt">
            {fmtDate(card.createdAt)}
          </span>
        </div>
      </div>

      <div className="font-sans font-bold text-[16px] text-ink leading-tight">{card.customerName}</div>
      {card.place && <div className="font-sans text-[13px] text-ink-2 mt-0.5 leading-snug">{card.place}</div>}
      {card.description && (
        <div className="font-sans text-[14px] text-ink-body mt-2 leading-snug">{card.description}</div>
      )}

      {pct != null ? (
        <div className="mt-3">
          <div className="flex justify-between gap-2 text-[12.5px] text-ink-2 mb-1.5">
            <span>Plan {eur(card.planEur)} · Ist {eur(card.actualEur)}</span>
            <span className="font-mono font-bold text-ink">{Math.round(pct)} %</span>
          </div>
          <div className="h-[7px] bg-[#D5D8DB] rounded overflow-hidden">
            <div className="h-full rounded" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </div>
      ) : (
        <div className={`font-display font-extrabold text-[21px] mt-3 tabular-nums ${
          card.valueEur == null
            ? "!font-sans !font-normal !text-[13px] italic text-ink-mute"
            : expired ? "text-rust" : "text-ink"
        }`}>
          {card.valueEur != null ? eur(card.valueEur) : "noch nicht beziffert"}
        </div>
      )}

      {card.openPoints && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {card.openPoints.split(" · ").map((p, idx) => {
            const ok = /versendet|bezahlt|angelegt|DATEV|✓/i.test(p);
            const warn = /abgelaufen|knapp|nachfass|offen/i.test(p);
            return (
              <span key={idx} className={`dd-chip ${ok ? "dd-chip-ok" : warn ? "dd-chip-warn" : ""}`}>
                {p}
              </span>
            );
          })}
        </div>
      )}

      {card.stage === "Angebot" && card.validUntil && (
        <div className={`font-sans text-[12.5px] mt-3 pt-2.5 border-t border-[#D5D8DB] ${
          expired ? "text-rust font-bold" : dl != null && dl <= 7 ? "text-copper font-bold" : "text-ink-2"
        }`}>
          {expired ? "Gültigkeit abgelaufen" : `gültig bis ${fmtDate(card.validUntil)}`}
        </div>
      )}

      {card.stage === "Versendet" && (() => {
        const since = daysSince(card.sentAt);
        const due = since != null && since >= FOLLOWUP_DAYS;
        return (
          <div className={`font-sans text-[12.5px] mt-3 pt-2.5 border-t border-[#D5D8DB] flex items-center justify-between gap-2 ${
            due ? "text-rust font-bold" : "text-ink-2"
          }`}>
            <span>
              {since == null
                ? "versendet"
                : since === 0
                ? "heute versendet"
                : `vor ${since} ${since === 1 ? "Tag" : "Tagen"} versendet`}
            </span>
            {due && (
              <span className="font-mono font-bold text-[10.5px] tracking-wide text-white bg-rust px-2 py-0.5 rounded">
                NACHFASSEN
              </span>
            )}
          </div>
        );
      })()}

      {card.stage === "Abgerechnet" && (
        <div className="mt-3 pt-2.5 border-t border-[#D5D8DB]">
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="font-display font-extrabold uppercase text-[12px] tracking-wide w-full py-2.5 rounded-md text-white"
            style={{ background: "linear-gradient(180deg,#2F8C4E,#1F7A3D)" }}
          >
            ✓ Vorgang archivieren
          </button>
        </div>
      )}
    </div>
  );
}

function DetailDrawer({
  card, onClose, onPrev, onNext, onArchive, onUnarchive, onDelete
}: {
  card: PipelineCard;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const i = STAGES.indexOf(card.stage);
  const klärungen = card.openPoints ? card.openPoints.split(" · ") : [];
  const value = card.valueEur ?? card.planEur;

  return (
    <>
      <div className="dd-scrim on" onClick={onClose} />
      <aside className="dd-drawer on" role="dialog" aria-modal="true" aria-label="Vorgangs-Detail">
        <div className="surface-steel px-5 lg:px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono font-bold text-[13px] bg-white/15 text-white px-2.5 py-1 rounded-md">
              {card.docNumber ?? "Neue Anfrage"}
            </span>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="bg-white/10 border border-white/20 text-white w-9 h-9 rounded-md grid place-items-center hover:bg-white/20 text-[17px]"
            >✕</button>
          </div>
          <div className="font-display font-black uppercase text-[26px] lg:text-[30px] text-white mt-3 leading-tight">
            {card.customerName}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            {card.place && <div className="font-sans text-[13px] text-steel">{card.place}</div>}
            <div className="font-sans text-[13px] text-steel">Stufe <b className="text-white">{card.stage}</b></div>
            <div className="font-sans text-[13px] text-steel">USt <b className="text-white">0 %</b></div>
            {card.validUntil && (
              <div className="font-sans text-[13px] text-steel">gültig bis <b className="text-white">{fmtDate(card.validUntil)}</b></div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-6 board-scroll">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">

            {/* LINKS · Eckdaten, Leistung, Klärungen */}
            <div className="space-y-5">
              {card.description && (
                <div>
                  <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5">
                    Leistung
                  </div>
                  <p className="font-sans text-[14.5px] text-ink-body leading-relaxed">{card.description}</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 px-4 py-4 rounded-lg surface-steel">
                <span className="font-sans text-[13px] text-steel">
                  {card.actualEur != null ? "Plan · Ist" : "Volumen netto · 0 % USt (§19)"}
                </span>
                {card.actualEur != null ? (
                  <span className="font-display font-black text-[20px] text-white tabular-nums">
                    {eur(card.planEur)} · {eur(card.actualEur)}
                  </span>
                ) : (
                  <span className="font-display font-black text-[24px] text-white tabular-nums">
                    {value != null ? eur(value) : "noch offen"}
                  </span>
                )}
              </div>

              {klärungen.length > 0 && (
                <div className="bg-[#FBF3E9] border border-[#E0C49C] border-l-4 border-l-bronze rounded-lg px-4 py-3.5">
                  <div className="font-display font-extrabold uppercase text-[12px] tracking-wider text-[#7A5E2E] mb-2">
                    Offene Klärungen / Status
                  </div>
                  <ul className="flex flex-col gap-2">
                    {klärungen.map((k, idx) => (
                      <li key={idx} className="font-sans text-[13.5px] text-[#5A4521] leading-snug pl-4 relative">
                        <span className="absolute left-0 text-bronze">▸</span>{k}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* RECHTS · Beleg-Positionen */}
            <div>
              {card.positions && card.positions.length > 0 ? (
                <>
                  <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5">
                    {card.docNumber?.startsWith("RE")
                      ? "Schlussrechnung · Positionen"
                      : "Angebot · Positionen"}
                  </div>
                  <div className="border border-steel rounded-lg overflow-hidden bg-white">
                    <table className="w-full border-collapse text-[13.5px]">
                      <thead>
                        <tr className="bg-bg-deep text-bg-2">
                          <th className="w-8 text-center font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2.5">#</th>
                          <th className="text-left font-mono font-medium text-[10.5px] uppercase tracking-wide px-3 py-2.5">Position</th>
                          <th className="w-[72px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2.5">Menge</th>
                          <th className="w-[78px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2.5">EP €</th>
                          <th className="w-[96px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-3 py-2.5">Summe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.positions.map((p) => (
                          <tr key={p.pos} className="border-b border-[#E2E4E7] last:border-0 even:bg-[#F6F7F8]">
                            <td className="text-center font-mono text-ink-2 text-[12px] px-2 py-2.5 align-top">{p.pos}</td>
                            <td className="text-ink text-[13.5px] leading-snug px-3 py-2.5 align-top">{p.name}</td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.quantity}</td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.unitPrice}</td>
                            <td className="text-right font-mono font-bold text-[12.5px] text-ink px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{eur(p.sum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 px-4 py-4 rounded-lg surface-steel">
                    <span className="font-sans text-[13px] text-steel">Netto-Gesamt · 0 % USt (§19)</span>
                    <span className="font-display font-black text-[22px] text-white tabular-nums">
                      {eur(card.positions.reduce((t, p) => t + (p.sum || 0), 0))}
                    </span>
                  </div>
                </>
              ) : (
                <div className="border border-dashed border-steel rounded-lg px-5 py-8 text-center bg-white/50">
                  <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
                    {card.docNumber
                      ? `Positionen zu ${card.docNumber} werden aus sevDesk gespiegelt, sobald der Abgleich gelaufen ist.`
                      : "Noch kein sevDesk-Beleg verknüpft."}
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="flex-shrink-0 px-5 lg:px-6 py-3.5 bg-[#E2E4E7] border-t border-steel flex gap-2.5 flex-wrap">
          {card.archivedAt ? (
            <button onClick={onUnarchive} className="btn-primary flex-1 !min-h-[52px] text-[13px]">
              Zurück ins Board
            </button>
          ) : (
            <>
              <button
                onClick={onPrev} disabled={i === 0}
                className="btn-ghost flex-1 !min-h-[52px] text-[12px] disabled:opacity-30"
              >‹ Stufe zurück</button>
              {card.stage === "Abgerechnet" ? (
                <button onClick={onArchive} className="btn-primary flex-1 !min-h-[52px] text-[12px]">
                  ✓ Archivieren
                </button>
              ) : (
                <button
                  onClick={onNext} disabled={i === STAGES.length - 1}
                  className="btn-primary flex-1 !min-h-[52px] text-[12px] disabled:opacity-30"
                >Stufe weiter ›</button>
              )}
            </>
          )}
          <button
            onClick={onDelete}
            className="btn-ghost !min-h-[52px] !px-4 text-[12px] !text-rust !border-rust/40"
          >Löschen</button>
        </div>
      </aside>
    </>
  );
}

function ArchivList({
  cards, onOpen, onUnarchive
}: {
  cards: PipelineCard[];
  onOpen: (c: PipelineCard) => void;
  onUnarchive: (c: PipelineCard) => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="flex-1 grid place-items-center font-sans text-ink-2 text-[14px] px-6 text-center">
        Noch keine archivierten Vorgänge. Bezahlte Vorgänge wandern über den
        Button „Vorgang archivieren" hierher.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-5 board-scroll">
      <div className="grid gap-3 max-w-3xl mx-auto"
           style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
        {cards.map((c) => (
          <div key={c.id} className="dd-card is-click p-3.5" style={{ ["--c" as any]: "#1F7A3D" }}
               role="button" tabIndex={0} onClick={() => onOpen(c)}
               onKeyDown={(e) => { if (e.key === "Enter") onOpen(c); }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              {c.docNumber && (
                <span className="font-mono font-bold text-[12px] bg-bg-deep text-bg-2 px-2 py-0.5 rounded">
                  {c.docNumber}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onUnarchive(c); }}
                className="font-sans text-[12px] text-copper hover:text-copper-bright font-bold"
              >↩ zurückholen</button>
            </div>
            <div className="font-sans font-bold text-[16px] text-ink">{c.customerName}</div>
            {c.place && <div className="font-sans text-[13px] text-ink-2 mt-0.5">{c.place}</div>}
            {c.description && (
              <div className="font-sans text-[13.5px] text-ink-body mt-1.5 leading-snug">{c.description}</div>
            )}
            <div className="font-display font-extrabold text-[18px] text-ink mt-2.5 tabular-nums">
              {eur(c.valueEur ?? c.planEur)}
            </div>
          </div>
        ))}
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[70] flex items-end lg:items-center justify-center p-0 lg:p-6"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto board-scroll">
        <div className="flex items-center justify-between mb-4">
          <span className="dd-eyebrow text-copper">Pipeline</span>
          <button onClick={onClose} className="font-sans text-ink-2 text-[13px] hover:text-ink">Schließen</button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl text-ink mb-5">Neue Anfrage</h2>

        <div className="space-y-3">
          <Field label="Kunde *">
            <input autoFocus value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-copper" />
          </Field>
          <Field label="Ort / Adresse">
            <input value={place} onChange={(e) => setPlace(e.target.value)}
              className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-copper" />
          </Field>
          <Field label="Beschreibung">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-copper resize-none" />
          </Field>
          <Field label="Geschätztes Volumen € (optional)">
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              placeholder="z. B. 9333.74"
              className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink font-mono focus:outline-none focus:border-copper" />
          </Field>
        </div>

        {err && <p className="text-rust text-[13px] mt-3 font-sans">{err}</p>}

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
      <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
