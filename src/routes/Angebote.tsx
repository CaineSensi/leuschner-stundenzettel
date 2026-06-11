import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  STAGES, listCards, createCard, updateCardStage, deleteCard,
  archiveCard, unarchiveCard, linkOrCreateSiteForCard, FOLLOWUP_DAYS,
  reviewPosition, releaseCard, revokeRelease,
  cancelCard, uncancelCard,
  sevPositionsToPipeline, syncCardFromSevdesk,
  type PipelineCard, type Stage, type ReviewStatus, type PipelinePosition
} from "../lib/pipeline";
import { sevdeskGetOrderSnapshot, sevdeskFindOrdersForName, type SevOrderSnapshot, type SevOrderRef } from "../lib/sevdesk";
import { getCustomerBySevdeskContactId, findCustomerByName, updateCustomerContact, createCustomerLocal, listCustomers, type Customer } from "../lib/customers";
import { useRealtime, useRefreshOnVisible, useRefreshOnAuth } from "../lib/realtime";
import { currentUser } from "../lib/auth";
import BackButton from "../components/BackButton";
import { getInquiryByCardId, listInquiries, inquiryPhotoUrl, SOURCE_ICON, SOURCE_LABEL, type Inquiry } from "../lib/inquiries";

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

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) + " Uhr";
}

/** True, wenn die „Leistung"-Beschreibung nur die Belegnummer wiederholt
 *  (z. B. „Angebot AN-1248" oder „AN-1248"). Die Nummer steht schon im
 *  Karten-/Drawer-Kopf — dann ist die Leistungs-Zeile redundant und wird
 *  ausgeblendet, statt die (evtl. veraltete) Nummer doppelt zu zeigen. */
function descIsJustDocNumber(desc?: string): boolean {
  if (!desc) return false;
  return /^([A-Za-zÄÖÜäöü]+\s+)?[A-Z]{2}-?\d+$/.test(desc.trim());
}

export default function Angebote() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showGaps, setShowGaps] = useState(false);
  // Inquiry je Pipeline-Karte (für Quelle-Symbol + Roh-Text-Vorschau auf den
  // Anfrage-Karten — die Inbox ist seit 06.06. ins Board aufgegangen).
  const [inquiryByCard, setInquiryByCard] = useState<Record<string, Inquiry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; siteId?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"aktiv" | "archiv">("aktiv");
  // Erledigte (Abgerechnet) standardmäßig ausblenden — sonst überfüllt das Board
  // nach dem sevDesk-Import mit historischen Vorgängen.
  const [hideClosed, setHideClosed] = useState(true);
  const [detail, setDetail] = useState<PipelineCard | null>(null);
  // Storno-Modal: { card, reason } solange offen; null = geschlossen.
  const [cancelling, setCancelling] = useState<{ card: PipelineCard; reason: string; busy?: boolean; error?: string } | null>(null);
  const dragId = useRef<string | null>(null);
  // Inhaber/Freigeber: darf reviewen/freigeben, aber nicht bearbeiten/löschen
  const reviewerOnly = /inhaber|freigeber/i.test(currentUser()?.role ?? "");

  async function refresh() {
    setError(null);
    try {
      const [cs, inqs, cus] = await Promise.all([
        listCards({ archived: view === "archiv" }),
        listInquiries({ onlyOpen: false }).catch(() => [] as Inquiry[]),
        listCustomers().catch(() => [] as Customer[]),
      ]);
      setCards(cs);
      setCustomers(cus);
      const map: Record<string, Inquiry> = {};
      for (const i of inqs) if (i.pipelineCardId) map[i.pipelineCardId] = i;
      setInquiryByCard(map);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); refresh(); /* eslint-disable-next-line */ }, [view]);
  useRealtime("pipeline", ["pipeline_cards"], refresh);
  useRefreshOnVisible(refresh);
  // Holt die Daten nach, sobald die Supabase-Session steht (Route mountet
  // sonst vor dem Session-Restore -> erster Fetch ohne Token -> leerer View).
  useRefreshOnAuth(refresh);

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

  /** Kunden mit unvollständigen Stammdaten, die in mindestens einer aktiven
   *  Pipeline-Karte stecken (alle Stufen außer Abgerechnet/storniert). Zeigt
   *  Banner oben + Detail-Modal. Karteileichen ohne aktive Vorgänge werden
   *  bewusst nicht angemahnt — die ergänzt man, wenn sie wieder anlaufen. */
  const customerGaps = useMemo(() => {
    const activeCardsByCust = new Map<string, PipelineCard>();
    for (const c of cards) {
      if (c.stage === "Abgerechnet" || c.cancelledAt || c.archivedAt) continue;
      if (!c.customerId) continue;
      // erste aktive Karte des Kunden gewinnt (zum Öffnen)
      if (!activeCardsByCust.has(c.customerId)) activeCardsByCust.set(c.customerId, c);
    }
    type Gap = { customer: Customer; missing: string[]; card: PipelineCard };
    const gaps: Gap[] = [];
    for (const cu of customers) {
      const card = activeCardsByCust.get(cu.id);
      if (!card) continue;
      const missing: string[] = [];
      if (!cu.email)  missing.push("E-Mail");
      if (!cu.phone)  missing.push("Telefon");
      if (!cu.street) missing.push("Straße");
      if (!cu.zip)    missing.push("PLZ");
      if (!cu.city)   missing.push("Ort");
      if (missing.length) gaps.push({ customer: cu, missing, card });
    }
    return gaps.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  }, [cards, customers]);

  async function moveTo(card: PipelineCard, stage: Stage) {
    if (card.stage === stage) return;
    // Weicher Versand-Gate: ohne Chef-Freigabe nur mit ausdrücklicher Bestätigung
    if (stage === "Versendet" && !card.freigabe?.releasedAt) {
      const ok = confirm(
        `„${card.customerName}" ist noch nicht vom Chef freigegeben.\n\n` +
        `Trotzdem auf „Versendet" setzen?`
      );
      if (!ok) return;
    }
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

  function applyCardPatch(id: string, patch: Partial<PipelineCard>) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
    setDetail((d) => d && d.id === id ? { ...d, ...patch } : d);
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

  /** Storno bestätigen: ruft cancelCard auf (sevDesk-Sync + DB).
   *  sevDesk-Fehler werden als Warnung im Modal angezeigt, lokale Storno
   *  ist trotzdem durch. Karte verschwindet aus dem aktiven Board (archiviert). */
  async function doCancel() {
    if (!cancelling) return;
    const { card, reason } = cancelling;
    setCancelling({ ...cancelling, busy: true, error: undefined });
    const me = currentUser();
    const by = me ? `${me.firstName} ${me.lastName}`.trim() : "Unbekannt";
    try {
      const { sevdeskError } = await cancelCard(card, reason.trim() || undefined, by);
      // Aus aktivem Board entfernen, Drawer schließen
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setDetail(null);
      if (sevdeskError) {
        // Storno lokal durch — aber sevDesk-Sync gewarnt
        setNotice({ msg: `Vorgang storniert · sevDesk-Sync fehlgeschlagen: ${sevdeskError}` });
      } else {
        setNotice({ msg: card.docNumber
          ? `Vorgang ${card.docNumber} storniert (lokal + sevDesk)`
          : `Vorgang „${card.customerName}" storniert` });
      }
      setCancelling(null);
    } catch (err: any) {
      setCancelling((cur) => cur ? { ...cur, busy: false, error: err?.message ?? "Storno fehlgeschlagen" } : cur);
    }
  }

  async function uncancel(card: PipelineCard) {
    if (!confirm(`Storno von „${card.customerName}" wirklich zurücknehmen?\n\nACHTUNG: sevDesk wird NICHT zurückgesetzt. Status dort muss manuell auf „Offen" geändert werden.`)) return;
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setDetail((d) => d && d.id === card.id ? null : d);
    try {
      await uncancelCard(card.id);
    } catch (err: any) {
      setError(err?.message ?? "Storno-Rücknahme fehlgeschlagen");
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
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Vertrieb · Pipeline</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              {isArchiv ? "Angebote · Archiv" : "Angebote"}
            </h1>
            <span className="font-mono text-[11.5px] mt-1.5 block tracking-wide text-moss-bright">
              ● {cards.length} {isArchiv ? "archiviert" : "Vorgänge"}
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
          {!isArchiv && (() => {
            const closedCount = cards.filter((c) => c.stage === "Abgerechnet").length;
            return (
              <button
                onClick={() => setHideClosed((v) => !v)}
                className="btn-ghost !min-h-[44px] !px-4 text-[12px] whitespace-nowrap"
                title={hideClosed
                  ? `${closedCount} abgerechnete Vorgänge ausgeblendet`
                  : "Abgerechnete Vorgänge werden gezeigt"}
              >
                {hideClosed
                  ? `Erledigte einblenden${closedCount ? ` (${closedCount})` : ""}`
                  : "Erledigte ausblenden"}
              </button>
            );
          })()}
          <button
            onClick={() => setView(isArchiv ? "aktiv" : "archiv")}
            className="btn-ghost !min-h-[44px] !px-4 text-[12px]"
          >
            {isArchiv ? "→ Aktives Board" : "Archiv ansehen"}
          </button>
          {!isArchiv && (
            <button
              onClick={() => navigate("/admin/anfrage-neu")}
              className="btn-primary !min-h-[44px] text-[12px] whitespace-nowrap"
              title="Kundenanfrage einfügen (Mail / WhatsApp / Telefonnotiz)"
            >
              ＋ Anfrage einfügen
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

      {customerGaps.length > 0 && !isArchiv && (
        <button
          onClick={() => setShowGaps(true)}
          className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-amber/15 border border-amber/45 rounded-lg flex items-center justify-between gap-3 text-left hover:bg-amber/25 transition-colors"
          aria-label={`${customerGaps.length} Kunden mit unvollständigen Stammdaten anzeigen`}
        >
          <span className="text-[13.5px] text-amber-bright font-sans">
            <b>⚠ {customerGaps.length} {customerGaps.length === 1 ? "Kunde hat" : "Kunden haben"} unvollständige Stammdaten</b>
            {" "}- in aktiven Vorgängen, bitte ergänzen
          </span>
          <span className="h-mono text-[11px] text-amber-bright whitespace-nowrap">anzeigen →</span>
        </button>
      )}

      {loading ? (
        <div className="flex-1 grid place-items-center font-mono text-ink-2 text-[13px]">
          Wird geladen …
        </div>
      ) : isArchiv ? (
        <ArchivList cards={filtered} onOpen={setDetail} onUnarchive={unarchive} />
      ) : (
        <div className="flex-1 flex gap-3.5 px-4 lg:px-8 py-5 overflow-x-auto board-scroll">
          {STAGES.filter((s) => !(hideClosed && s === "Abgerechnet")).map((stage) => {
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
                  <div className="flex items-center gap-1.5">
                    {stage === "Anfrage" && (
                      <button
                        onClick={() => navigate("/admin/anfrage-neu")}
                        title="Anfrage einfügen"
                        className="w-7 h-7 rounded-full bg-copper hover:bg-copper-bright text-white font-bold text-[14px] grid place-items-center transition-colors"
                      >＋</button>
                    )}
                    <span className="font-mono font-bold text-[12px] bg-white/15 text-white px-2.5 py-0.5 rounded-full min-w-[26px] text-center">
                      {list.length}
                    </span>
                  </div>
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
                        inquiry={inquiryByCard[c.id] ?? null}
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

      {showGaps && (
        <>
          <div className="dd-scrim on" onClick={() => setShowGaps(false)} />
          <aside className="dd-drawer on" role="dialog" aria-modal="true" aria-label="Kunden mit unvollständigen Stammdaten" style={{ width: "min(640px, 100%)" }}>
            <div className="surface-steel px-5 lg:px-6 pt-5 pb-4 flex-shrink-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-bold text-[13px] bg-amber/30 text-white px-2.5 py-1 rounded-md">
                  ⚠ {customerGaps.length} {customerGaps.length === 1 ? "Lücke" : "Lücken"}
                </span>
                <button
                  onClick={() => setShowGaps(false)}
                  aria-label="Schließen"
                  className="bg-white/10 border border-white/20 text-white w-9 h-9 rounded-md grid place-items-center hover:bg-white/20 text-[17px]"
                >✕</button>
              </div>
              <div className="font-display font-black uppercase text-[22px] lg:text-[26px] text-white mt-3 leading-tight">
                Unvollständige Kundendaten
              </div>
              <div className="font-sans text-[13px] text-steel mt-2">
                Diese Kunden haben aktive Vorgänge, aber im Stamm fehlen Kontakt- oder Adressdaten. Karte öffnen → im Detail-Drawer rechts „Kontakt" → Edit.
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 lg:px-6 py-5 board-scroll bg-[#EEF0F2]">
              <ul className="space-y-2.5">
                {customerGaps.map(({ customer, missing, card }) => (
                  <li key={customer.id} className="bg-white border border-steel-line/50 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-sans font-bold text-[15px] text-ink truncate">{customer.name}</div>
                      <div className="font-mono text-[11px] text-ink-2 mt-1">
                        fehlt: {missing.join(" · ")}
                      </div>
                      {card.docNumber && (
                        <div className="font-mono text-[10.5px] text-ink-mute mt-0.5">{card.docNumber} · {card.stage}</div>
                      )}
                    </div>
                    <button
                      onClick={() => { setShowGaps(false); setDetail(card); }}
                      className="btn-primary !min-h-[36px] !px-3 text-[12px] whitespace-nowrap"
                    >
                      Karte öffnen →
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </>
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
          onCancel={() => setCancelling({ card: detail, reason: "" })}
          onUncancel={() => uncancel(detail)}
          onUpdate={(patch) => applyCardPatch(detail.id, patch)}
          reviewerOnly={reviewerOnly}
        />
      )}

      {cancelling && (
        <CancelModal
          card={cancelling.card}
          reason={cancelling.reason}
          busy={!!cancelling.busy}
          error={cancelling.error}
          onChange={(reason) => setCancelling((c) => c ? { ...c, reason } : c)}
          onConfirm={doCancel}
          onClose={() => cancelling.busy ? null : setCancelling(null)}
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
  card, color, inquiry, onOpen, onDragStart, onArchive
}: {
  card: PipelineCard;
  color: string;
  inquiry?: Inquiry | null;
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
      {card.description && !descIsJustDocNumber(card.description) && (
        <div className="font-sans text-[14px] text-ink-body mt-2 leading-snug">{card.description}</div>
      )}

      {/* Anfrage-Karten: Quelle-Symbol + Priorität + Roh-Text-Vorschau
          (die frühere Inbox ist seit 06.06. in diese Spalte aufgegangen). */}
      {inquiry && card.stage === "Anfrage" && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10.5px] text-ink-2 inline-flex items-center gap-1 bg-bg-deep/10 px-1.5 py-0.5 rounded">
              {SOURCE_ICON[inquiry.source] ?? "✉"} {SOURCE_LABEL[inquiry.source] ?? inquiry.source}
            </span>
            {inquiry.priority && inquiry.priority !== "normal" && (
              <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={prioStyle(inquiry.priority)}>
                {inquiry.priority}
              </span>
            )}
          </div>
          {inquiry.rawText && (() => {
            const t = inquiry.rawText.replace(/\s+/g, " ").trim();
            return (
              <div className="font-sans text-[12px] text-ink-2 mt-1.5 leading-snug italic">
                „{t.slice(0, 95)}{t.length > 95 ? "…" : ""}"
              </div>
            );
          })()}
        </div>
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

      {(() => {
        // Nachfassen ist ein abgeleiteter Zustand und gilt NUR in „Versendet".
        // Statische „Nachfass…"-Schnipsel (Alt-Last aus Importen) werden in
        // jeder weiteren Stufe ausgeblendet — der Auftrag läuft ja schon.
        const points = (card.openPoints?.split(" · ") ?? [])
          .filter((p) => !(/nachfass/i.test(p) && card.stage !== "Versendet"));
        if (points.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {points.map((p, idx) => {
              const ok = /versendet|bezahlt|angelegt|DATEV|✓/i.test(p);
              const warn = /abgelaufen|knapp|nachfass|offen/i.test(p);
              return (
                <span key={idx} className={`dd-chip ${ok ? "dd-chip-ok" : warn ? "dd-chip-warn" : ""}`}>
                  {p}
                </span>
              );
            })}
          </div>
        );
      })()}

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

const REVIEW_META: Record<ReviewStatus, { dot: string; label: string }> = {
  offen:     { dot: "#A9AEB3", label: "offen" },
  ok:        { dot: "#1F7A3D", label: "OK" },
  kommentar: { dot: "#DC6E2D", label: "Kommentar" },
  aenderung: { dot: "#B45309", label: "Unsicher" }
};

function DetailDrawer({
  card, onClose, onPrev, onNext, onArchive, onUnarchive, onDelete, onCancel, onUncancel, onUpdate, reviewerOnly
}: {
  card: PipelineCard;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onUncancel: () => void;
  onUpdate: (patch: Partial<PipelineCard>) => void;
  reviewerOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [revErr, setRevErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  // Inline-Editor für Position-Kommentare (ersetzt window.prompt, das in
  // PWA-Standalone — iOS-Home-Screen — unzuverlässig ist)
  const [commenting, setCommenting] = useState<{ pos: number; status: "kommentar" | "aenderung"; text: string } | null>(null);
  // Original-Anfrage hinter der Karte (Rohtext + Verlauf + Bilder)
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  // sevDesk-Abgleich: Schnappschuss des Live-Belegs für den Vorschau-Dialog
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncSnap, setSyncSnap] = useState<SevOrderSnapshot | null>(null);
  // Aktueller App-Kunde hinter dem Beleg (für den Kontaktdaten-Abgleich)
  const [syncCustomer, setSyncCustomer] = useState<Customer | null>(null);

  // Beleg hat eine sevDesk-Order (ID oder AN-Nummer) → Abgleich möglich
  const hasBeleg = !!card.sevdeskOrderId || /^AN-\d+/i.test(card.docNumber ?? "");
  const canSync = !reviewerOnly && !card.archivedAt && hasBeleg;
  // Karte ohne Beleg, aber ab Stufe „Angebot" → in sevDesk suchen + verknüpfen
  const canLink = !reviewerOnly && !card.archivedAt && !hasBeleg && card.stage !== "Anfrage";

  // Beleg-Suche (Verknüpfen): gefundene Kandidaten + Auswahl-Status
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linkCands, setLinkCands] = useState<SevOrderRef[] | null>(null); // null = Dialog zu

  /** Lädt den App-Kunden hinter dem Beleg, damit der Dialog Kontaktdaten
   *  (Telefon/E-Mail/Adresse) gegenüberstellen kann. */
  async function loadCustomerFor(snap: SevOrderSnapshot) {
    let c = snap.contact ? await getCustomerBySevdeskContactId(snap.contact.sevdeskContactId).catch(() => null) : null;
    // Fallback per Name: die Order kann auf einen anderen sevDesk-Kontakt zeigen
    // als der bestehende App-Kunde — so vermeiden wir eine Kunden-Dublette.
    if (!c) c = await findCustomerByName(snap.contact?.name || card.customerName).catch(() => null);
    setSyncCustomer(c);
  }

  async function doSync() {
    setSyncBusy(true); setSyncErr(null);
    try {
      const snap = await sevdeskGetOrderSnapshot({ id: card.sevdeskOrderId, orderNumber: card.docNumber });
      await loadCustomerFor(snap);
      setSyncSnap(snap);
    } catch (e: any) {
      setSyncErr(e?.message ?? "Abgleich fehlgeschlagen");
    } finally { setSyncBusy(false); }
  }

  /** Sucht in sevDesk nach Belegen, die zum Kundennamen der Karte passen. */
  async function doFindOrders() {
    setLinkBusy(true); setLinkErr(null);
    try {
      const found = await sevdeskFindOrdersForName(card.customerName);
      setLinkCands(found);
    } catch (e: any) {
      setLinkErr(e?.message ?? "Suche fehlgeschlagen");
    } finally { setLinkBusy(false); }
  }

  /** Ein Kandidat wurde gewählt → Beleg laden und in die Abgleich-Vorschau
   *  überführen (von dort wird verknüpft + übernommen). */
  async function pickOrder(ref: SevOrderRef) {
    setLinkBusy(true); setLinkErr(null);
    try {
      const snap = await sevdeskGetOrderSnapshot({ id: ref.id, orderNumber: ref.orderNumber });
      await loadCustomerFor(snap);
      setLinkCands(null);
      setSyncSnap(snap);
    } catch (e: any) {
      setLinkErr(e?.message ?? "Beleg konnte nicht geladen werden");
    } finally { setLinkBusy(false); }
  }

  /** Übernimmt die im Vorschau-Dialog bestätigten Felder in die Karte.
   *  Die Pipeline-Stufe wird bewusst NICHT aus sevDesk abgeleitet — das
   *  Kanban-Board ist dafür maßgebend (sevDesk-Status ≠ Vertriebsstufe). */
  async function applySync(patch: {
    positions?: PipelinePosition[]; valueEur?: number; docNumber?: string; sevdeskOrderId?: string;
    contact?: { phone?: string; email?: string; street?: string; zip?: string; city?: string };
  }) {
    setSyncBusy(true); setSyncErr(null);
    try {
      const { contact, ...cardPatch } = patch;
      await syncCardFromSevdesk(card.id, cardPatch);

      // Kontaktdaten in den Kundenstamm: bestehenden Kunden aktualisieren oder
      // (wenn die Karte noch keinen hat) aus dem sevDesk-Kontakt anlegen + verknüpfen.
      if (contact && syncSnap?.contact) {
        if (syncCustomer) {
          await updateCustomerContact(syncCustomer.id, contact);
        } else {
          const nc = await createCustomerLocal({
            sevdeskContactId: syncSnap.contact.sevdeskContactId,
            customerNumber: syncSnap.contact.customerNumber,
            name: syncSnap.contact.name || card.customerName,
            ...contact,
          });
          await syncCardFromSevdesk(card.id, { customerId: nc.id });
        }
      }

      onUpdate(cardPatch as Partial<PipelineCard>);
      setSyncSnap(null);
      setSyncCustomer(null);
    } catch (e: any) {
      setSyncErr(e?.message ?? "Übernehmen fehlgeschlagen");
    } finally { setSyncBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  // Anfrage nachladen wenn Drawer eine andere Karte zeigt
  useEffect(() => {
    let cancelled = false;
    setInquiry(null);
    getInquiryByCardId(card.id).then((i) => { if (!cancelled) setInquiry(i); }).catch(() => {});
    return () => { cancelled = true; };
  }, [card.id]);

  const me = currentUser();
  const reviewerName = me ? `${me.firstName} ${me.lastName}`.trim() : "Inhaber";
  const released = !!card.freigabe?.releasedAt;
  const history = card.freigabe?.history ?? [];

  /** Wird für „ok" und „offen" (Reset) direkt aufgerufen, ohne Kommentar-Eingabe. */
  async function saveReview(posNr: number, status: ReviewStatus, comment?: string) {
    setBusy(true); setRevErr(null);
    try {
      const r = await reviewPosition(card, posNr, { status, comment }, reviewerName);
      onUpdate({ positions: r.positions, freigabe: r.freigabe });
      setCommenting(null);
    } catch (e: any) {
      setRevErr(e?.message ?? "Speichern fehlgeschlagen");
    } finally { setBusy(false); }
  }

  /** Klick auf Status-Button — bei „kommentar"/„aenderung" öffnet Inline-Editor. */
  function setReview(posNr: number, status: ReviewStatus) {
    if (status === "kommentar" || status === "aenderung") {
      const existing = card.positions?.find((p) => p.pos === posNr)?.review;
      const prefill = existing?.status === status ? (existing.comment ?? "") : "";
      setCommenting({ pos: posNr, status, text: prefill });
      return;
    }
    saveReview(posNr, status);
  }

  async function doRelease() {
    setBusy(true); setRevErr(null);
    try {
      const f = await releaseCard(card, reviewerName);
      onUpdate({ freigabe: f });
    } catch (e: any) {
      setRevErr(e?.message ?? "Freigabe fehlgeschlagen");
    } finally { setBusy(false); }
  }

  async function doRevoke() {
    setBusy(true); setRevErr(null);
    try {
      const f = await revokeRelease(card, reviewerName);
      onUpdate({ freigabe: f });
    } catch (e: any) {
      setRevErr(e?.message ?? "Zurücknehmen fehlgeschlagen");
    } finally { setBusy(false); }
  }

  const i = STAGES.indexOf(card.stage);
  // Nachfass-Schnipsel nur in „Versendet" zeigen (gilt nicht mehr ab „Auftrag").
  const klärungen = (card.openPoints ? card.openPoints.split(" · ") : [])
    .filter((p) => !(/nachfass/i.test(p) && card.stage !== "Versendet"));
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

        {card.cancelledAt && (
          <div className="flex-shrink-0 px-5 lg:px-6 py-3 bg-rust/10 border-b-2 border-rust/40">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-rust">
                  ⚠ Storniert
                </div>
                <div className="font-mono text-[11px] text-ink-2 mt-0.5">
                  am {fmtDateTime(card.cancelledAt)}
                  {card.docNumber && card.sevdeskOrderId ? ' · in sevDesk auf Abgelehnt gesetzt' : ''}
                </div>
              </div>
              {card.cancellationReason && (
                <div className="font-sans text-[13px] text-ink italic">
                  „{card.cancellationReason}"
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-6 board-scroll">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">

            {/* LINKS · Eckdaten, Leistung, Klärungen */}
            <div className="space-y-5">
              {card.description && !descIsJustDocNumber(card.description) && (
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

            {/* RECHTS · Anfrage + Beleg-Positionen */}
            <div className="space-y-5">
              <ContactCard card={card} inquiry={inquiry} />
              {inquiry && <InquiryHistory inquiry={inquiry} />}
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
                        {card.positions.map((p) => {
                          const rv = p.review;
                          const rm = REVIEW_META[rv?.status ?? "offen"];
                          return (
                          <tr key={p.pos} className="border-b border-[#E2E4E7] last:border-0 even:bg-[#F6F7F8]">
                            <td className="text-center font-mono text-ink-2 text-[12px] px-2 py-2.5 align-top">{p.pos}</td>
                            <td className="text-ink text-[13.5px] leading-snug px-3 py-2.5 align-top">
                              <div className="flex items-start gap-2">
                                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ background: rm.dot }} title={`Review: ${rm.label}`} />
                                <span className="break-words">{p.name}</span>
                              </div>
                              {rv?.comment && (
                                <div className="mt-1 ml-4 font-sans text-[12px] text-copper italic leading-snug">
                                  „{rv.comment}"
                                </div>
                              )}
                              {!released && commenting?.pos !== p.pos && (
                                <div className="mt-1.5 ml-4 flex items-center gap-1">
                                  <button onClick={() => setReview(p.pos, "ok")} disabled={busy}
                                    className={`text-[11px] font-mono px-2 py-0.5 rounded border ${rv?.status === "ok" ? "bg-good text-white border-good" : "border-steel text-ink-2 hover:border-good hover:text-good"}`}
                                    title="Position freigeben">✓ OK</button>
                                  <button onClick={() => setReview(p.pos, "kommentar")} disabled={busy}
                                    className={`text-[11px] font-mono px-2 py-0.5 rounded border ${rv?.status === "kommentar" ? "bg-copper text-white border-copper" : "border-steel text-ink-2 hover:border-copper hover:text-copper"}`}
                                    title="Kommentar">💬</button>
                                  <button onClick={() => setReview(p.pos, "aenderung")} disabled={busy}
                                    className={`text-[11px] font-mono px-2 py-0.5 rounded border ${rv?.status === "aenderung" ? "bg-amber text-white border-amber" : "border-steel text-ink-2 hover:border-amber hover:text-amber"}`}
                                    style={rv?.status === "aenderung" ? { background: "#B45309", borderColor: "#B45309", color: "#fff" } : undefined}
                                    title="Unsicher · noch klären / nachfragen">? Unsicher</button>
                                  {rv && rv.status !== "offen" && (
                                    <button onClick={() => setReview(p.pos, "offen")} disabled={busy}
                                      className="text-[11px] font-mono px-1.5 py-0.5 rounded text-ink-mute hover:text-ink"
                                      title="Zurücksetzen">↺</button>
                                  )}
                                </div>
                              )}
                              {!released && commenting?.pos === p.pos && (
                                <div className="mt-2 ml-4 bg-bg-2 border border-copper/40 rounded-md p-2.5">
                                  <div className="dd-eyebrow text-copper mb-1.5">
                                    {commenting.status === "kommentar" ? "💬 Kommentar zu dieser Position" : "? Was bist du dir unsicher?"}
                                  </div>
                                  <textarea
                                    value={commenting.text}
                                    onChange={(e) => setCommenting({ ...commenting, text: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape") { e.preventDefault(); setCommenting(null); }
                                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commenting.text.trim()) {
                                        e.preventDefault();
                                        saveReview(p.pos, commenting.status, commenting.text.trim());
                                      }
                                    }}
                                    autoFocus
                                    rows={3}
                                    placeholder={commenting.status === "kommentar" ? "z.B. Höhe bitte 183 statt 163" : "z.B. Maße prüfen · Hesse-Preis nachfragen · noch ohne Aufmaß"}
                                    className="w-full bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[12.5px] font-sans focus:outline-none focus:border-copper resize-y"
                                  />
                                  <div className="mt-1.5 flex items-center justify-between gap-2">
                                    <span className="font-mono text-[10px] text-ink-mute">
                                      Strg+↵ speichert · Esc bricht ab
                                    </span>
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => setCommenting(null)}
                                        className="text-[11px] font-mono px-2 py-1 rounded text-ink-2 hover:text-ink"
                                      >abbrechen</button>
                                      <button
                                        onClick={() => saveReview(p.pos, commenting.status, commenting.text.trim() || undefined)}
                                        disabled={busy}
                                        className="text-[11px] font-mono px-2.5 py-1 rounded bg-copper text-white hover:bg-copper-bright disabled:opacity-50"
                                      >{busy ? "speichere …" : "speichern"}</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.quantity}</td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.unitPrice}</td>
                            <td className="text-right font-mono font-bold text-[12.5px] text-ink px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{eur(p.sum)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 px-4 py-4 rounded-lg surface-steel">
                    <span className="font-sans text-[13px] text-steel">Netto-Gesamt · 0 % USt (§19)</span>
                    <span className="font-display font-black text-[22px] text-white tabular-nums">
                      {eur(card.positions.reduce((t, p) => t + (p.sum || 0), 0))}
                    </span>
                  </div>

                  {/* Chef-Freigabe */}
                  <div className="mt-5">
                    <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5">
                      Freigabe
                    </div>
                    {revErr && (
                      <div className="mb-2 px-3 py-2 bg-rust/10 border border-rust/35 rounded text-[12px] text-rust">{revErr}</div>
                    )}
                    {released ? (
                      <div className="rounded-lg border-2 border-good/50 bg-good/10 px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-display font-extrabold uppercase text-[13px] text-good">✓ Freigegeben</div>
                          <div className="font-sans text-[12.5px] text-ink-2 mt-0.5">
                            durch {card.freigabe?.releasedBy} am {fmtDateTime(card.freigabe?.releasedAt)}
                          </div>
                        </div>
                        <button onClick={doRevoke} disabled={busy}
                          className="btn-ghost !min-h-[40px] !px-3 text-[11px] !text-rust !border-rust/40">
                          Freigabe zurücknehmen
                        </button>
                      </div>
                    ) : (
                      <button onClick={doRelease} disabled={busy}
                        className="btn-primary w-full !min-h-[52px] text-[13px] disabled:opacity-50"
                        style={{ background: "linear-gradient(180deg,#2F8C4E,#1F7A3D)" }}>
                        {busy ? "…" : "✓ Alles freigeben"}
                      </button>
                    )}

                    {history.length > 0 && (
                      <div className="mt-3">
                        <button onClick={() => setShowLog((s) => !s)}
                          className="font-mono text-[11px] text-ink-2 hover:text-ink uppercase tracking-wide">
                          {showLog ? "▾" : "▸"} Verlauf ({history.length})
                        </button>
                        {showLog && (
                          <ul className="mt-2 border border-steel rounded-lg bg-white divide-y divide-[#E2E4E7]">
                            {[...history].reverse().map((h, idx) => (
                              <li key={idx} className="px-3 py-2 flex items-baseline justify-between gap-3">
                                <span className="font-sans text-[12.5px] text-ink">{h.action}</span>
                                <span className="font-mono text-[11px] text-ink-2 whitespace-nowrap">
                                  {h.by} · {fmtDateTime(h.at)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : !inquiry ? (
                <div className="border border-dashed border-steel rounded-lg px-5 py-8 text-center bg-white/50">
                  <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
                    {card.docNumber
                      ? `Positionen zu ${card.docNumber} werden aus sevDesk gespiegelt, sobald der Abgleich gelaufen ist.`
                      : "Noch kein sevDesk-Beleg verknüpft."}
                  </p>
                </div>
              ) : null}
            </div>

          </div>
        </div>

        {canSync && (
          <div className="flex-shrink-0 px-5 lg:px-6 pt-3 pb-1 bg-[#E2E4E7] border-t border-steel">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={doSync}
                disabled={syncBusy}
                className="btn-ghost !min-h-[44px] !px-4 text-[12px] !text-copper !border-copper/50 inline-flex items-center gap-2 disabled:opacity-50"
                title={`Positionen, Summe und Status aus dem sevDesk-Beleg ${card.docNumber ?? ""} holen und vergleichen (sevDesk wird nur gelesen)`}
              >
                {syncBusy ? "↻ sevDesk wird gelesen …" : "↻ Daten mit sevDesk abgleichen"}
              </button>
              <span className="font-sans text-[11.5px] text-ink-2">
                Holt den Live-Stand des Belegs. Du bestätigst, was übernommen wird.
              </span>
            </div>
            {syncErr && (
              <div className="mt-2 font-sans text-[12px] text-rust">⚠ {syncErr}</div>
            )}
          </div>
        )}

        {canLink && (
          <div className="flex-shrink-0 px-5 lg:px-6 pt-3 pb-1 bg-[#E2E4E7] border-t border-steel">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={doFindOrders}
                disabled={linkBusy}
                className="btn-ghost !min-h-[44px] !px-4 text-[12px] !text-copper !border-copper/50 inline-flex items-center gap-2 disabled:opacity-50"
                title={`In sevDesk nach einem Beleg für „${card.customerName}" suchen und mit dieser Karte verknüpfen`}
              >
                {linkBusy ? "🔗 sevDesk wird durchsucht …" : "🔗 sevDesk-Beleg suchen & verknüpfen"}
              </button>
              <span className="font-sans text-[11.5px] text-ink-2">
                Diese Karte hat noch keinen sevDesk-Beleg. Hier den passenden suchen.
              </span>
            </div>
            {linkErr && (
              <div className="mt-2 font-sans text-[12px] text-rust">⚠ {linkErr}</div>
            )}
          </div>
        )}

        <div className="flex-shrink-0 px-5 lg:px-6 py-3.5 bg-[#E2E4E7] border-t border-steel flex gap-2.5 flex-wrap">
          {reviewerOnly ? (
            <button onClick={onClose} className="btn-primary flex-1 !min-h-[52px] text-[13px]">
              Schließen
            </button>
          ) : card.archivedAt ? (
            <>
              <button onClick={onUnarchive} className="btn-primary flex-1 !min-h-[52px] text-[13px]"
                disabled={!!card.cancelledAt}
                title={card.cancelledAt ? "Storno erst zurücknehmen, dann zurück ins Board" : undefined}>
                Zurück ins Board
              </button>
              {card.cancelledAt && (
                <button
                  onClick={onUncancel}
                  className="btn-ghost !min-h-[52px] !px-4 text-[12px] !text-copper !border-copper/40"
                  title="Storno rückgängig (sevDesk muss manuell zurückgesetzt werden)"
                >Storno rückgängig</button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={onPrev} disabled={i === 0}
                className="btn-ghost flex-1 !min-h-[52px] text-[12px] disabled:opacity-30"
              >‹ Stufe zurück</button>
              {card.stage === "Anfrage" ? (
                <a
                  href={`/admin/angebot-neu/${card.id}`}
                  className="btn-primary flex-1 !min-h-[52px] text-[12px] flex items-center justify-center"
                >
                  → Angebot draus machen
                </a>
              ) : card.stage === "Abgerechnet" ? (
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
          {!reviewerOnly && !card.archivedAt && card.stage !== "Anfrage" && card.stage !== "Abgerechnet" && (
            <button
              onClick={onCancel}
              className="btn-ghost !min-h-[52px] !px-4 text-[12px] !text-rust !border-rust/40"
              title={card.docNumber ? `Storniert Vorgang ${card.docNumber} (lokal + sevDesk)` : "Storniert nur lokal, kein sevDesk-Beleg verknüpft"}
            >Stornieren</button>
          )}
          {!reviewerOnly && (
            <button
              onClick={onDelete}
              className="btn-ghost !min-h-[52px] !px-4 text-[12px] !text-rust !border-rust/40"
            >Löschen</button>
          )}
        </div>
      </aside>
      {syncSnap && (
        <SyncPreviewModal
          card={card}
          snap={syncSnap}
          customer={syncCustomer}
          busy={syncBusy}
          onCancel={() => { setSyncSnap(null); setSyncCustomer(null); }}
          onApply={applySync}
        />
      )}
      {linkCands !== null && (
        <LinkPickerModal
          customerName={card.customerName}
          candidates={linkCands}
          busy={linkBusy}
          onPick={pickOrder}
          onCancel={() => setLinkCands(null)}
        />
      )}
    </>
  );
}

/** Auswahl-Dialog: zeigt die in sevDesk gefundenen Belege zu einem Kunden,
 *  damit die Karte mit dem richtigen verknüpft werden kann. */
function LinkPickerModal({
  customerName, candidates, busy, onPick, onCancel
}: {
  customerName: string;
  candidates: SevOrderRef[];
  busy: boolean;
  onPick: (ref: SevOrderRef) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-bg-1 rounded-xl shadow-2xl border border-steel">
        <div className="surface-steel px-5 py-4 sticky top-0">
          <div className="font-display font-black uppercase text-[18px] text-white leading-tight">sevDesk-Beleg verknüpfen</div>
          <div className="font-mono text-[12px] text-steel mt-1">Treffer für „{customerName}"</div>
        </div>
        <div className="px-5 py-4 space-y-2.5">
          {candidates.length === 0 ? (
            <div className="px-4 py-6 text-center font-sans text-[13.5px] text-ink-2">
              In sevDesk wurde kein Beleg gefunden, der zu „{customerName}" passt.
              <div className="mt-1.5 text-[12px]">Tipp: Schreibweise des Namens prüfen. Möglicherweise existiert der Beleg noch nicht.</div>
            </div>
          ) : (
            candidates.map((o) => (
              <button
                key={o.id}
                onClick={() => onPick(o)}
                disabled={busy}
                className="w-full text-left px-4 py-3 rounded-lg border border-steel/50 bg-white/70 hover:border-copper hover:bg-[#FBF3E9] transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono font-bold text-[13px] text-ink">{o.orderNumber || "(ohne Nr.)"}</span>
                  <span className="font-display font-black text-[15px] text-ink tabular-nums">{eur(o.sumNet)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="font-sans text-[12.5px] text-ink-body truncate">{o.contactName || "—"}</span>
                  <span className="font-sans text-[11.5px] text-ink-2 whitespace-nowrap">{o.statusLabel}</span>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="px-5 py-3.5 bg-[#E2E4E7] border-t border-steel sticky bottom-0">
          <button onClick={onCancel} disabled={busy} className="btn-ghost w-full !min-h-[48px] text-[13px]">
            {busy ? "lädt …" : "Abbrechen"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Vorschau-Dialog für den sevDesk-Abgleich: zeigt alt → neu (Positionen,
 *  Summe, Beleg-Nummer, Status/Stufe) und übernimmt nur die angehakten Felder. */
function SyncPreviewModal({
  card, snap, customer, busy, onCancel, onApply
}: {
  card: PipelineCard;
  snap: SevOrderSnapshot;
  customer: Customer | null;
  busy: boolean;
  onCancel: () => void;
  onApply: (patch: {
    positions?: PipelinePosition[]; valueEur?: number; docNumber?: string; sevdeskOrderId?: string;
    contact?: { phone?: string; email?: string; street?: string; zip?: string; city?: string };
  }) => void;
}) {
  const newPositions = useMemo(
    () => sevPositionsToPipeline(snap.positions, card.positions),
    [snap, card.positions]
  );
  const newValue = snap.sumNet;
  const oldValue = card.valueEur ?? card.planEur;

  // Karte war vorher gar nicht mit sevDesk verknüpft → dieser Abgleich verbindet sie
  const isNewLink = !card.sevdeskOrderId;

  // Was sich tatsächlich unterscheidet. Die Pipeline-Stufe ist BEWUSST nicht
  // dabei — sie wird im Kanban gepflegt, nicht aus dem sevDesk-Status abgeleitet.
  const posChanged = JSON.stringify(card.positions ?? []) !== JSON.stringify(newPositions);
  const valueChanged = (oldValue ?? null) !== (newValue ?? null);
  const linkChanged =
    ((card.docNumber ?? "") !== (snap.orderNumber ?? "") && !!snap.orderNumber) ||
    ((card.sevdeskOrderId ?? "") !== snap.id && !!snap.id);

  // Kontaktdaten-Abgleich: sevDesk-Wert übernehmen, wenn vorhanden UND er sich
  // vom App-Kunden unterscheidet (füllt auch leere Felder).
  const norm = (s?: string) => (s ?? "").trim();
  // Telefon nur über die Ziffern vergleichen (00049/+49/0 vereinheitlicht) —
  // sonst gilt „+49 162 …" ≠ „0162 …", obwohl es dieselbe Nummer ist.
  const phoneDigits = (s?: string) => (s ?? "").replace(/\D/g, "").replace(/^0049/, "0").replace(/^49/, "0");
  const sc = snap.contact;
  const contactDiff: { phone?: string; email?: string; street?: string; zip?: string; city?: string } = {};
  if (sc) {
    if (sc.phone && phoneDigits(sc.phone) !== phoneDigits(customer?.phone)) contactDiff.phone = sc.phone;
    if (sc.email && norm(sc.email).toLowerCase() !== norm(customer?.email).toLowerCase()) contactDiff.email = sc.email;
    if (sc.street && norm(sc.street) !== norm(customer?.street)) contactDiff.street = sc.street;
    if (sc.zip && norm(sc.zip) !== norm(customer?.zip)) contactDiff.zip = sc.zip;
    if (sc.city && norm(sc.city) !== norm(customer?.city)) contactDiff.city = sc.city;
  }
  const contactChanged = Object.keys(contactDiff).length > 0;
  const addrStr = (c?: { street?: string; zip?: string; city?: string } | null) =>
    [c?.street, [c?.zip, c?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  // Häkchen — standardmäßig alles übernehmen, was sich geändert hat
  const [takePos, setTakePos] = useState(posChanged);
  const [takeValue, setTakeValue] = useState(valueChanged);
  const [takeDoc, setTakeDoc] = useState(linkChanged);
  const [takeContact, setTakeContact] = useState(contactChanged);

  const nothingToDo = !posChanged && !valueChanged && !linkChanged && !contactChanged;
  const nothingPicked = !takePos && !takeValue && !takeDoc && !takeContact;

  function apply() {
    const patch: {
      positions?: PipelinePosition[]; valueEur?: number; docNumber?: string; sevdeskOrderId?: string;
      contact?: { phone?: string; email?: string; street?: string; zip?: string; city?: string };
    } = {};
    if (takePos) patch.positions = newPositions;
    if (takeValue) patch.valueEur = newValue;
    if (takeDoc) { patch.docNumber = snap.orderNumber; patch.sevdeskOrderId = snap.id; }
    if (takeContact && contactChanged) patch.contact = contactDiff;
    onApply(patch);
  }

  const Row = ({ on, set, label, children, changed }: {
    on: boolean; set: (v: boolean) => void; label: string; children: React.ReactNode; changed: boolean;
  }) => (
    <label className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${changed ? "border-copper/40 bg-[#FBF3E9]" : "border-steel/40 bg-white/60"} cursor-pointer`}>
      <input type="checkbox" checked={on} disabled={!changed} onChange={(e) => set(e.target.checked)} className="mt-1 accent-copper w-4 h-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-display font-extrabold uppercase text-[11.5px] tracking-wider text-ink mb-1">{label}</div>
        {changed ? children : <div className="font-sans text-[12.5px] text-ink-2">Unverändert, schon aktuell.</div>}
      </div>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/50" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-bg-1 rounded-xl shadow-2xl border border-steel">
        <div className="surface-steel px-5 py-4 sticky top-0">
          <div className="font-display font-black uppercase text-[18px] text-white leading-tight">sevDesk-Abgleich</div>
          <div className="font-mono text-[12px] text-steel mt-1">
            Beleg {snap.orderNumber || "—"} · Status {snap.statusLabel} · {snap.positions.length} Positionen · netto {eur(snap.sumNet)}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {nothingToDo ? (
            <div className="px-4 py-6 text-center font-sans text-[13.5px] text-ink-2">
              ✓ Die Karte ist bereits auf dem Stand des sevDesk-Belegs. Nichts abzugleichen.
            </div>
          ) : (
            <>
              <Row on={takePos} set={setTakePos} label="Positionen" changed={posChanged}>
                <div className="font-sans text-[12.5px] text-ink-body">
                  <span className="text-ink-2">{card.positions?.length ?? 0} alt</span>
                  {" → "}
                  <b>{newPositions.length} aus sevDesk</b>
                </div>
                <div className="mt-2 border border-steel/40 rounded-md overflow-hidden">
                  {newPositions.slice(0, 12).map((p) => (
                    <div key={p.pos} className="flex justify-between gap-3 px-3 py-1.5 text-[12px] border-b border-steel/20 last:border-0 bg-white/70">
                      <span className="truncate text-ink-body">{p.pos + 1}. {p.name}</span>
                      <span className="font-mono tabular-nums whitespace-nowrap text-ink-2">{p.quantity} · {eur(p.sum)}</span>
                    </div>
                  ))}
                  {newPositions.length > 12 && (
                    <div className="px-3 py-1.5 text-[11.5px] text-ink-2 bg-white/70">+ {newPositions.length - 12} weitere …</div>
                  )}
                </div>
                <div className="mt-1.5 font-sans text-[11px] text-ink-2">Chef-Freigaben je Position bleiben erhalten.</div>
              </Row>

              <Row on={takeValue} set={setTakeValue} label="Volumen netto" changed={valueChanged}>
                <div className="font-sans text-[13px]">
                  <span className="text-ink-2 line-through">{oldValue != null ? eur(oldValue) : "offen"}</span>
                  {" → "}
                  <b className="text-ink">{eur(newValue)}</b>
                </div>
              </Row>

              <Row on={takeDoc} set={setTakeDoc} label={isNewLink ? "Beleg verknüpfen" : "Beleg-Nummer"} changed={linkChanged}>
                {isNewLink ? (
                  <div className="font-sans text-[13px]">
                    Karte wird mit sevDesk-Beleg <b className="text-ink">{snap.orderNumber}</b> verbunden.
                  </div>
                ) : (
                  <div className="font-sans text-[13px]">
                    <span className="text-ink-2 line-through">{card.docNumber || "—"}</span>
                    {" → "}
                    <b className="text-ink">{snap.orderNumber}</b>
                  </div>
                )}
              </Row>

              <Row on={takeContact} set={setTakeContact} label="Kontaktdaten (Kunde)" changed={contactChanged}>
                <div className="font-sans text-[12.5px] space-y-1">
                  {contactDiff.phone && (
                    <div><span className="text-ink-mute">Telefon: </span><span className="text-ink-2 line-through">{customer?.phone || "—"}</span> → <b className="text-ink">{contactDiff.phone}</b></div>
                  )}
                  {contactDiff.email && (
                    <div><span className="text-ink-mute">E-Mail: </span><span className="text-ink-2 line-through">{customer?.email || "—"}</span> → <b className="text-ink">{contactDiff.email}</b></div>
                  )}
                  {(contactDiff.street || contactDiff.zip || contactDiff.city) && (
                    <div><span className="text-ink-mute">Adresse: </span><span className="text-ink-2 line-through">{addrStr(customer) || "—"}</span> → <b className="text-ink">{addrStr(snap.contact)}</b></div>
                  )}
                  {!customer && (
                    <div className="text-[11px] text-copper pt-0.5">Kunde „{snap.contact?.name}" wird dabei neu angelegt und mit der Karte verknüpft.</div>
                  )}
                </div>
              </Row>

              <div className="px-1 pt-1 font-sans text-[11.5px] text-ink-2">
                Die Pipeline-Stufe bleibt unberührt. Dafür ist das Kanban-Board maßgebend.
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#E2E4E7] border-t border-steel flex gap-2.5 sticky bottom-0">
          <button onClick={onCancel} disabled={busy} className="btn-ghost flex-1 !min-h-[48px] text-[13px]">
            {nothingToDo ? "Schließen" : "Abbrechen"}
          </button>
          {!nothingToDo && (
            <button onClick={apply} disabled={busy || nothingPicked} className="btn-primary flex-1 !min-h-[48px] text-[13px] disabled:opacity-50">
              {busy ? "Übernehme …" : "Ausgewähltes übernehmen"}
            </button>
          )}
        </div>
      </div>
    </div>
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
              <div className="flex items-center gap-1.5">
                {c.docNumber && (
                  <span className="font-mono font-bold text-[12px] bg-bg-deep text-bg-2 px-2 py-0.5 rounded">
                    {c.docNumber}
                  </span>
                )}
                {c.cancelledAt && (
                  <span className="font-mono font-bold text-[10.5px] bg-rust/15 text-rust border border-rust/35 px-1.5 py-0.5 rounded uppercase tracking-wide">
                    storniert
                  </span>
                )}
              </div>
              {!c.cancelledAt && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnarchive(c); }}
                  className="font-sans text-[12px] text-copper hover:text-copper-bright font-bold"
                >↩ zurückholen</button>
              )}
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

function CancelModal({
  card, reason, busy, error, onChange, onConfirm, onClose
}: {
  card: PipelineCard;
  reason: string;
  busy: boolean;
  error?: string;
  onChange: (r: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // ESC zum Schließen wenn nicht laufender Storno
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [busy, onClose]);

  const hasOrderRef = !!card.sevdeskOrderId || /^AN-\d+/i.test(card.docNumber ?? "");

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[80] flex items-center justify-center p-4 lg:p-6"
         onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-label="Vorgang stornieren"
           className="bg-bg-2 rounded-2xl w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto board-scroll border-2 border-rust/40">

        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="dd-eyebrow text-rust">⚠ Vorgang stornieren</span>
          {!busy && (
            <button onClick={onClose} aria-label="Schließen"
              className="font-sans text-ink-2 text-[13px] hover:text-ink">✕</button>
          )}
        </div>
        <h2 className="font-display font-black uppercase text-[22px] text-ink leading-tight">
          {card.docNumber ? card.docNumber + " · " : ""}{card.customerName}
        </h2>
        {card.place && (
          <div className="font-sans text-[13px] text-ink-2 mt-0.5">{card.place}</div>
        )}

        <div className="mt-4 rounded-lg border border-steel bg-white px-4 py-3 text-[13px] text-ink-body font-sans leading-relaxed">
          {hasOrderRef ? (
            <>Setzt den sevDesk-Auftrag <b>{card.docNumber}</b> auf Status <b>„Abgelehnt"</b> und schreibt einen Storno-Vermerk in den Belegtext. Lokal wird die Karte ins Archiv verschoben.</>
          ) : (
            <>Kein sevDesk-Beleg verknüpft. Die Karte wird nur lokal storniert und ins Archiv verschoben.</>
          )}
        </div>

        <label className="block mt-4">
          <span className="font-sans text-[12.5px] font-bold text-ink-2 block mb-1.5">
            Grund <span className="text-ink-mute font-normal">(optional, erscheint im sevDesk-Belegtext)</span>
          </span>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={'z. B. „Kunde hat anderes Angebot genommen" / „Preis zu hoch" / „Termin nicht zu halten"…'}
            className="w-full bg-white border border-steel rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:border-rust resize-none"
            disabled={busy}
            maxLength={240}
          />
          <div className="font-mono text-[10.5px] text-ink-mute mt-1">{reason.length}/240</div>
        </label>

        {error && (
          <div className="mt-3 px-3 py-2 bg-rust/10 border border-rust/35 rounded text-[12.5px] text-rust font-sans">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2.5 flex-wrap">
          <button onClick={onClose} disabled={busy}
            className="btn-ghost flex-1 !min-h-[48px] text-[13px] disabled:opacity-40">
            Abbrechen
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="btn-primary flex-1 !min-h-[48px] text-[13px] disabled:opacity-60"
            style={{ background: "linear-gradient(180deg,#B33D2E,#8C2C20)" }}>
            {busy ? "Storniere …" : (hasOrderRef ? "Stornieren (App + sevDesk)" : "Stornieren (nur lokal)")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Original-Anfrage-Panel (Pipeline-Drawer) ──────────────────────────── */
/** Initialen aus einem Namen, z. B. „Mischa Nitschke" → „MN". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

function CcBadge({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-[3px] rounded-full border whitespace-nowrap" style={style}>
      {children}
    </span>
  );
}

function statusStyle(s: string): React.CSSProperties {
  const open = /offen|neu|unbearb|wartet/i.test(s);
  return open
    ? { background: "rgba(201,133,47,.22)", color: "#F5B45A", borderColor: "rgba(245,180,90,.3)" }
    : { background: "rgba(31,122,61,.25)", color: "#4ADE80", borderColor: "rgba(74,222,128,.3)" };
}
function prioStyle(p: string): React.CSSProperties {
  if (/dringend|hoch|urgent|eilig/i.test(p))
    return { background: "rgba(185,28,28,.28)", color: "#F87171", borderColor: "rgba(248,113,113,.35)" };
  return { background: "rgba(107,114,128,.2)", color: "rgba(255,255,255,.6)", borderColor: "rgba(255,255,255,.15)" };
}

/**
 * Kontakt- & Herkunft-Block (Design „Variante 7 · Dunkle Stahl-Karte").
 * Erscheint in JEDER Karte: nutzt die Anfrage-Daten, wenn vorhanden, sonst die
 * Karten-Stammdaten als Fallback (graceful — fehlende Felder „nicht erfasst").
 */
function ContactCard({ card, inquiry }: { card: PipelineCard; inquiry: Inquiry | null }) {
  const name = inquiry?.customerName || card.customerName || "—";
  const phone = inquiry?.customerPhone;
  const email = inquiry?.customerEmail;
  const ort = inquiry?.city || card.place;
  const anliegen = inquiry?.description || card.description;
  const sub = [card.docNumber, ort].filter(Boolean).join(" · ");

  const avatarBg = inquiry
    ? "linear-gradient(135deg,#DC6E2D 0%,#8A3A10 100%)"
    : "linear-gradient(135deg,#8C6E45,#4A3010)";

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg,#272A2D,#1C1F22)", border: "1px solid #3A3F44" }}>
      {/* Header: Avatar + Name + Badges */}
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid #3A3F44" }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-extrabold text-white flex-shrink-0"
             style={{ background: avatarBg, boxShadow: "0 0 0 2px rgba(220,110,45,.3)" }}>
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold truncate" style={{ color: "#F0F2F4" }}>{name}</div>
          {sub && <div className="text-[10.5px] font-mono tracking-wide mt-px truncate" style={{ color: "rgba(255,255,255,.45)" }}>{sub}</div>}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 flex-shrink-0">
          {inquiry ? (
            <CcBadge style={{ background: "rgba(220,110,45,.2)", color: "#E8853F", borderColor: "rgba(220,110,45,.35)" }}>
              {SOURCE_ICON[inquiry.source] ?? "✉"} {SOURCE_LABEL[inquiry.source] ?? inquiry.source} · {fmtDate(inquiry.createdAt.slice(0, 10)).slice(0, 5)}
            </CcBadge>
          ) : (
            <CcBadge style={{ background: "rgba(140,110,69,.2)", color: "#D4A870", borderColor: "rgba(140,110,69,.35)" }}>🗂 sevDesk</CcBadge>
          )}
          {inquiry?.status && <CcBadge style={statusStyle(inquiry.status)}>{inquiry.status}</CcBadge>}
          {inquiry?.priority && <CcBadge style={prioStyle(inquiry.priority)}>{inquiry.priority}</CcBadge>}
        </div>
      </div>

      {/* Body: Feld-Zeilen */}
      <div className="px-4 py-1.5 [&>*:last-child]:border-b-0">
        <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
          <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Telefon</span>
          {phone
            ? <a href={`tel:${phone.replace(/\s/g, "")}`} className="font-mono text-[12px] font-bold no-underline" style={{ color: "#4ADE80" }}>{phone}</a>
            : <span className="text-[12px]" style={{ color: "rgba(255,255,255,.3)" }}>nicht erfasst</span>}
        </div>
        {email && (
          <div className="flex justify-between items-center gap-3 py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <span className="text-[11px] font-mono tracking-wide flex-shrink-0" style={{ color: "rgba(255,255,255,.4)" }}>E-Mail</span>
            <a href={`mailto:${email}`} className="text-[12px] no-underline truncate" style={{ color: "#E8853F" }}>{email}</a>
          </div>
        )}
        <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
          <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Ort</span>
          {ort
            ? <span className="font-medium" style={{ color: "rgba(255,255,255,.85)" }}>{ort}</span>
            : <span className="text-[12px]" style={{ color: "rgba(255,255,255,.3)" }}>nicht erfasst</span>}
        </div>
      </div>

      {/* Copper-Schweißnaht + Anliegen */}
      {anliegen && (
        <>
          <div style={{ height: 2, margin: "0 16px 12px", background: "linear-gradient(90deg,#DC6E2D,#E8853F,transparent)" }} />
          <div className="px-4 pb-3.5">
            <div className="text-[9.5px] font-mono uppercase tracking-[.12em] font-bold mb-1.5" style={{ color: "#DC6E2D" }}>Anliegen</div>
            <p className="text-[12.5px] italic leading-relaxed whitespace-pre-wrap" style={{ color: "rgba(255,255,255,.7)" }}>{anliegen}</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Foto-Galerie für WhatsApp-Fotos einer Anfrage. */
function InquiryPhotoGallery({ inquiry }: { inquiry: Inquiry }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!inquiry.photos?.length) return;
    Promise.all(inquiry.photos.map((p) => inquiryPhotoUrl(p.path))).then(setUrls);
  }, [inquiry.id, inquiry.photos?.length]);
  if (!inquiry.photos?.length) return null;
  return (
    <div className="border border-steel rounded-lg bg-white px-4 py-3">
      <div className="dd-eyebrow text-ink-mute mb-2">
        📷 WhatsApp-Fotos · {inquiry.photos.length} Bild{inquiry.photos.length === 1 ? "" : "er"}
      </div>
      <div className="flex flex-wrap gap-2">
        {inquiry.photos.map((photo, i) => {
          const url = urls[i];
          return url ? (
            <button key={i} type="button" onClick={() => setOpen(url)} className="group relative overflow-hidden rounded-md border border-steel-line/20 focus:outline-none focus:ring-2 focus:ring-copper">
              <img src={url} alt={photo.name} className="w-24 h-24 object-cover group-hover:opacity-90 transition-opacity" loading="lazy" />
            </button>
          ) : (
            <div key={i} className="w-24 h-24 rounded-md border border-steel-line/20 bg-bg-2 animate-pulse" />
          );
        })}
      </div>
      {open && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <img src={open} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setOpen(null)} className="absolute top-4 right-4 w-10 h-10 bg-white/10 text-white rounded-full grid place-items-center hover:bg-white/25 text-lg">✕</button>
        </div>
      )}
    </div>
  );
}

/** Verlaufs-Timeline + Original-Rohtext einer Anfrage (unter der ContactCard). */
function InquiryHistory({ inquiry }: { inquiry: Inquiry }) {
  const log = [...inquiry.notesLog].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="space-y-3">
      {log.length > 0 && (
        <div className="border border-steel rounded-lg bg-white px-4 py-3">
          <div className="dd-eyebrow text-ink-mute mb-2">Verlauf · {log.length} Eintrag{log.length === 1 ? "" : "e"}</div>
          <ol className="flex flex-col gap-2">
            {log.map((e, i) => (
              <li key={i} className="grid grid-cols-[112px_1fr] gap-2 text-[12.5px] border-l-2 border-copper/40 pl-3 py-0.5">
                <span className="font-mono text-[10.5px] text-ink-mute tabular-nums">{e.at.slice(0, 10)} {e.at.slice(11, 16)}</span>
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-copper mr-1.5">{e.by ?? "—"} · {e.kind}</span>
                  <span className="text-ink">{e.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <InquiryPhotoGallery inquiry={inquiry} />

      {inquiry.rawText && (
        <details className="border border-steel rounded-lg bg-white px-4 py-3">
          <summary className="cursor-pointer dd-eyebrow text-ink-mute">
            Original-Nachricht ({inquiry.rawText.length.toLocaleString("de")} Zeichen)
          </summary>
          <pre className="mt-2 text-[11.5px] leading-relaxed whitespace-pre-wrap font-mono text-ink-body max-h-[400px] overflow-auto">{inquiry.rawText}</pre>
        </details>
      )}
    </div>
  );
}
