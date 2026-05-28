// Angebote-Pipeline API. Liest/schreibt pipeline_cards in Supabase.
// Backend-Verbindung ist Pflicht — fehlt VITE_SUPABASE_URL/_ANON_KEY,
// werfen die Calls einen klaren Fehler (Demo-Modus entfernt 26.05.2026).

import { supabase, isBackendConnected } from "./supabase";
import { sevdeskCancelOrder } from "./sevdesk";

export const STAGES = [
  "Anfrage",
  "Angebot",
  "Versendet",
  "Auftrag",
  "In Arbeit",
  "Abgerechnet"
] as const;
export type Stage = (typeof STAGES)[number];

/** Best-Practice-Frist: nach so vielen Tagen ohne Reaktion nachfassen. */
export const FOLLOWUP_DAYS = 7;

export interface PipelineCard {
  id: string;
  stage: Stage;
  customerName: string;
  place?: string;
  description?: string;
  valueEur?: number;
  openPoints?: string;
  docNumber?: string;
  siteId?: string;
  assignedWorkerId?: string;
  planEur?: number;
  actualEur?: number;
  validUntil?: string; // ISO date
  sentAt?: string;     // ISO timestamp, gesetzt beim Wechsel auf "Versendet"
  archivedAt?: string; // ISO timestamp, gesetzt = aus aktivem Board raus
  cancelledAt?: string;        // ISO timestamp, gesetzt = Vorgang storniert
  cancellationReason?: string; // freier Grund-Text (optional)
  sevdeskOrderId?: string;     // sevDesk Order-ID für Storno-Sync
  /** Aus sevDesk gespiegelte Belegpositionen (Angebot AN-… bzw. Schlussrechnung RE-…). */
  positions?: PipelinePosition[];
  /** Chef-Freigabe-Stand des Belegs (eigene jsonb-Spalte). */
  freigabe?: Freigabe;
  sortOrder: number;
  createdAt: string;
}

export type ReviewStatus = "offen" | "ok" | "kommentar" | "aenderung";

export interface PipelinePosition {
  pos: number;
  name: string;
  quantity: string;   // inkl. Einheit, z. B. "28 Std" / "13"
  unitPrice: string;  // formatiert, z. B. "65,00" oder "offen"
  sum: number;        // Zeilensumme netto
  /** Chef-Review je Position (liegt im positions-jsonb, keine Migration). */
  review?: {
    status: ReviewStatus;
    comment?: string;
    by?: string;
    at?: string;       // ISO
  };
}

export interface FreigabeEvent {
  at: string;          // ISO
  by: string;
  action: string;      // z. B. "Position 5 kommentiert", "Alles freigegeben"
}

export interface Freigabe {
  releasedBy?: string;
  releasedAt?: string; // ISO, gesetzt = Beleg freigegeben
  history: FreigabeEvent[];
}

export interface PipelineCardInput {
  stage?: Stage;
  customerName: string;
  place?: string;
  description?: string;
  valueEur?: number | null;
  openPoints?: string;
  docNumber?: string;
  validUntil?: string | null;
}

function rowToCard(r: any): PipelineCard {
  return {
    id: r.id,
    stage: r.stage,
    customerName: r.customer_name,
    place: r.place ?? undefined,
    description: r.description ?? undefined,
    valueEur: r.value_eur != null ? Number(r.value_eur) : undefined,
    openPoints: r.open_points ?? undefined,
    docNumber: r.doc_number ?? undefined,
    siteId: r.site_id ?? undefined,
    assignedWorkerId: r.assigned_worker_id ?? undefined,
    planEur: r.plan_eur != null ? Number(r.plan_eur) : undefined,
    actualEur: r.actual_eur != null ? Number(r.actual_eur) : undefined,
    validUntil: r.valid_until ?? undefined,
    sentAt: r.sent_at ?? undefined,
    archivedAt: r.archived_at ?? undefined,
    cancelledAt: r.cancelled_at ?? undefined,
    cancellationReason: r.cancellation_reason ?? undefined,
    sevdeskOrderId: r.sevdesk_order_id ?? undefined,
    positions: Array.isArray(r.positions) ? r.positions : undefined,
    freigabe: r.freigabe && typeof r.freigabe === "object"
      ? { history: [], ...r.freigabe }
      : undefined,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at
  };
}

const COLS =
  "id, stage, customer_name, place, description, value_eur, open_points, " +
  "doc_number, sevdesk_order_id, site_id, assigned_worker_id, plan_eur, actual_eur, valid_until, " +
  "sent_at, archived_at, cancelled_at, cancellation_reason, positions, freigabe, sort_order, created_at";

/** COLS ohne die Spalten aus noch nicht eingespielten Migrationen. */
const COLS_BASE = COLS
  .replace("sevdesk_order_id, ", "")
  .replace("sent_at, archived_at, ", "")
  .replace("cancelled_at, cancellation_reason, ", "")
  .replace("positions, freigabe, ", "");

/**
 * Lädt Pipeline-Karten. `archived: false` (Standard) = aktives Board ohne
 * archivierte Vorgänge; `archived: true` = nur das Archiv.
 */
export async function listCards(
  opts: { archived?: boolean } = {}
): Promise<PipelineCard[]> {
  const wantArchived = opts.archived === true;
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlt).");
  }
  const sb: any = supabase;
  let q = sb
    .from("pipeline_cards")
    .select(COLS)
    .order("stage", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  q = wantArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data, error } = await q;
  if (error) {
    // Migration 20260519140000 noch nicht auf der DB? Dann gibt es die Spalte
    // archived_at nicht. Statt das Board komplett leer zu lassen, laden wir
    // ohne sie: alle Vorgänge gelten als aktiv, das Archiv ist (noch) leer.
    // Sobald die Spalte existiert, greift automatisch wieder der Filter oben.
    if (/archived_at|sent_at|positions|freigabe|cancelled_at|cancellation_reason|sevdesk_order_id/.test(String(error?.message ?? ""))) {
      if (wantArchived) return [];
      const { data: d2, error: e2 } = await sb
        .from("pipeline_cards")
        .select(COLS_BASE)
        .order("stage", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      return (d2 ?? []).map(rowToCard);
    }
    throw error;
  }
  return (data ?? []).map(rowToCard);
}

/** Bezahlten Vorgang aus dem aktiven Board ins Archiv legen. */
export async function archiveCard(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb
    .from("pipeline_cards")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (/archived_at/.test(String(error?.message ?? "")))
      throw new Error("Archiv erst nach DB-Migration aktiv (Spalte archived_at fehlt noch).");
    throw error;
  }
}

/** Vorgang aus dem Archiv zurück ins aktive Board holen. */
export async function unarchiveCard(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb
    .from("pipeline_cards")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Automatik Stufe „Auftrag": sorgt dafür, dass der Vorgang eine Baustelle hat.
 * Dedupe: existiert eine Baustelle mit gleicher sevDesk-/AN-Nummer oder
 * gleichem Kundennamen, wird damit verknüpft (keine Dublette), sonst wird
 * eine neue Baustelle aus den Kartendaten angelegt. Verknüpft die Karte
 * (site_id) und füllt plan_eur für die Nachkalkulation.
 * Gibt zurück, was passiert ist (für den UI-Hinweis), oder null wenn nichts
 * zu tun war (kein Backend / schon verknüpft).
 */
export async function linkOrCreateSiteForCard(
  card: PipelineCard
): Promise<{ siteId: string; created: boolean; siteName: string } | null> {
  if (!isBackendConnected() || !supabase) return null;
  if (card.siteId) return null;
  const sb: any = supabase;

  // 1) Dedupe: passende Baustelle suchen
  const { data: sites, error: sErr } = await sb
    .from("sites")
    .select("id, name, customer_name, sevdesk_order_number");
  if (sErr) throw sErr;
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const match =
    (card.docNumber &&
      (sites ?? []).find(
        (s: any) => norm(s.sevdesk_order_number) === norm(card.docNumber)
      )) ||
    (sites ?? []).find(
      (s: any) => norm(s.customer_name) === norm(card.customerName)
    );

  let siteId: string;
  let siteName: string;
  let created = false;

  if (match) {
    siteId = match.id;
    siteName = match.name;
  } else {
    // 2) Neue Baustelle aus den Kartendaten
    const company_id = await adminCompanyId(sb);
    const notes = [
      card.place ? `Ort: ${card.place}` : null,
      card.description || null,
      card.openPoints ? `Offen: ${card.openPoints}` : null,
      card.docNumber ? `Aus Pipeline-Vorgang ${card.docNumber}` : null
    ]
      .filter(Boolean)
      .join("\n");
    const { data: ins, error: iErr } = await sb
      .from("sites")
      .insert({
        company_id,
        name: card.customerName.trim(),
        customer_name: card.customerName.trim(),
        sevdesk_order_number: card.docNumber?.trim() || null,
        estimate_net_eur: card.valueEur ?? card.planEur ?? null,
        notes: notes || null,
        starred: false
      })
      .select("id, name")
      .single();
    if (iErr) throw iErr;
    siteId = ins.id;
    siteName = ins.name;
    created = true;
  }

  // 3) Karte verknüpfen + Plan für Nachkalkulation setzen
  const patch: Record<string, unknown> = { site_id: siteId };
  if (card.planEur == null && (card.valueEur ?? null) != null)
    patch.plan_eur = card.valueEur;
  const { error: uErr } = await sb
    .from("pipeline_cards")
    .update(patch)
    .eq("id", card.id);
  if (uErr) throw uErr;

  // 4) Auto-Anlage aus der verknüpften Anfrage (#3 Klärpunkte, #5 Material-Status):
  //    - Material-Alternativen aus Parser (note ~ /alternativ/i) → site_questions
  //    - Positionen aus der Karte → site_materials (Status 'planned')
  //    Beides ist Komfort, Fehler werden geschluckt damit der Stage-Wechsel nicht hängt.
  try {
    if (created) {
      // Nur bei neu angelegter Site, sonst gäbe es ggf. schon Material/Klärpunkte
      await autoFillSiteFromCard(sb, siteId, card);
    }
  } catch (e) {
    console.warn("[autofill site from card] ", e);
  }

  return { siteId, created, siteName };
}

/** Befüllt eine frisch angelegte Baustelle aus den verknüpften Anfragen-Daten:
 *  - site_materials aus pipeline_cards.positions (Status 'planned')
 *  - site_questions aus inquiry.parsed_json.leistungen[].materialien (note=Alternativ-Wahl) */
async function autoFillSiteFromCard(sb: any, siteId: string, card: PipelineCard): Promise<void> {
  // Material-Bestand aus den Wizard-Positionen
  if (Array.isArray(card.positions) && card.positions.length > 0) {
    const rows = card.positions.map((p) => {
      // quantity ist im Wizard-Format "30 m²" — wir parsen Zahl + Einheit getrennt
      const qStr = String(p.quantity ?? "");
      const num = parseFloat(qStr.replace(",", ".")) || null;
      const unit = qStr.match(/[a-zA-Z²³.]+/)?.[0] ?? null;
      const price = parseFloat(String(p.unitPrice ?? "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || null;
      return {
        site_id: siteId,
        name: p.name,
        quantity: num,
        unit,
        status: "planned",
        price_eur: price,
      };
    });
    if (rows.length) await sb.from("site_materials").insert(rows);
  }

  // Klärpunkte aus Inquiry-Materialien (Alternativ-Wahl)
  const { data: inqRows } = await sb
    .from("inquiries")
    .select("id, parsed_json, company_id")
    .eq("pipeline_card_id", card.id)
    .limit(1);
  const inq = inqRows?.[0];
  if (!inq) return;
  const leistungen = (inq.parsed_json as any)?.leistungen as
    | { name: string; materialien?: { name: string; spec?: string; note?: string }[] }[]
    | undefined;
  if (!Array.isArray(leistungen) || leistungen.length === 0) return;

  const questions: any[] = [];
  leistungen.forEach((l, lIdx) => {
    const alternatives = (l.materialien ?? []).filter((m) => /alternativ/i.test(m.note ?? ""));
    if (alternatives.length === 0) return;
    // Bei Alternativ-Wahl: alle Materialien zur Wahl auflisten
    const optionTexts = (l.materialien ?? []).map((m) => m.spec ? `${m.name} ${m.spec}` : m.name);
    questions.push({
      company_id: inq.company_id,
      site_id: siteId,
      kind: "material",
      title: `${l.name}: ${optionTexts.join(" oder ")}? — Kunde wählen lassen`,
      detail: alternatives[0].note ?? null,
      status: "offen",
      source_inquiry_id: inq.id,
      source_field: `leistungen[${lIdx}].materialien`,
    });
  });
  if (questions.length) await sb.from("site_questions").insert(questions);
}

async function adminCompanyId(sb: any): Promise<string> {
  const uid = (await sb.auth.getUser()).data.user?.id;
  const { data: w, error } = await sb
    .from("workers")
    .select("company_id")
    .eq("auth_user_id", uid)
    .single();
  if (error) throw error;
  return w.company_id;
}

export async function createCard(input: PipelineCardInput): Promise<PipelineCard> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const company_id = await adminCompanyId(sb);
  const row = {
    company_id,
    stage: input.stage ?? "Anfrage",
    customer_name: input.customerName.trim(),
    place: input.place?.trim() || null,
    description: input.description?.trim() || null,
    value_eur: input.valueEur ?? null,
    open_points: input.openPoints?.trim() || null,
    doc_number: input.docNumber?.trim() || null,
    valid_until: input.validUntil || null
  };
  const { data, error } = await sb
    .from("pipeline_cards")
    .insert(row)
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToCard(data);
}

export async function updateCardStage(id: string, stage: Stage): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  // Beim Wechsel auf "Versendet" das Versanddatum setzen (Basis fürs Nachfassen)
  const patch: Record<string, unknown> =
    stage === "Versendet"
      ? { stage, sent_at: new Date().toISOString() }
      : { stage };
  let { error } = await sb.from("pipeline_cards").update(patch).eq("id", id);
  if (error && /sent_at/.test(String(error.message ?? ""))) {
    // sent_at-Spalte noch nicht migriert: Stufe trotzdem setzen
    ({ error } = await sb
      .from("pipeline_cards")
      .update({ stage })
      .eq("id", id));
  }
  if (error) {
    // Check-Constraint kennt 'Versendet' noch nicht (Migration offen)
    if (/check|constraint|invalid input|violates/i.test(String(error.message ?? "")))
      throw new Error(
        "Stufe Versendet erst nach DB-Migration aktiv (Constraint kennt sie noch nicht)."
      );
    throw error;
  }
}

export async function updateCard(
  id: string,
  patch: Partial<PipelineCardInput>
): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const row: Record<string, unknown> = {};
  if (patch.stage !== undefined) row.stage = patch.stage;
  if (patch.customerName !== undefined) row.customer_name = patch.customerName.trim();
  if (patch.place !== undefined) row.place = patch.place?.trim() || null;
  if (patch.description !== undefined) row.description = patch.description?.trim() || null;
  if (patch.valueEur !== undefined) row.value_eur = patch.valueEur ?? null;
  if (patch.openPoints !== undefined) row.open_points = patch.openPoints?.trim() || null;
  if (patch.docNumber !== undefined) row.doc_number = patch.docNumber?.trim() || null;
  if (patch.validUntil !== undefined) row.valid_until = patch.validUntil || null;
  const { error } = await sb.from("pipeline_cards").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteCard(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from("pipeline_cards").delete().eq("id", id);
  if (error) throw error;
}

function mergeFreigabe(cur: Freigabe | undefined, ev: FreigabeEvent, extra?: Partial<Freigabe>): Freigabe {
  const base: Freigabe = cur ? { ...cur, history: [...(cur.history ?? [])] } : { history: [] };
  base.history.push(ev);
  return { ...base, ...extra };
}

/**
 * Chef-Review einer einzelnen Position setzen (OK / Kommentar / Änderung).
 * Schreibt in positions-jsonb (immer) und protokolliert in freigabe-jsonb
 * (best effort, falls Spalte noch fehlt wird das Protokoll übersprungen).
 * Gibt die neuen positions + freigabe für optimistisches UI zurück.
 */
export async function reviewPosition(
  card: PipelineCard,
  posNr: number,
  patch: { status: ReviewStatus; comment?: string },
  by: string
): Promise<{ positions: PipelinePosition[]; freigabe: Freigabe }> {
  const now = new Date().toISOString();
  const positions = (card.positions ?? []).map((p) =>
    p.pos === posNr
      ? { ...p, review: { status: patch.status, comment: patch.comment, by, at: now } }
      : p
  );
  const label =
    patch.status === "ok" ? "freigegeben"
    : patch.status === "aenderung" ? "als unsicher markiert"
    : patch.status === "kommentar" ? "kommentiert"
    : "zurückgesetzt";
  const freigabe = mergeFreigabe(card.freigabe, {
    at: now, by, action: `Position ${posNr} ${label}`
  });
  if (!isBackendConnected() || !supabase) return { positions, freigabe };
  const sb: any = supabase;
  const { error } = await sb.from("pipeline_cards").update({ positions }).eq("id", card.id);
  if (error) throw error;
  // Protokoll best effort
  await sb.from("pipeline_cards").update({ freigabe }).eq("id", card.id);
  return { positions, freigabe };
}

/** Ganzen Beleg freigeben (Signatur-Stempel + Verlauf). Braucht freigabe-Spalte. */
export async function releaseCard(
  card: PipelineCard,
  by: string
): Promise<Freigabe> {
  const now = new Date().toISOString();
  const freigabe = mergeFreigabe(
    card.freigabe,
    { at: now, by, action: "Alles freigegeben" },
    { releasedBy: by, releasedAt: now }
  );
  if (!isBackendConnected() || !supabase) return freigabe;
  const sb: any = supabase;
  const { error } = await sb.from("pipeline_cards").update({ freigabe }).eq("id", card.id);
  if (error) {
    if (/freigabe/.test(String(error?.message ?? "")))
      throw new Error("Freigabe erst nach DB-Migration aktiv (Spalte freigabe fehlt noch).");
    throw error;
  }
  return freigabe;
}

/** Freigabe zurücknehmen (z. B. nach Änderung). */
export async function revokeRelease(
  card: PipelineCard,
  by: string
): Promise<Freigabe> {
  const now = new Date().toISOString();
  const freigabe = mergeFreigabe(
    card.freigabe,
    { at: now, by, action: "Freigabe zurückgenommen" }
  );
  freigabe.releasedBy = undefined;
  freigabe.releasedAt = undefined;
  if (!isBackendConnected() || !supabase) return freigabe;
  const sb: any = supabase;
  const { error } = await sb.from("pipeline_cards").update({ freigabe }).eq("id", card.id);
  if (error) throw error;
  return freigabe;
}

/**
 * Storniert einen Pipeline-Vorgang:
 *  1) Wenn sevdeskOrderId oder docNumber (AN-…) gesetzt → sevDesk-Order
 *     auf Status 500 (Abgelehnt) setzen + Storno-Vermerk in headText.
 *     Fehler beim sevDesk-Sync werden NICHT geschluckt — der Caller bekommt
 *     sie zurück und entscheidet (UI zeigt sie als Warnung, lokale Storno
 *     wird trotzdem ausgeführt).
 *  2) DB: cancelled_at = now(), cancellation_reason = reason,
 *     archived_at = now() (verschwindet aus aktivem Board, taucht im
 *     Archiv mit STORNIERT-Badge auf).
 *  3) Freigabe-Log um Storno-Eintrag erweitert (für Audit-Spur).
 *
 * Gibt { sevdeskError? } zurück — bei sevDesk-Problem trotzdem erfolgreich,
 * UI kann dann den Sync-Fehler anzeigen.
 */
export async function cancelCard(
  card: PipelineCard,
  reason: string | undefined,
  by: string
): Promise<{ sevdeskError?: string }> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const now = new Date().toISOString();

  // 1) sevDesk-Sync (best effort)
  let sevdeskError: string | undefined;
  const hasOrderRef = !!card.sevdeskOrderId || /^AN-\d+/i.test(card.docNumber ?? "");
  if (hasOrderRef) {
    try {
      await sevdeskCancelOrder(
        { id: card.sevdeskOrderId, orderNumber: card.docNumber },
        reason
      );
    } catch (e: any) {
      sevdeskError = String(e?.message ?? e).slice(0, 240);
    }
  }

  // 2) DB-Update + Freigabe-Verlauf nachpflegen
  const freigabe = mergeFreigabe(card.freigabe, {
    at: now,
    by,
    action: reason ? `Storniert — ${reason}` : "Storniert",
  });
  const patch: Record<string, unknown> = {
    cancelled_at: now,
    cancellation_reason: reason?.trim() || null,
    archived_at: now,
    freigabe,
  };
  const { error } = await sb.from("pipeline_cards").update(patch).eq("id", card.id);
  if (error) {
    if (/cancelled_at|cancellation_reason/.test(String(error?.message ?? "")))
      throw new Error("Storno erst nach DB-Migration aktiv (cancelled_at/cancellation_reason fehlt).");
    // freigabe-Spalte fehlt eventuell — retry ohne sie
    if (/freigabe/.test(String(error?.message ?? ""))) {
      delete (patch as any).freigabe;
      const { error: e2 } = await sb.from("pipeline_cards").update(patch).eq("id", card.id);
      if (e2) throw e2;
    } else {
      throw error;
    }
  }

  return { sevdeskError };
}

/** Storno rückgängig machen — z.B. wenn der Kunde sich umentschieden hat.
 *  ACHTUNG: synct NICHT mit sevDesk zurück (manueller Status-Reset nötig). */
export async function uncancelCard(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb
    .from("pipeline_cards")
    .update({ cancelled_at: null, cancellation_reason: null, archived_at: null })
    .eq("id", id);
  if (error) throw error;
}

