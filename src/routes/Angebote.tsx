import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  STAGES, listCards, createCard, updateCardStage, deleteCard,
  archiveCard, unarchiveCard, linkOrCreateSiteForCard, FOLLOWUP_DAYS,
  releaseCard, revokeRelease,
  cancelCard, uncancelCard,
  sevPositionsToPipeline, syncCardFromSevdesk, setCardPositions,
  type PipelineCard, type Stage, type PipelinePosition
} from "../lib/pipeline";
import { sevdeskGetOrderSnapshot, sevdeskFindOrdersForName, type SevOrderSnapshot, type SevOrderRef } from "../lib/sevdesk";
import { getCustomerBySevdeskContactId, findCustomerByName, updateCustomerContact, createCustomerLocal, listCustomers, type Customer } from "../lib/customers";
import { useRealtime, useRefreshOnVisible, useRefreshOnAuth } from "../lib/realtime";
import { currentUser } from "../lib/auth";
import BackButton from "../components/BackButton";
import { getInquiryByCardId, listInquiries, inquiryPhotoUrl, uploadInquiryPhoto, uploadInquiryVideo, updateInquiryPhotos, updateInquiry, appendCardNote, upsertCardContact, deleteInquiryPhotoFile, SOURCE_ICON, SOURCE_LABEL, type Inquiry, type InquiryPhoto } from "../lib/inquiries";
import { uploadSitePhoto, getCurrentCompanyId } from "../lib/photos";
import { extractZipMedia, parseWhatsAppText, whatsAppSummary } from "../lib/zipImport";

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
  useRealtime("pipeline", ["pipeline_cards", "inquiries"], refresh);
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
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── ANFRAGE-EINGANG ─────────────────────────────────────── */}
          {(() => {
            const anfrageList = byStage("Anfrage");
            const anfrageMeta = STAGE_META["Anfrage"];
            return (
              <section
                className="mx-4 lg:mx-8 mt-4 rounded-xl border-2 border-copper/30 bg-copper/5 flex-shrink-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const c = cards.find((x) => x.id === dragId.current);
                  if (c) moveTo(c, "Anfrage");
                  dragId.current = null;
                }}
              >
                <header className="px-4 py-3 flex items-center justify-between gap-3 border-b border-copper/20">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: anfrageMeta.color }} />
                    <span className="font-display font-extrabold uppercase text-[13px] tracking-widest text-copper-bright">
                      Anfrage-Eingang
                    </span>
                    <span className="font-mono font-bold text-[11px] bg-copper text-white px-2 py-0.5 rounded-full min-w-[22px] text-center">
                      {anfrageList.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[11.5px] text-ink-mute">{anfrageMeta.hint}</span>
                    <button
                      onClick={() => navigate("/admin/anfrage-neu")}
                      title="Neue Anfrage anlegen"
                      className="w-7 h-7 rounded-full bg-copper hover:bg-copper-bright text-white font-bold text-[14px] grid place-items-center transition-colors"
                    >＋</button>
                  </div>
                </header>
                <div className="flex gap-3 px-4 py-3 overflow-x-auto board-scroll min-h-[80px]">
                  {anfrageList.length === 0 ? (
                    <div className="flex-1 grid place-items-center font-sans text-[12.5px] text-copper/50 italic py-2">
                      kein offener Eingang
                    </div>
                  ) : (
                    anfrageList.map((c) => (
                      <div key={c.id} className="w-[260px] flex-shrink-0">
                        <CardView
                          card={c}
                          color={anfrageMeta.color}
                          inquiry={inquiryByCard[c.id] ?? null}
                          onOpen={() => setDetail(c)}
                          onDragStart={() => { dragId.current = c.id; }}
                          onArchive={() => archive(c)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })()}

          {/* ── PIPELINE-BOARD (ohne Anfrage-Stage) ─────────────────── */}
          <div className="flex-1 flex gap-3.5 px-4 lg:px-8 py-4 overflow-x-auto board-scroll">
            {STAGES.filter((s) => s !== "Anfrage" && !(hideClosed && s === "Abgerechnet")).map((stage) => {
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
                  <header className="surface-steel rounded-t-[11px] px-3.5 py-3 flex items-center justify-between gap-2">
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
                      {sum > 0 ? `Σ ${eur(sum)}` : "—"}
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

/** Konvertiert die vom LLM erkannten Leistungen einer Anfrage in zwei getrennte
 *  Listen: Arbeitspositionen (die Gewerke selbst) und Material (alle Materialien
 *  flach gemappt, jeweils mit „aus"-Quelle als Anker zum Gewerk).
 *  Rick-Vorgabe 16.06.: „Material und Arbeitspositionen klar getrennt". */
type InquiryLeistung = {
  name: string;
  mengen?: Array<{ wert?: string; einheit?: string; was?: string }>;
  materialien?: Array<{ name?: string; spec?: string; note?: string; menge?: { wert?: string; einheit?: string } }>;
};
function splitInquiryPositions(inquiry: Inquiry | null): {
  work: PipelinePosition[];
  material: PipelinePosition[];
} {
  const list = inquiry?.parsedJson?.leistungen as InquiryLeistung[] | undefined;
  if (!Array.isArray(list) || list.length === 0) return { work: [], material: [] };
  const work: PipelinePosition[] = [];
  const material: PipelinePosition[] = [];
  list.forEach((l, idx) => {
    const mengenStr = (l.mengen ?? [])
      .map((m) => `${m.wert ?? ""}${m.einheit ? " " + m.einheit : ""}${m.was ? " " + m.was : ""}`.trim())
      .filter(Boolean)
      .join(" · ");
    work.push({
      pos: idx + 1,
      name: l.name,
      quantity: mengenStr || "offen",
      unitPrice: "offen",
      sum: 0,
      source: "anfrage-arbeit",
    });
    (l.materialien ?? []).forEach((m) => {
      const baseName = [m.name, m.spec].filter(Boolean).join(" · ");
      const qty = m.menge
        ? `${m.menge.wert ?? ""}${m.menge.einheit ? " " + m.menge.einheit : ""}`.trim()
        : "offen";
      material.push({
        pos: material.length + 1,
        name: baseName || "unbenanntes Material",
        quantity: qty,
        unitPrice: "offen",
        sum: 0,
        source: `anfrage-material:${idx + 1}`,
        // Note kommt aus der LLM-Auswertung; wir blenden sie als comment ein,
        // damit der Bezug zum Gewerk + ggf. Hinweis sichtbar bleibt.
        review: m.note ? { status: "offen", comment: `${l.name}: ${m.note}` } : undefined,
      } as PipelinePosition);
    });
  });
  return { work, material };
}

/** Liefert die im Positionen-Tab anzuzeigenden Positionen + die Quelle.
 *  - Wenn die Karte schon `positions` hat (z. B. aus sevDesk-Sync): die zeigen.
 *  - Sonst: die LLM-erkannten Leistungen aus der Anfrage, aufgeteilt in
 *    Arbeit und Material. */
/** Klassifiziert eine PipelinePosition anhand des source-Markers in Arbeit
 *  oder Material. sevDesk-Positionen (kein source-Marker) gelten als Arbeit. */
function isMaterialPosition(p: PipelinePosition): boolean {
  const s = (p.source ?? "").toLowerCase();
  return s.startsWith("material") || s.startsWith("manuell-material") || s.startsWith("anfrage-material");
}

function effectivePositions(
  card: PipelineCard, inquiry: Inquiry | null,
): {
  fromInquiry: boolean;
  positions: PipelinePosition[]; // alle (für Migration beim Add)
  work: PipelinePosition[];
  material: PipelinePosition[];
} {
  // Eigene Positionen der Karte (sevDesk-Sync oder manuell gepflegt) haben
  // Vorrang. Sie werden nach source-Marker in Arbeit/Material gesplittet.
  if (card.positions && card.positions.length > 0) {
    const work = card.positions.filter((p) => !isMaterialPosition(p));
    const material = card.positions.filter((p) => isMaterialPosition(p));
    return { positions: card.positions, work, material, fromInquiry: false };
  }
  // Sonst: LLM-erkannte Anfrage-Positionen (read-only-Stand, werden bei Edit
  // automatisch migriert).
  const split = splitInquiryPositions(inquiry);
  return {
    positions: [...split.work, ...split.material],
    work: split.work,
    material: split.material,
    fromInquiry: split.work.length > 0 || split.material.length > 0,
  };
}

/** Inline-Formular zum manuellen Hinzufügen ODER Bearbeiten einer Position
 *  einer Karte. Rick-Vorgabe 16.06.: schon im Anfrage-Drawer Positionen
 *  pflegen können, getrennt nach Arbeit/Material, editierbar + löschbar.
 *  Speichert per setCardPositions. */
function PositionAdder({
  card, inquiry, defaultKind, initial, onSaved, onCancel, alwaysOpen,
}: {
  card: PipelineCard;
  inquiry?: Inquiry | null;
  defaultKind?: "arbeit" | "material";
  /** Wenn gesetzt: Edit-Modus für eine existierende Position (am gleichen Index ersetzen). */
  initial?: { index: number; name: string; quantity: string; unitPrice: string; kind: "arbeit" | "material" } | null;
  onSaved: (positions: PipelinePosition[], valueEur: number) => void;
  onCancel?: () => void;
  /** Wenn true: Form ist immer offen (Edit-Modus); kein „+ Hinzufügen"-Knopf. */
  alwaysOpen?: boolean;
}) {
  const isEdit = !!initial;
  const [open, setOpen] = useState(isEdit || !!alwaysOpen);
  const [kind, setKind] = useState<"arbeit" | "material">(initial?.kind ?? defaultKind ?? "arbeit");
  const [name, setName] = useState(initial?.name ?? "");
  const [qty, setQty] = useState(initial?.quantity ?? "");
  const [price, setPrice] = useState(initial?.unitPrice && initial.unitPrice !== "offen" ? initial.unitPrice : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function parsePrice(s: string): number {
    const cleaned = s.trim().replace(/[€\s]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  function parseQty(s: string): number {
    const m = s.trim().match(/^([0-9]+[.,]?[0-9]*)/);
    if (!m) return 1;
    const n = parseFloat(m[1].replace(",", "."));
    return Number.isFinite(n) ? n : 1;
  }

  async function save() {
    setErr(null);
    if (!name.trim()) { setErr("Bitte einen Namen für die Position eintragen."); return; }
    setBusy(true);
    try {
      const ep = parsePrice(price);
      const q  = parseQty(qty);
      const sum = +(ep * q).toFixed(2);
      // Wenn die Karte noch keine eigenen Positionen hat, aber die Anfrage
      // LLM-erkannte Leistungen mitbringt: erst Arbeit+Material migrieren,
      // damit nichts verloren geht. Danach Edit/Add anwenden.
      const inquirySplit = splitInquiryPositions(inquiry ?? null);
      const base = (card.positions && card.positions.length > 0)
        ? [...card.positions]
        : [...inquirySplit.work, ...inquirySplit.material];
      const sourceMarker = kind === "material" ? "manuell-material" : "manuell-arbeit";
      const newPos: PipelinePosition = {
        pos: 0, // wird unten neu nummeriert
        name: name.trim(),
        quantity: qty.trim() || "1",
        unitPrice: price.trim() || (ep > 0 ? ep.toFixed(2).replace(".", ",") : "offen"),
        sum,
        source: sourceMarker,
      };
      let next: PipelinePosition[];
      if (isEdit && initial && initial.index >= 0 && initial.index < base.length) {
        // Behalte review/meta vom Original, ersetze nur die editierten Felder
        const old = base[initial.index];
        next = base.slice();
        next[initial.index] = { ...old, ...newPos, pos: old.pos };
      } else {
        next = [...base, newPos];
      }
      // Neu-Nummerierung (pos 1..N) — robust gegen Lücken
      next = next.map((p, i) => ({ ...p, pos: i + 1 }));
      const valueEur = +next.reduce((t, p) => t + (p.sum || 0), 0).toFixed(2);
      await setCardPositions(card.id, next, valueEur);
      onSaved(next, valueEur);
      if (!isEdit) {
        setName(""); setQty(""); setPrice("");
        setOpen(false);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen");
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setOpen(true)}
          className="w-full border-2 border-dashed border-copper/45 hover:border-copper text-copper font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
        >
          ＋ Position hinzufügen
        </button>
      </div>
    );
  }

  const kindLabel = kind === "material" ? "Material" : "Arbeit";
  return (
    <div className={`mt-3 border-2 ${kind === "material" ? "border-[#3A8CE8]/60" : "border-copper/55"} bg-bg-2 rounded-lg p-3.5 space-y-2.5`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`font-display font-extrabold uppercase text-[12px] tracking-widest ${kind === "material" ? "text-[#3A8CE8]" : "text-copper"}`}>
          {isEdit ? "Position bearbeiten" : "Neue Position"} · {kindLabel}
        </div>
        {/* Kind-Toggle: nur im Add-Modus änderbar; im Edit-Modus zeigt es nur an */}
        <div className="inline-flex rounded-md bg-white border border-steel-line/45 overflow-hidden text-[11px] font-mono">
          <button
            type="button"
            onClick={() => !isEdit && setKind("arbeit")}
            className={`px-3 py-1.5 ${kind === "arbeit" ? "bg-copper text-white" : "text-ink-2 hover:text-copper"} ${isEdit ? "cursor-not-allowed opacity-70" : ""}`}
            disabled={isEdit}
          >🛠 Arbeit</button>
          <button
            type="button"
            onClick={() => !isEdit && setKind("material")}
            className={`px-3 py-1.5 ${kind === "material" ? "bg-[#3A8CE8] text-white" : "text-ink-2 hover:text-[#3A8CE8]"} ${isEdit ? "cursor-not-allowed opacity-70" : ""}`}
            disabled={isEdit}
          >📦 Material</button>
        </div>
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={kind === "material" ? "Bezeichnung · z.B. Doppelstabmatten 1830 mm anthrazit" : "Bezeichnung · z.B. Zaunmontage"}
        className="w-full bg-white border border-steel-line/55 rounded px-3 py-2 text-[13px] font-sans focus:outline-none focus:border-copper"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={kind === "material" ? "Menge · z.B. 13 Stk" : "Menge · z.B. 28 Std oder 200 m²"}
          className="bg-white border border-steel-line/55 rounded px-3 py-2 text-[13px] font-sans focus:outline-none focus:border-copper"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Einzelpreis € · z.B. 65,00"
          inputMode="decimal"
          className="bg-white border border-steel-line/55 rounded px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-copper"
        />
      </div>
      {err && <div className="text-rust text-[12px] font-mono">⚠ {err}</div>}
      <div className="flex items-center justify-between pt-1">
        <span className="font-mono text-[10.5px] text-ink-mute">
          Summe wird aus Menge × Preis berechnet
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => { setErr(null); if (alwaysOpen || isEdit) { onCancel?.(); } else { setOpen(false); } }}
            className="font-mono text-[11px] text-ink-2 px-2 py-1.5 hover:text-ink"
          >abbrechen</button>
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="btn-primary !min-h-[36px] !px-4 text-[12px] disabled:opacity-50"
          >{busy ? "speichere …" : "Position speichern"}</button>
        </div>
      </div>
    </div>
  );
}

/** Schmaler Icon-Streifen links im Detail-Drawer (Mockup-Variante 08 · 16.06.2026).
 *  Klick auf ein Icon WECHSELT den aktiven Tab — es wird nur der Inhalt
 *  der jeweiligen Sektion gezeigt (echtes Tab-Verhalten, nicht Scroll-Anker).
 *  Rick-Vorgabe 16.06.: „unter den Tabs nur die entsprechenden Informationen sehen". */
function DrawerSideNav({
  sections, activeId, onSelect,
}: {
  sections: { id: string; icon: string; label: string; show: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const visible = sections.filter((s) => s.show);
  return (
    <nav
      className="hidden md:flex flex-col bg-bg-deep border-r border-white/10 py-2 flex-shrink-0"
      style={{ width: 72 }}
      aria-label="Drawer-Sektionen"
    >
      {visible.map((s) => {
        const isActive = activeId === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            title={s.label}
            aria-label={s.label}
            aria-current={isActive ? "true" : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 py-3 text-[17px] transition-colors ${
              isActive ? "text-copper bg-copper/10" : "text-ink-mute hover:text-white hover:bg-white/4"
            }`}
            style={{ borderLeft: `3px solid ${isActive ? "#DC6E2D" : "transparent"}` }}
          >
            <span aria-hidden>{s.icon}</span>
            <span className="font-mono text-[9px] tracking-wider uppercase leading-none">{s.label}</span>
          </button>
        );
      })}
    </nav>
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
          {inquiry && card.stage !== "Anfrage" && (
            <span className="font-mono font-bold text-[9.5px] tracking-widest uppercase text-white bg-copper px-1.5 py-0.5 rounded">
              ANFRAGE
            </span>
          )}
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

// REVIEW_META + Position-Review-Buttons (✓ OK / 💬 / ? Unsicher) wurden
// am 16.06.2026 entfernt — Rick-Vorgabe: in der Angebote-Tabelle sollen
// Werte direkt editierbar sein (✎ / 🗑), kein Review-Workflow pro Zeile.
// Die Chef-Freigabe ("Alles freigeben") bleibt als separater Knopf.

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
  // Aktiver Tab im Side-Nav (Rick-Vorgabe 16.06.: nur Inhalt des aktiven
  // Tabs anzeigen, kein Long-Scroll mehr). Default „Übersicht".
  const [activeSec, setActiveSec] = useState<string>("sec-uebersicht");
  // Edit-Status für die Positions-Tabellen (Edit/Delete je Zeile). Index
  // bezieht sich nach Migration auf card.positions.
  const [editPosIdx, setEditPosIdx] = useState<number | null>(null);
  const [addKind, setAddKind] = useState<"arbeit" | "material" | null>(null);
  // Beim Wechsel der Card zurück auf Übersicht (sonst hängt z. B. Positionen-Tab
  // auf einer neuen Anfrage ohne Positionen leer).
  useEffect(() => { setActiveSec("sec-uebersicht"); setEditPosIdx(null); setAddKind(null); }, [card.id]);

  /** Hilfsfunktion: ggf. Inquiry-Positionen nach card.positions migrieren und
   *  zurückliefern (sodass anschließend Edit/Delete auf echten Indizes arbeitet). */
  async function ensureMigrated(): Promise<PipelinePosition[]> {
    if (card.positions && card.positions.length > 0) return card.positions;
    const split = splitInquiryPositions(inquiry);
    const merged = [...split.work, ...split.material].map((p, i) => ({ ...p, pos: i + 1 }));
    if (merged.length === 0) return [];
    const valueEur = +merged.reduce((t, p) => t + (p.sum || 0), 0).toFixed(2);
    await setCardPositions(card.id, merged, valueEur);
    onUpdate({ positions: merged, valueEur });
    return merged;
  }

  async function handleDeletePos(p: PipelinePosition) {
    if (!confirm(`Position „${p.name}" löschen?`)) return;
    const positions = await ensureMigrated();
    const next = positions
      .filter((pp) => !(pp.name === p.name && pp.quantity === p.quantity && (pp.source ?? "") === (p.source ?? "")))
      .map((pp, i) => ({ ...pp, pos: i + 1 }));
    const valueEur = +next.reduce((t, p) => t + (p.sum || 0), 0).toFixed(2);
    await setCardPositions(card.id, next, valueEur);
    onUpdate({ positions: next, valueEur });
  }

  async function handleEditPos(p: PipelinePosition) {
    const positions = await ensureMigrated();
    const idx = positions.findIndex(
      (pp) => pp.name === p.name && pp.quantity === p.quantity && (pp.source ?? "") === (p.source ?? "")
    );
    if (idx >= 0) setEditPosIdx(idx);
  }
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

      // WICHTIG: Kontaktdaten AUCH an den Vorgang (Anfrage) schreiben — die
      // ContactCard im Drawer zeigt sie von DORT, nicht aus dem Kundenstamm.
      // Ohne das blieb die Karte nach dem Abgleich fälschlich auf „nicht erfasst".
      if (contact && (contact.phone || contact.email || contact.street || contact.zip || contact.city)) {
        try {
          const updatedInq = await upsertCardContact(card.id, {
            customerPhone: contact.phone, customerEmail: contact.email,
            street: contact.street, zip: contact.zip, city: contact.city,
          }, card.customerName);
          setInquiry(updatedInq);
        } catch { /* Anzeige-Spiegelung ist nicht kritisch fürs Abgleich-Ergebnis */ }
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
  // Position-Namen der Karte — wird genutzt, um redundante Klärungen automatisch
  // herauszufiltern (Bullets, die exakt einen Positions-Namen wiederholen).
  // Rick-Vorgabe 16.06.2026: bei bereits angelegten Anfragen darf die Klärungs-
  // Liste nicht denselben Inhalt zeigen wie die Positionen darunter.
  const positionNamesLower = (card.positions ?? []).map((p) => p.name.trim().toLowerCase());
  const klärungen = (card.openPoints ? card.openPoints.split(" · ") : [])
    .filter((k) => !positionNamesLower.includes(k.trim().toLowerCase()))
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

        {/* Mockup-Variante 08 · schmale Icon-Nav links + Content rechts.
            Klick auf ein Icon scrollt smooth zur Sektion via Anchor-ID.
            Sektionen sind die existierenden Blöcke mit data-section markiert. */}
        <div className="flex-1 flex min-h-0">
          <DrawerSideNav
            sections={[
              { id: "sec-uebersicht", icon: "▤", label: "Vorgang",  show: true },
              { id: "sec-kontakt",    icon: "👤", label: "Kontakt",  show: true },
              { id: "sec-verlauf",    icon: "🕐", label: "Verlauf",  show: true },
            ]}
            activeId={activeSec}
            onSelect={setActiveSec}
          />
        <div data-drawer-scroll className="flex-1 overflow-y-auto px-5 lg:px-8 py-6 board-scroll">
          <div className="space-y-5">

            {/* Tab: Vorgang — Volumen + Klärungen + Description (nur wenn keine
                strukturierten Positionen) + Arbeit/Material-Tabellen + Adder.
                Rick-Vorgabe 16.06.: Übersicht und Positionen verschmolzen. */}
            {activeSec === "sec-uebersicht" && (() => {
              const { positions: shownPositions, work, material, fromInquiry } = effectivePositions(card, inquiry);
              const hasStructuredPositions = shownPositions.length > 0;
              return (
                <>
                  {/* 1) Volumen */}
                  <div className="flex items-center justify-between gap-3 px-4 py-4 rounded-lg surface-steel">
                    <span className="font-sans text-[13px] text-steel">
                      {fromInquiry
                        ? "Anfrage-Stand · noch nicht beziffert"
                        : card.actualEur != null
                          ? "Plan · Ist"
                          : "Volumen netto · 0 % USt (§19)"}
                    </span>
                    {fromInquiry ? (
                      <span className="font-display font-black text-[20px] text-white tabular-nums">—</span>
                    ) : card.actualEur != null ? (
                      <span className="font-display font-black text-[20px] text-white tabular-nums">
                        {eur(card.planEur)} · {eur(card.actualEur)}
                      </span>
                    ) : (
                      <span className="font-display font-black text-[24px] text-white tabular-nums">
                        {value != null ? eur(value) : "noch offen"}
                      </span>
                    )}
                  </div>

                  {/* 2) Klärungen — bei Anfragen (fromInquiry) ausgeblendet, weil
                      dort die Gewerks-Tags identisch zur Positionen-Sektion unten
                      sind (Rick-Vorgabe 16.06.2026: keine Dopplung). Bei sevDesk-
                      Karten mit echten manuellen Klärungen bleibt der Block. */}
                  {klärungen.length > 0 && !fromInquiry && (
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

                  {/* 3) Beschreibung — die LLM-Zusammenfassung des Anliegens. IMMER
                      zeigen wenn vorhanden, auch wenn unten strukturierte Positionen
                      stehen: die Prosa enthält oft Wünsche/Termine/Kontext, der nicht
                      in der Positions-Liste landet (Rick-Vorgabe 16.06.: keine Daten
                      verloren gehen lassen). */}
                  {card.description && !descIsJustDocNumber(card.description) && (
                    <div>
                      <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5">
                        Anliegen · Kurzfassung
                      </div>
                      <p className="font-sans text-[14.5px] text-ink-body leading-relaxed">{card.description}</p>
                    </div>
                  )}

                  {/* 4) Positionen — bei Anfragen mit klarer Arbeit/Material-Trennung,
                      bei sevDesk-Belegen als einheitliche Tabelle. */}
                  {fromInquiry ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink">
                          Erkannt aus Anfrage
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-bronze bg-[#FBF3E9] border border-[#E0C49C] px-2 py-0.5 rounded">
                          noch nicht beziffert
                        </span>
                      </div>

                      {/* Arbeit */}
                      <div>
                        <div className="font-display font-extrabold uppercase text-[11px] tracking-widest text-copper mb-1.5 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-copper" />
                          Arbeit · {work.length} {work.length === 1 ? "Gewerk" : "Gewerke"}
                        </div>
                        {work.length === 0 ? (
                          <div className="text-[12px] text-ink-mute font-mono px-2 py-3 italic">kein Gewerk erkannt</div>
                        ) : (
                          <div className="border border-steel rounded-lg overflow-hidden bg-white">
                            <table className="w-full border-collapse text-[13.5px]">
                              <thead>
                                <tr className="bg-bg-deep text-bg-2">
                                  <th className="w-8 text-center font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2">#</th>
                                  <th className="text-left font-mono font-medium text-[10.5px] uppercase tracking-wide px-3 py-2">Gewerk</th>
                                  <th className="text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2">Mengen</th>
                                  {!released && !reviewerOnly && (
                                    <th className="w-[88px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2"></th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {work.map((p) => {
                                  // Index in card.positions für Edit/Delete (kann -1 sein, wenn noch virtuell)
                                  const posIdx = (card.positions ?? []).findIndex(
                                    (pp) => pp.name === p.name && pp.quantity === p.quantity && (pp.source ?? "") === (p.source ?? "")
                                  );
                                  if (editPosIdx !== null && posIdx === editPosIdx) {
                                    // Inline-Edit-Form anstelle der Zeile
                                    return (
                                      <tr key={`edit-${p.pos}`} className="bg-[#FFF8F0]">
                                        <td colSpan={!released && !reviewerOnly ? 4 : 3} className="px-2 py-2">
                                          <PositionAdder
                                            card={card}
                                            inquiry={inquiry}
                                            alwaysOpen
                                            initial={{ index: posIdx, name: p.name, quantity: p.quantity, unitPrice: p.unitPrice ?? "", kind: "arbeit" }}
                                            onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setEditPosIdx(null); }}
                                            onCancel={() => setEditPosIdx(null)}
                                          />
                                          <div className="text-right mt-1">
                                            <button onClick={() => setEditPosIdx(null)} className="font-mono text-[11px] text-ink-mute hover:text-ink-2 underline">abbrechen</button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={p.pos} className="border-b border-[#E2E4E7] last:border-0 even:bg-[#F6F7F8]">
                                      <td className="text-center font-mono text-ink-2 text-[12px] px-2 py-2 align-top">{p.pos}</td>
                                      <td className="text-ink text-[13.5px] leading-snug px-3 py-2 align-top break-words">{p.name}</td>
                                      <td className="text-right font-mono text-[12px] text-ink-2 px-2 py-2 align-top whitespace-nowrap">{p.quantity}</td>
                                      {!released && !reviewerOnly && (
                                        <td className="text-right whitespace-nowrap px-2 py-2 align-top">
                                          <button
                                            onClick={() => handleEditPos(p)}
                                            title="Position bearbeiten"
                                            className="text-ink-mute hover:text-copper px-1.5 py-1 rounded transition-colors"
                                          >✎</button>
                                          <button
                                            onClick={() => handleDeletePos(p)}
                                            title="Position löschen"
                                            className="text-ink-mute hover:text-rust px-1.5 py-1 rounded transition-colors"
                                          >🗑</button>
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Material */}
                      <div>
                        <div className="font-display font-extrabold uppercase text-[11px] tracking-widest text-[#3A8CE8] mb-1.5 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#3A8CE8" }} />
                          Material · {material.length} {material.length === 1 ? "Position" : "Positionen"}
                        </div>
                        {material.length === 0 ? (
                          <div className="text-[12px] text-ink-mute font-mono px-2 py-3 italic">kein Material in der Anfrage erkannt</div>
                        ) : (
                          <div className="border border-steel rounded-lg overflow-hidden bg-white">
                            <table className="w-full border-collapse text-[13.5px]">
                              <thead>
                                <tr className="bg-bg-deep text-bg-2">
                                  <th className="w-8 text-center font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2">#</th>
                                  <th className="text-left font-mono font-medium text-[10.5px] uppercase tracking-wide px-3 py-2">Material</th>
                                  <th className="text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2">Menge</th>
                                  {!released && !reviewerOnly && (
                                    <th className="w-[88px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2"></th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {material.map((p) => {
                                  const gewerkRef = (p.source ?? "").startsWith("anfrage-material:")
                                    ? `Gewerk ${(p.source ?? "").split(":")[1]}` : null;
                                  const posIdx = (card.positions ?? []).findIndex(
                                    (pp) => pp.name === p.name && pp.quantity === p.quantity && (pp.source ?? "") === (p.source ?? "")
                                  );
                                  if (editPosIdx !== null && posIdx === editPosIdx) {
                                    return (
                                      <tr key={`edit-${p.source}-${p.pos}`} className="bg-[#F0F6FF]">
                                        <td colSpan={!released && !reviewerOnly ? 4 : 3} className="px-2 py-2">
                                          <PositionAdder
                                            card={card}
                                            inquiry={inquiry}
                                            alwaysOpen
                                            initial={{ index: posIdx, name: p.name, quantity: p.quantity, unitPrice: p.unitPrice ?? "", kind: "material" }}
                                            onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setEditPosIdx(null); }}
                                            onCancel={() => setEditPosIdx(null)}
                                          />
                                          <div className="text-right mt-1">
                                            <button onClick={() => setEditPosIdx(null)} className="font-mono text-[11px] text-ink-mute hover:text-ink-2 underline">abbrechen</button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={`${p.source}-${p.pos}`} className="border-b border-[#E2E4E7] last:border-0 even:bg-[#F6F7F8]">
                                      <td className="text-center font-mono text-ink-2 text-[12px] px-2 py-2 align-top">{p.pos}</td>
                                      <td className="text-ink text-[13.5px] leading-snug px-3 py-2 align-top">
                                        <div className="break-words">{p.name}</div>
                                        {(gewerkRef || p.review?.comment) && (
                                          <div className="mt-0.5 font-mono text-[10px] text-ink-mute">
                                            {gewerkRef && <span>↳ {gewerkRef}</span>}
                                            {p.review?.comment && <span className="ml-2 italic">„{p.review.comment}"</span>}
                                          </div>
                                        )}
                                      </td>
                                      <td className="text-right font-mono text-[12px] text-ink-2 px-2 py-2 align-top whitespace-nowrap">{p.quantity}</td>
                                      {!released && !reviewerOnly && (
                                        <td className="text-right whitespace-nowrap px-2 py-2 align-top">
                                          <button
                                            onClick={() => handleEditPos(p)}
                                            title="Position bearbeiten"
                                            className="text-ink-mute hover:text-[#3A8CE8] px-1.5 py-1 rounded transition-colors"
                                          >✎</button>
                                          <button
                                            onClick={() => handleDeletePos(p)}
                                            title="Position löschen"
                                            className="text-ink-mute hover:text-rust px-1.5 py-1 rounded transition-colors"
                                          >🗑</button>
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {!released && !reviewerOnly && (
                        addKind ? (
                          <PositionAdder
                            card={card}
                            inquiry={inquiry}
                            defaultKind={addKind}
                            alwaysOpen
                            onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setAddKind(null); }}
                            onCancel={() => setAddKind(null)}
                          />
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setAddKind("arbeit")}
                              className="border-2 border-dashed border-copper/45 hover:border-copper text-copper font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                            >＋ Arbeit-Position</button>
                            <button
                              onClick={() => setAddKind("material")}
                              className="border-2 border-dashed border-[#3A8CE8]/45 hover:border-[#3A8CE8] text-[#3A8CE8] font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                            >＋ Material-Position</button>
                          </div>
                        )
                      )}
                    </>
                  ) : hasStructuredPositions ? (
                    /* sevDesk-Beleg-Positionen — wird weiter unten im alten Block gerendert
                       (Tabelle mit Review-Buttons + Net-Summe + Chef-Freigabe). */
                    null
                  ) : (
                    /* Keine Positionen, keine Anfrage-Leistungen → Add-Block */
                    <div className="border border-dashed border-steel rounded-lg px-5 py-6 bg-white/60">
                      <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2">
                        Noch keine Positionen
                      </div>
                      <p className="font-sans text-[13px] text-ink-2 leading-relaxed mb-3">
                        {card.docNumber
                          ? `Positionen zu ${card.docNumber} werden aus sevDesk gespiegelt, sobald der Abgleich gelaufen ist — oder du fügst sie hier direkt hinzu.`
                          : "Sammle hier schon Positionen, bevor das Angebot erstellt wird (Material, Stunden, Pauschalen)."}
                      </p>
                      {!reviewerOnly && (
                        addKind ? (
                          <PositionAdder
                            card={card}
                            inquiry={inquiry}
                            defaultKind={addKind}
                            alwaysOpen
                            onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setAddKind(null); }}
                            onCancel={() => setAddKind(null)}
                          />
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setAddKind("arbeit")}
                              className="border-2 border-dashed border-copper/45 hover:border-copper text-copper font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                            >＋ Arbeit-Position</button>
                            <button
                              onClick={() => setAddKind("material")}
                              className="border-2 border-dashed border-[#3A8CE8]/45 hover:border-[#3A8CE8] text-[#3A8CE8] font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                            >＋ Material-Position</button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Tab: Kontakt */}
            {activeSec === "sec-kontakt" && (
              <ContactCard card={card} inquiry={inquiry} onInquiryUpdate={setInquiry} />
            )}

            {/* Tab: Verlauf */}
            {activeSec === "sec-verlauf" && (
              <InquiryHistory
                card={card}
                inquiry={inquiry}
                siteId={card.siteId}
                onInquiryUpdate={setInquiry}
              />
            )}

            {/* sevDesk-Belegtabelle — wird im Übersicht-Tab gerendert, wenn die
                Karte echte sevDesk-Positionen hat (kein fromInquiry-Pfad).
                Der frühere separate „Positionen"-Tab ist 16.06.2026 mit der
                Übersicht verschmolzen worden. */}
            {activeSec === "sec-uebersicht" && (() => {
              const { positions: shownPositions, fromInquiry } = effectivePositions(card, inquiry);
              // Nur den sevDesk-Pfad rendern; den Anfrage-Fall hat der erste Block oben
              if (fromInquiry || shownPositions.length === 0) return null;
              return (
                <>
                  <div className="font-display font-extrabold uppercase text-[13px] tracking-widest text-ink mb-2.5 flex items-center justify-between gap-2">
                    <span>
                      {card.docNumber?.startsWith("RE")
                        ? "Schlussrechnung · Positionen"
                        : "Angebot · Positionen"}
                    </span>
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
                          {!released && !reviewerOnly && (
                            <th className="w-[88px] text-right font-mono font-medium text-[10.5px] uppercase tracking-wide px-2 py-2.5"></th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {shownPositions.map((p) => {
                          // Index in card.positions zur Identifikation für Edit/Delete
                          const posIdx = (card.positions ?? []).findIndex(
                            (pp) => pp.name === p.name && pp.quantity === p.quantity && (pp.source ?? "") === (p.source ?? "")
                          );
                          if (editPosIdx !== null && posIdx === editPosIdx) {
                            // Inline-Edit-Form anstelle der Zeile (sevDesk-Belegtabelle).
                            // kind auf "arbeit" als Default — der Toggle ist im Edit-Modus
                            // sowieso disabled, weil die Position bereits klassifiziert ist.
                            const editKind: "arbeit" | "material" = isMaterialPosition(p) ? "material" : "arbeit";
                            return (
                              <tr key={`edit-${p.pos}`} className="bg-[#FFF8F0]">
                                <td colSpan={!released && !reviewerOnly ? 6 : 5} className="px-2 py-2">
                                  <PositionAdder
                                    card={card}
                                    inquiry={inquiry}
                                    alwaysOpen
                                    initial={{ index: posIdx, name: p.name, quantity: p.quantity, unitPrice: p.unitPrice ?? "", kind: editKind }}
                                    onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setEditPosIdx(null); }}
                                    onCancel={() => setEditPosIdx(null)}
                                  />
                                </td>
                              </tr>
                            );
                          }
                          return (
                          <tr key={p.pos} className="border-b border-[#E2E4E7] last:border-0 even:bg-[#F6F7F8]">
                            <td className="text-center font-mono text-ink-2 text-[12px] px-2 py-2.5 align-top">{p.pos}</td>
                            <td className="text-ink text-[13.5px] leading-snug px-3 py-2.5 align-top break-words">{p.name}</td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.quantity}</td>
                            <td className="text-right font-mono text-[12.5px] text-ink-2 px-2 py-2.5 align-top whitespace-nowrap">{p.unitPrice}</td>
                            <td className="text-right font-mono font-bold text-[12.5px] text-ink px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{eur(p.sum)}</td>
                            {!released && !reviewerOnly && (
                              <td className="text-right whitespace-nowrap px-2 py-2.5 align-top">
                                <button
                                  onClick={() => handleEditPos(p)}
                                  title="Position bearbeiten"
                                  className="text-ink-mute hover:text-copper px-1.5 py-1 rounded transition-colors"
                                >✎</button>
                                <button
                                  onClick={() => handleDeletePos(p)}
                                  title="Position löschen"
                                  className="text-ink-mute hover:text-rust px-1.5 py-1 rounded transition-colors"
                                >🗑</button>
                              </td>
                            )}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 px-4 py-4 rounded-lg surface-steel">
                    <span className="font-sans text-[13px] text-steel">
                      {fromInquiry ? "Anfrage-Stand · noch nicht beziffert" : "Netto-Gesamt · 0 % USt (§19)"}
                    </span>
                    <span className="font-display font-black text-[22px] text-white tabular-nums">
                      {fromInquiry ? "—" : eur(shownPositions.reduce((t, p) => t + (p.sum || 0), 0))}
                    </span>
                  </div>

                  {!released && !reviewerOnly && (
                    addKind ? (
                      <PositionAdder
                        card={card}
                        inquiry={inquiry}
                        defaultKind={addKind}
                        alwaysOpen
                        onSaved={(positions, valueEur) => { onUpdate({ positions, valueEur }); setAddKind(null); }}
                        onCancel={() => setAddKind(null)}
                      />
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setAddKind("arbeit")}
                          className="border-2 border-dashed border-copper/45 hover:border-copper text-copper font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                        >＋ Arbeit-Position</button>
                        <button
                          onClick={() => setAddKind("material")}
                          className="border-2 border-dashed border-[#3A8CE8]/45 hover:border-[#3A8CE8] text-[#3A8CE8] font-display font-extrabold uppercase tracking-wider text-[12px] py-3 rounded-lg transition-colors"
                        >＋ Material-Position</button>
                      </div>
                    )
                  )}

                  {/* Chef-Freigabe */}
                  <div id="sec-freigabe" data-section style={{ scrollMarginTop: 16 }} className="mt-5">
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
              );
            })()}
          </div>
        </div>
        </div>{/* /flex-1 flex min-h-0 (Side-Nav-Wrapper) — Bugfix 16.06.2026:
                  sevDesk-Sync/Link-Banner waren bisher INNERHALB dieses
                  Flex-Containers → align-items:stretch hat sie vertikal auf
                  volle Drawer-Höhe gezogen (riesige leere weiße Fläche bei
                  bereits angelegten Anfragen). Jetzt korrekt unterhalb. */}

        {canSync && (
          <div className="flex-shrink-0 px-5 lg:px-6 pt-2.5 pb-2.5 bg-[#E2E4E7] border-t border-steel">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={doSync}
                disabled={syncBusy}
                className="btn-ghost !min-h-[40px] !px-4 text-[12px] !text-copper !border-copper/50 inline-flex items-center gap-2 disabled:opacity-50"
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
          <div className="flex-shrink-0 px-5 lg:px-6 pt-2.5 pb-2.5 bg-[#E2E4E7] border-t border-steel">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={doFindOrders}
                disabled={linkBusy}
                className="btn-ghost !min-h-[40px] !px-4 text-[12px] !text-copper !border-copper/50 inline-flex items-center gap-2 disabled:opacity-50"
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
function ContactCard({ card, inquiry, onInquiryUpdate }: { card: PipelineCard; inquiry: Inquiry | null; onInquiryUpdate?: (i: Inquiry) => void }) {
  const name = inquiry?.customerName || card.customerName || "—";
  const phone = inquiry?.customerPhone;
  const mobile = inquiry?.parsedJson?.phone_mobile as string | undefined;
  const email = inquiry?.customerEmail;
  const street = inquiry?.street;
  const zip = inquiry?.zip;
  const city = inquiry?.city || card.place;
  const ort = [zip, city].filter(Boolean).join(" ") || undefined;
  const anliegen = inquiry?.description || card.description;
  const sub = [card.docNumber, ort].filter(Boolean).join(" · ");

  // Manuelle Kontaktdaten-Ergänzung (Rick 16.06.: fehlende Daten direkt hier ausfüllen)
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ phone: "", email: "", street: "", zip: "", city: "" });
  function startEdit() {
    setForm({
      phone: phone ?? "", email: email ?? "", street: street ?? "",
      zip: zip ?? "", city: city ?? "",
    });
    setErr(null); setEditing(true);
  }
  async function saveContact() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const updated = await upsertCardContact(card.id, {
        customerPhone: form.phone, customerEmail: form.email,
        street: form.street, zip: form.zip, city: form.city,
      }, card.customerName);
      onInquiryUpdate?.(updated);
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen");
    } finally { setBusy(false); }
  }
  const fieldStyle = "w-full rounded-md px-2.5 py-1.5 text-[12.5px] font-mono";
  const fieldCss = { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.18)", color: "#F0F2F4" } as const;

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
          {/* Status nur lesbar + nur wenn aussagekräftig (interne „wurde_zu_angebot"
              = Verlaufs-Träger ausblenden). Priorität nur wenn ≠ normal. */}
          {inquiry?.status && inquiry.status !== "wurde_zu_angebot" && (
            <CcBadge style={statusStyle(inquiry.status)}>
              {inquiry.status === "in_arbeit" ? "In Arbeit"
                : inquiry.status === "offen" ? "Offen"
                : inquiry.status === "verworfen" ? "Verworfen"
                : inquiry.status}
            </CcBadge>
          )}
          {inquiry?.priority && inquiry.priority !== "normal" && (
            <CcBadge style={prioStyle(inquiry.priority)}>
              {inquiry.priority === "hoch" ? "Priorität hoch"
                : inquiry.priority === "niedrig" ? "Priorität niedrig"
                : inquiry.priority}
            </CcBadge>
          )}
          {!editing && (
            <button onClick={startEdit} title="Kontaktdaten bearbeiten"
              className="mt-0.5 font-mono text-[10px] tracking-wider uppercase px-2 py-1 rounded-md"
              style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.2)", color: "#E8853F" }}>
              ✎ Bearbeiten
            </button>
          )}
        </div>
      </div>

      {/* Body: Feld-Zeilen */}
      <div className="px-4 py-1.5 [&>*:last-child]:border-b-0">
        {editing ? (
          <div className="py-2 space-y-2">
            {[
              { k: "phone", label: "Telefon", ph: "z.B. 0176 …" },
              { k: "email", label: "E-Mail", ph: "name@domain.de" },
              { k: "street", label: "Straße", ph: "Straße + Nr." },
              { k: "zip", label: "PLZ", ph: "26826" },
              { k: "city", label: "Ort", ph: "Weener" },
            ].map((f) => (
              <div key={f.k} className="flex items-center gap-2">
                <span className="text-[11px] font-mono tracking-wide w-16 flex-shrink-0" style={{ color: "rgba(255,255,255,.4)" }}>{f.label}</span>
                <input
                  value={(form as any)[f.k]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))}
                  placeholder={f.ph}
                  className={fieldStyle}
                  style={fieldCss}
                />
              </div>
            ))}
            {err && <p className="text-[12px]" style={{ color: "#F87171" }}>{err}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setEditing(false)} disabled={busy}
                className="font-mono text-[11px] tracking-wider uppercase px-3 py-1.5 rounded-md"
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,.2)", color: "rgba(255,255,255,.6)" }}>
                Abbrechen
              </button>
              <button onClick={saveContact} disabled={busy}
                className="font-mono text-[11px] tracking-wider uppercase px-4 py-1.5 rounded-md"
                style={{ background: "#DC6E2D", color: "#fff", opacity: busy ? 0.5 : 1 }}>
                {busy ? "speichert …" : "Speichern"}
              </button>
            </div>
          </div>
        ) : (<>
        {(phone || mobile) ? (
          <>
            {phone && (
              <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Festnetz</span>
                <a href={`tel:${phone.replace(/\s/g, "")}`} className="font-mono text-[12px] font-bold no-underline" style={{ color: "#4ADE80" }}>{phone}</a>
              </div>
            )}
            {mobile && (
              <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Mobil</span>
                <a href={`tel:${mobile.replace(/\s/g, "")}`} className="font-mono text-[12px] font-bold no-underline" style={{ color: "#4ADE80" }}>{mobile}</a>
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Telefon</span>
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,.3)" }}>nicht erfasst</span>
          </div>
        )}
        {email && (
          <div className="flex justify-between items-center gap-3 py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <span className="text-[11px] font-mono tracking-wide flex-shrink-0" style={{ color: "rgba(255,255,255,.4)" }}>E-Mail</span>
            <a href={`mailto:${email}`} className="text-[12px] no-underline truncate" style={{ color: "#E8853F" }}>{email}</a>
          </div>
        )}
        {street && (
          <div className="flex justify-between items-center gap-3 py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <span className="text-[11px] font-mono tracking-wide flex-shrink-0" style={{ color: "rgba(255,255,255,.4)" }}>Straße</span>
            <span className="text-[12px] font-medium truncate" style={{ color: "rgba(255,255,255,.85)" }}>{street}</span>
          </div>
        )}
        <div className="flex justify-between items-center py-[7px] text-[12.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
          <span className="text-[11px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,.4)" }}>Ort</span>
          {ort
            ? <span className="font-medium" style={{ color: "rgba(255,255,255,.85)" }}>{ort}</span>
            : <span className="text-[12px]" style={{ color: "rgba(255,255,255,.3)" }}>nicht erfasst</span>}
        </div>
        </>)}
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

/** Foto-Galerie für WhatsApp-Fotos — mit nachträglichem Upload.
 *  Wenn siteId angegeben ist, wird jedes Foto ZUSÄTZLICH als Site-direkt-Foto
 *  in entry_photos abgelegt, damit es in der Baustellenkarte unter "Fotos" erscheint. */
// ── ZIP-Import-Status ─────────────────────────────────────────────────────────
interface ZipProgress {
  phase: 'extracting' | 'uploading' | 'done' | 'error';
  message: string;
  current: number;
  total: number;
}

function InquiryPhotoGallery({
  inquiry,
  siteId,
  onPhotosUpdated,
}: {
  inquiry: Inquiry;
  siteId?: string;
  onPhotosUpdated?: (photos: InquiryPhoto[]) => void;
}) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [lightbox, setLightbox] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);
  const [pendingDel, setPendingDel] = useState<number | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Einzelnes Medium komplett entfernen (aus der Liste + Storage-Datei).
  async function deletePhoto(i: number) {
    const photo = inquiry.photos?.[i];
    if (!photo) return;
    setDelBusy(true);
    try {
      const remaining = (inquiry.photos ?? []).filter((_, idx) => idx !== i);
      await updateInquiryPhotos(inquiry.id, remaining);
      onPhotosUpdated?.(remaining);
      deleteInquiryPhotoFile(photo.path);  // Storage best effort
      setPendingDel(null);
    } finally { setDelBusy(false); }
  }

  useEffect(() => {
    if (!inquiry.photos?.length) { setUrls([]); return; }
    Promise.all(inquiry.photos.map((p) => inquiryPhotoUrl(p.path))).then(setUrls);
  }, [inquiry.id, inquiry.photos?.length]);

  // ── Einzelne Bilder / Videos hochladen ────────────────────────────────────
  async function uploadMediaFiles(images: File[], videos: File[], chatRawText?: string) {
    const newPhotos: InquiryPhoto[] = [];
    const total = images.length + videos.length;
    let done = 0;

    const tick = (name: string) => {
      done++;
      setZipProgress((p) => p ? { ...p, current: done, message: `${name} hochgeladen …` } : null);
    };

    // Bilder
    for (const f of images) {
      const photo = await uploadInquiryPhoto(f, inquiry.id);
      newPhotos.push({ ...photo, type: 'image' });
      tick(f.name);
    }

    // Videos
    for (const f of videos) {
      const photo = await uploadInquiryVideo(f, inquiry.id);
      newPhotos.push(photo);
      tick(f.name);
    }

    const merged = [...(inquiry.photos ?? []), ...newPhotos];
    await updateInquiryPhotos(inquiry.id, merged);

    // WhatsApp-Chat-Text in rawText speichern
    if (chatRawText) {
      await updateInquiry(inquiry.id, { rawText: chatRawText });
    }

    onPhotosUpdated?.(merged);

    // Wenn Baustelle verknüpft: Bilder parallel als Site-Foto ablegen
    if (siteId && images.length > 0) {
      const me = currentUser();
      const companyId = me?.companyId ?? await getCurrentCompanyId();
      if (me && companyId) {
        await Promise.allSettled(
          images.map((f) => uploadSitePhoto({ file: f, siteId, workerId: me.id, companyId }))
        );
      }
    }

    return { images: images.length, videos: videos.length, total };
  }

  // ── ZIP-Datei verarbeiten ─────────────────────────────────────────────────
  async function handleZip(file: File) {
    setZipProgress({ phase: 'extracting', message: 'ZIP wird entpackt …', current: 0, total: 0 });
    try {
      const result = await extractZipMedia(file);

      const total = result.images.length + result.videos.length;
      if (total === 0) {
        setZipProgress({ phase: 'error', message: 'Keine Bilder oder Videos im ZIP gefunden.', current: 0, total: 0 });
        setTimeout(() => setZipProgress(null), 4000);
        return;
      }

      const label = [
        result.images.length > 0 ? `${result.images.length} Bild${result.images.length !== 1 ? "er" : ""}` : null,
        result.videos.length > 0 ? `${result.videos.length} Video${result.videos.length !== 1 ? "s" : ""}` : null,
        result.whatsApp ? "· WhatsApp-Export erkannt" : null,
      ].filter(Boolean).join(" ");

      setZipProgress({ phase: 'uploading', message: `${label} werden hochgeladen …`, current: 0, total });

      // WhatsApp-Chat-Text aufbereiten
      let chatRawText: string | undefined;
      if (result.chatText) {
        const meta = parseWhatsAppText(result.chatText);
        chatRawText = whatsAppSummary(meta, result.chatText);
      }

      await uploadMediaFiles(result.images, result.videos, chatRawText);

      const doneLabel = [
        result.images.length > 0 ? `${result.images.length} Bild${result.images.length !== 1 ? "er" : ""}` : null,
        result.videos.length > 0 ? `${result.videos.length} Video${result.videos.length !== 1 ? "s" : ""}` : null,
        result.whatsApp ? "· Chat gespeichert" : null,
        result.stats.skipped > 0 ? `· ${result.stats.skipped} übersprungen` : null,
      ].filter(Boolean).join(" ");

      setZipProgress({ phase: 'done', message: `✓ ${doneLabel}`, current: total, total });
      setTimeout(() => setZipProgress(null), 3500);
    } catch (e: any) {
      setZipProgress({ phase: 'error', message: e?.message ?? "ZIP-Import fehlgeschlagen", current: 0, total: 0 });
      setTimeout(() => setZipProgress(null), 5000);
    }
  }

  // ── Datei-Drop / Auswahl ──────────────────────────────────────────────────
  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const zips = list.filter((f) => f.name.toLowerCase().endsWith(".zip") || f.type === "application/zip" || f.type === "application/x-zip-compressed");
    const images = list.filter((f) => f.type.startsWith("image/"));
    const videos = list.filter((f) => f.type.startsWith("video/"));

    if (zips.length > 0) {
      // ZIP hat Vorrang (eins nach dem anderen verarbeiten)
      for (const zip of zips) await handleZip(zip);
      return;
    }

    if (images.length === 0 && videos.length === 0) return;

    setUploading(true); setUploadErr(null);
    try {
      await uploadMediaFiles(images, videos);
    } catch (e: any) {
      setUploadErr(e?.message ?? "Upload fehlgeschlagen");
    } finally { setUploading(false); }
  }

  const mediaCount = inquiry.photos?.length ?? 0;
  const hasMedia = mediaCount > 0;
  const imgCount = inquiry.photos?.filter((p) => !p.type || p.type === "image").length ?? 0;
  const vidCount = inquiry.photos?.filter((p) => p.type === "video").length ?? 0;

  return (
    <div className="border border-steel rounded-lg bg-white px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="dd-eyebrow text-ink-mute">
          📷 Medien
          {hasMedia && (
            <span className="ml-1.5 font-mono text-[10px] text-ink-mute normal-case tracking-normal">
              {imgCount > 0 ? `${imgCount} Bild${imgCount !== 1 ? "er" : ""}` : ""}
              {imgCount > 0 && vidCount > 0 ? " · " : ""}
              {vidCount > 0 ? `${vidCount} Video${vidCount !== 1 ? "s" : ""}` : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !!zipProgress}
          className="font-mono text-[10.5px] uppercase tracking-wider bg-bg-2 hover:bg-steel-line border border-steel-line/40 text-ink-2 px-2.5 py-1 rounded transition-colors disabled:opacity-50"
        >
          {uploading ? "lädt …" : "+ Medien / ZIP"}
        </button>
      </div>

      {/* ZIP-Fortschritt */}
      {zipProgress && (
        <div className={`rounded-lg px-3 py-2.5 text-[12px] font-sans flex items-center gap-2.5 ${
          zipProgress.phase === 'error' ? "bg-rust/8 border border-rust/30 text-rust" :
          zipProgress.phase === 'done' ? "bg-moss/8 border border-moss/30 text-good" :
          "bg-copper/8 border border-copper/30 text-copper"
        }`}>
          {zipProgress.phase === 'extracting' && <span className="animate-spin text-[14px]">⟳</span>}
          {zipProgress.phase === 'uploading' && (
            <span className="font-mono text-[10px] shrink-0">
              {zipProgress.current}/{zipProgress.total}
            </span>
          )}
          {zipProgress.phase === 'done' && <span>✓</span>}
          {zipProgress.phase === 'error' && <span>⚠</span>}
          <span>{zipProgress.message}</span>
          {zipProgress.phase === 'uploading' && zipProgress.total > 0 && (
            <div className="flex-1 h-1 bg-copper/20 rounded-full overflow-hidden ml-1">
              <div
                className="h-full bg-copper rounded-full transition-all duration-300"
                style={{ width: `${Math.round(zipProgress.current / zipProgress.total * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Drop-Zone + Thumbnails */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-lg border-2 border-dashed transition-colors ${
          dragOver ? "border-copper bg-copper/5" : hasMedia ? "border-transparent" : "border-steel-line/40 bg-bg-2/50"
        } ${!hasMedia ? "flex items-center justify-center py-8" : "p-1"}`}
      >
        {hasMedia ? (
          <div className="flex flex-wrap gap-2 p-1">
            {inquiry.photos.map((photo, i) => {
              const url = urls[i];
              const isVideo = photo.type === "video";
              return url ? (
                <div key={i} className="group relative w-24 h-24">
                  <button type="button"
                    onClick={() => setLightbox({ url, type: isVideo ? "video" : "image" })}
                    className="relative overflow-hidden rounded-md border border-steel-line/20 focus:outline-none focus:ring-2 focus:ring-copper w-full h-full block">
                    {isVideo ? (
                      <>
                        <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/20 transition-colors">
                          <span className="text-white text-2xl drop-shadow-lg">▶</span>
                        </div>
                      </>
                    ) : (
                      <img src={url} alt={photo.name} className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" loading="lazy" />
                    )}
                    {photo.at && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white font-mono text-[8px] px-1 py-0.5 text-center">
                        {photo.at.slice(5, 10)}
                      </div>
                    )}
                  </button>
                  {/* Löschen — × immer sichtbar (auch mobil), kurze Bestätigung */}
                  {pendingDel === i ? (
                    <div className="absolute inset-0 bg-black/75 rounded-md flex flex-col items-center justify-center gap-1.5 z-10">
                      <span className="text-white font-mono text-[10px]">Löschen?</span>
                      <div className="flex gap-1.5">
                        <button type="button" disabled={delBusy}
                          onClick={(e) => { e.stopPropagation(); deletePhoto(i); }}
                          className="font-mono text-[10px] px-2.5 py-1 rounded bg-rust text-white disabled:opacity-50">{delBusy ? "…" : "Ja"}</button>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setPendingDel(null); }}
                          className="font-mono text-[10px] px-2.5 py-1 rounded bg-white/20 text-white">Nein</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" title="Bild löschen"
                      onClick={(e) => { e.stopPropagation(); setPendingDel(i); }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rust text-white text-[12px] leading-none flex items-center justify-center shadow-md opacity-80 hover:opacity-100 transition-opacity z-10">×</button>
                  )}
                </div>
              ) : (
                <div key={i} className="w-24 h-24 rounded-md border border-steel-line/20 bg-bg-2 animate-pulse" />
              );
            })}
            {(uploading) && (
              <div className="w-24 h-24 rounded-md border border-dashed border-copper/40 bg-copper/5 grid place-items-center">
                <span className="font-mono text-[10px] text-copper animate-pulse">lädt…</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center px-4">
            <div className="text-2xl mb-2">📁</div>
            <div className="font-sans text-[13px] text-ink-mute font-medium">
              Bilder, Videos oder ZIP hier ablegen
            </div>
            <div className="font-mono text-[10.5px] text-ink-mute mt-0.5">
              WhatsApp-Export · Foto-Ordner · einzelne Dateien
            </div>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="mt-2.5 font-mono text-[11px] text-copper underline underline-offset-2">
              Datei auswählen
            </button>
          </div>
        )}
      </div>

      {uploadErr && (
        <div className="font-sans text-[12px] text-rust bg-rust/8 rounded px-3 py-2">{uploadErr}</div>
      )}

      <input ref={inputRef} type="file"
        accept="image/*,video/*,.zip,application/zip,application/x-zip-compressed"
        multiple className="hidden"
        onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}>
          {lightbox.type === "video" ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img src={lightbox.url} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()} />
          )}
          <button onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 text-white rounded-full grid place-items-center hover:bg-white/25 text-lg">✕</button>
        </div>
      )}
    </div>
  );
}

/** Verlaufs-Timeline + Original-Rohtext einer Anfrage (unter der ContactCard). */
function InquiryHistory({
  card,
  inquiry,
  siteId,
  onInquiryUpdate,
}: {
  card: PipelineCard;
  inquiry: Inquiry | null;
  siteId?: string;
  onInquiryUpdate?: (updated: Inquiry) => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);

  async function addNote() {
    const text = noteText.trim();
    if (!text || noteBusy) return;
    setNoteBusy(true); setNoteErr(null);
    try {
      const me = currentUser();
      const by = me ? `${me.firstName} ${me.lastName.charAt(0)}.` : undefined;
      const updated = await appendCardNote(card.id, text, by, card.customerName);
      onInquiryUpdate?.(updated);
      setNoteText("");
    } catch (e: any) {
      setNoteErr(e?.message ?? "Notiz konnte nicht gespeichert werden");
    } finally {
      setNoteBusy(false);
    }
  }

  const log = inquiry ? [...inquiry.notesLog].sort((a, b) => a.at.localeCompare(b.at)) : [];
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

      {/* Notiz/Info an den Vorgang hängen — funktioniert auch ohne Anfrage dahinter
          (z.B. direkt angelegte Aufträge). Beispiel: nachgereichter Material-Link. */}
      <div className="border border-steel rounded-lg bg-white px-4 py-3">
        <div className="dd-eyebrow text-ink-mute mb-2">Notiz / Info zum Vorgang</div>
        <div className="flex gap-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }}
            rows={2}
            placeholder="z.B. Material-Link, Telefonat, Absprache … (⌘/Strg+Enter speichert)"
            className="flex-1 resize-none rounded-md border border-steel-line bg-bg-2 px-3 py-2 text-[13px] text-ink placeholder:text-ink-mute focus:outline-none focus:border-copper"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="font-mono text-[10px] text-ink-mute">
            {inquiry ? "wird an den Verlauf gehängt" : "legt einen Verlauf für diesen Vorgang an"}
          </span>
          <button
            onClick={addNote}
            disabled={noteBusy || !noteText.trim()}
            className="font-mono text-[11px] tracking-wider uppercase px-4 py-2 rounded-md bg-ink text-white disabled:opacity-40 hover:bg-copper transition-colors"
          >
            {noteBusy ? "speichert …" : "+ Notiz"}
          </button>
        </div>
        {noteErr && <p className="mt-2 text-[12px] text-rust">{noteErr}</p>}
      </div>

      {inquiry && (
        <InquiryPhotoGallery
          inquiry={inquiry}
          siteId={siteId}
          onPhotosUpdated={(photos) => onInquiryUpdate?.({ ...inquiry, photos })}
        />
      )}

      {inquiry?.rawText && (
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
