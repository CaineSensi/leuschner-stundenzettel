// Angebote-Pipeline API. Liest/schreibt pipeline_cards in Supabase.
// Backend-Verbindung ist Pflicht — fehlt VITE_SUPABASE_URL/_ANON_KEY,
// werfen die Calls einen klaren Fehler (Demo-Modus entfernt 26.05.2026).

import { supabase, isBackendConnected } from "./supabase";
import { sevdeskCancelOrder, type SevOrderPos } from "./sevdesk";

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
  /** Herkunft der Position. "aufmass" = vom Aufmaß-Tablet erfasst. */
  source?: string;
  /** Aufmaß-Metadaten (Tablet): method gps/skizze, gemessener Wert, Kantenmaße,
   *  Genauigkeit, verknuepftes Beleg-Bild. Liegt im positions-jsonb. */
  meta?: {
    method?: "gps" | "skizze";
    value?: number;
    edges_m?: number[];
    worstAccM?: number;
    closeErrM?: number;
    photo_id?: string | null;
  } | null;
  created_at?: string;
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
 * Sorgt dafür, dass der Vorgang eine Baustelle hat. Dedupe NUR über die
 * eindeutige sevDesk-/AN-Nummer (kein Kundenname-Match) — so bekommt jeder
 * Folgeauftrag eines Bestandskunden seine eigene Baustelle, statt fälschlich an
 * eine alte angehängt zu werden. Verknüpft die Karte (site_id), füllt plan_eur
 * für die Nachkalkulation und — über `details` — Adresse/Kontakt/Kundenbezug.
 * Gibt zurück, was passiert ist (für den UI-Hinweis), oder null wenn nichts
 * zu tun war (kein Backend / schon verknüpft).
 */
/** Aufgegliederte Stamm-/Kontaktdaten aus der Anfrage, damit die Baustelle von
 *  Anfang an vollständig ist (Adresse in eigenen Spalten statt nur als notes-
 *  Freitext, Telefon/Mail/Kundenverknüpfung). Alle Felder optional — was zum
 *  Zeitpunkt des Aufrufs bekannt ist, wird übernommen. */
export interface SiteDetails {
  street?: string;
  zip?: string;
  city?: string;
  phone?: string;
  email?: string;
  customerId?: string;
  sevdeskContactId?: string;
}

export async function linkOrCreateSiteForCard(
  card: PipelineCard,
  details?: SiteDetails
): Promise<{ siteId: string; created: boolean; siteName: string } | null> {
  if (!isBackendConnected() || !supabase) return null;
  if (card.siteId) return null;
  const sb: any = supabase;

  // 1) Dedupe: passende Baustelle suchen (inkl. Adress-/Kontaktspalten, damit
  //    wir bei einem Treffer fehlende Felder nachtragen können).
  const { data: sites, error: sErr } = await sb
    .from("sites")
    .select("id, name, customer_name, sevdesk_order_number, street, zip, city, customer_phone, customer_email, customer_id, sevdesk_contact_id");
  if (sErr) throw sErr;
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  // Folgeauftrag-fest: NICHT per Kundenname deduplizieren. Bestandskunden haben
  // mehrere Baustellen (eine pro Projekt/Objekt — z.B. Weener Plastik 5, Ramona
  // Tirrel 3). Jede neue Anfrage bekommt daher ihre EIGENE Baustelle; verknüpft
  // wird nur der Kunde (customer_id/sevdesk_contact_id). Dedupe ausschließlich
  // über die eindeutige AN-/Auftragsnummer — verhindert Dubletten beim
  // Stage-Wechsel, wenn die Baustelle aus der Anfrage bereits existiert.
  const match = card.docNumber
    ? (sites ?? []).find(
        (s: any) => norm(s.sevdesk_order_number) === norm(card.docNumber)
      )
    : undefined;

  const clean = (s?: string) => (s && s.trim() ? s.trim() : null);

  let siteId: string;
  let siteName: string;
  let created = false;

  if (match) {
    siteId = match.id;
    siteName = match.name;
    // Backfill: nur LEERE Felder der bestehenden Baustelle aus den Anfrage-Daten
    // ergänzen — niemals vorhandene (manuell gepflegte) Werte überschreiben.
    const backfill: Record<string, unknown> = {};
    const setIfEmpty = (col: string, val: string | null) => {
      if (val && !match[col]) backfill[col] = val;
    };
    if (details) {
      setIfEmpty("street", clean(details.street));
      setIfEmpty("zip", clean(details.zip));
      setIfEmpty("city", clean(details.city));
      setIfEmpty("customer_phone", clean(details.phone));
      setIfEmpty("customer_email", clean(details.email));
      setIfEmpty("customer_id", details.customerId ?? null);
      setIfEmpty("sevdesk_contact_id", details.sevdeskContactId ?? null);
    }
    if (Object.keys(backfill).length) {
      const { error: bErr } = await sb.from("sites").update(backfill).eq("id", siteId);
      if (bErr) throw bErr;
    }
  } else {
    // 2) Neue Baustelle aus den Kartendaten + aufgegliederten Anfrage-Details
    const company_id = await adminCompanyId(sb);
    const notes = [
      // Ort nur dann als Freitext-Fallback, wenn keine strukturierte Adresse da ist
      !details?.street && !details?.city && card.place ? `Ort: ${card.place}` : null,
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
        street: clean(details?.street),
        zip: clean(details?.zip),
        city: clean(details?.city) ?? clean(card.place),
        customer_phone: clean(details?.phone),
        customer_email: clean(details?.email),
        customer_id: details?.customerId ?? null,
        sevdesk_contact_id: details?.sevdeskContactId ?? null,
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

/** Eingabe für die atomare Anfrage-Anlage (eine DB-Transaktion: Kunde + Karte
 *  + Anfrage + Baustelle gemeinsam, oder gar nichts). */
export interface InquiryBundleInput {
  /** Bestehender Kunde (App-Stammkunde) → wird wiederverwendet statt neu angelegt. */
  customerId?: string;
  /** Neuer Kunde — nur nötig, wenn customerId fehlt. */
  customer?: {
    sevdeskContactId?: string; customerNumber?: string;
    name: string; surename?: string; familyname?: string; isCompany?: boolean;
    email?: string; phone?: string; street?: string; zip?: string; city?: string;
  };
  card: { customerName: string; place?: string; description?: string; openPoints?: string };
  inquiry: {
    source: string; rawText: string; parsedJson?: any;
    customerName?: string; customerPhone?: string; customerEmail?: string;
    street?: string; zip?: string; city?: string; description?: string; notes?: string;
  };
  site: {
    name?: string; customerName?: string; street?: string; zip?: string; city?: string;
    customerPhone?: string; customerEmail?: string; sevdeskContactId?: string;
  };
}

/**
 * Legt eine komplette Anfrage als EINE Datenbank-Transaktion an (Kunde, Pipeline-
 * Karte, Anfrage, Baustelle – alle verknüpft). Entweder alles entsteht, oder bei
 * einem Fehler gar nichts. Verhindert halbe Zustände. sevDesk wird NICHT hier
 * angelegt (externe API) – das macht der Aufrufer als idempotenten letzten Schritt.
 */
export async function createInquiryBundle(
  input: InquiryBundleInput
): Promise<{ customerId: string; cardId: string; inquiryId: string; siteId: string }> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const c = input.customer;
  const payload = {
    customer_id: input.customerId ?? null,
    customer: c ? {
      sevdesk_contact_id: c.sevdeskContactId ?? null,
      customer_number: c.customerNumber ?? null,
      name: c.name, surename: c.surename ?? null, familyname: c.familyname ?? null,
      is_company: !!c.isCompany,
      email: c.email ?? null, phone: c.phone ?? null,
      street: c.street ?? null, zip: c.zip ?? null, city: c.city ?? null,
    } : {},
    card: {
      customer_name: input.card.customerName,
      place: input.card.place ?? null,
      description: input.card.description ?? null,
      open_points: input.card.openPoints ?? null,
    },
    inquiry: {
      source: input.inquiry.source, raw_text: input.inquiry.rawText,
      parsed_json: input.inquiry.parsedJson ?? null,
      customer_name: input.inquiry.customerName ?? null,
      customer_phone: input.inquiry.customerPhone ?? null,
      customer_email: input.inquiry.customerEmail ?? null,
      street: input.inquiry.street ?? null, zip: input.inquiry.zip ?? null, city: input.inquiry.city ?? null,
      description: input.inquiry.description ?? null, notes: input.inquiry.notes ?? null,
    },
    site: {
      name: input.site.name ?? null, customer_name: input.site.customerName ?? null,
      street: input.site.street ?? null, zip: input.site.zip ?? null, city: input.site.city ?? null,
      customer_phone: input.site.customerPhone ?? null, customer_email: input.site.customerEmail ?? null,
      sevdesk_contact_id: input.site.sevdeskContactId ?? null,
    },
  };
  const { data, error } = await sb.rpc("create_inquiry_bundle", { payload });
  if (error) throw error;
  return {
    customerId: data.customer_id, cardId: data.card_id,
    inquiryId: data.inquiry_id, siteId: data.site_id,
  };
}

/** Trägt die sevDesk-Verknüpfung nachträglich an Kunde + Baustelle ein (nach der
 *  idempotenten sevDesk-Anlage). Best effort – schlägt das fehl, bleiben die
 *  App-Daten vollständig, nur die sevDesk-Nummer fehlt und kann nachgezogen werden. */
export async function attachSevdeskToCustomer(
  customerId: string, siteId: string, sevdeskContactId: string, customerNumber?: string
): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  await sb.from("customers").update({
    sevdesk_contact_id: sevdeskContactId,
    ...(customerNumber ? { customer_number: customerNumber } : {}),
  }).eq("id", customerId);
  await sb.from("sites").update({ sevdesk_contact_id: sevdeskContactId }).eq("id", siteId);
}

/** Zählt vorhandene Pipeline-Vorgänge eines Kunden — Grundlage für die
 *  Folgeanfrage-Erkennung beim Anlegen ("Bestandskunde mit X früheren Vorgängen").
 *  head:true + count:exact zieht nur die Zahl, nicht die Zeilen. */
export async function countCardsForCustomer(customerId: string): Promise<number> {
  if (!isBackendConnected() || !supabase) return 0;
  const sb: any = supabase;
  const { count, error } = await sb
    .from("pipeline_cards")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (error) return 0;
  return count ?? 0;
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

// ── sevDesk-Beleg-Abgleich: spiegelt den Live-Stand einer Order in die Karte.
//    Geschrieben wird NUR in die App-DB (pipeline_cards); sevDesk bleibt
//    unberührt (der Schnappschuss wurde rein lesend geholt). ─────────────────

function fmtQuantity(q: number, unityLabel: string): string {
  const n = Number.isInteger(q) ? String(q) : String(q).replace(".", ",");
  return unityLabel ? `${n} ${unityLabel}` : n;
}

/** Wandelt sevDesk-Positionen ins Karten-Format (PipelinePosition) um.
 *  Bestehende Chef-Reviews werden positionsweise (über die Pos-Nummer)
 *  erhalten — der Abgleich darf Freigaben nicht wegwerfen. */
export function sevPositionsToPipeline(
  positions: SevOrderPos[],
  prev?: PipelinePosition[]
): PipelinePosition[] {
  const byPos = new Map<number, PipelinePosition>();
  (prev ?? []).forEach((p) => byPos.set(p.pos, p));
  return positions.map((p) => {
    const old = byPos.get(p.positionNumber);
    return {
      pos: p.positionNumber,
      name: p.name,
      quantity: fmtQuantity(p.quantity, p.unityLabel),
      unitPrice: p.price.toFixed(2).replace(".", ","),
      sum: p.sumNet,
      ...(old?.review ? { review: old.review } : {}),
    };
  });
}

/** Schreibt die abgeglichenen Beleg-Felder in die Karte. Alle Felder optional —
 *  nur was Rick im Vorschau-Dialog bestätigt hat, wird gesetzt.
 *
 *  Die Pipeline-Stufe wird hier ABSICHTLICH nicht gespiegelt: Der sevDesk-Status
 *  bildet die Vertriebsstufe nicht ab (Status 200 „offen" steht z. B. sowohl auf
 *  „Versendet" als auch „Auftrag"). Das Kanban-Board ist für die Stufe maßgebend. */
export async function syncCardFromSevdesk(
  id: string,
  patch: { positions?: PipelinePosition[]; valueEur?: number; docNumber?: string; sevdeskOrderId?: string; customerId?: string }
): Promise<void> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const row: Record<string, unknown> = {};
  if (patch.positions !== undefined) row.positions = patch.positions;
  if (patch.valueEur !== undefined) { row.value_eur = patch.valueEur; row.plan_eur = patch.valueEur; }
  if (patch.docNumber !== undefined) row.doc_number = patch.docNumber.trim() || null;
  if (patch.sevdeskOrderId !== undefined) row.sevdesk_order_id = patch.sevdeskOrderId || null;
  if (patch.customerId !== undefined) row.customer_id = patch.customerId;
  if (Object.keys(row).length === 0) return;
  const { error } = await sb.from("pipeline_cards").update(row).eq("id", id);
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

