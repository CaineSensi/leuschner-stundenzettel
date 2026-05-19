// Angebote-Pipeline API. Liest/schreibt pipeline_cards in Supabase.
// Ohne Backend (VITE_SUPABASE_URL nicht gesetzt) → Mock-Daten, damit das
// Board auch im Dev-/Demo-Modus sofort gefüllt ist.

import { supabase, isBackendConnected } from "./supabase";

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
  sortOrder: number;
  createdAt: string;
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
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at
  };
}

const COLS =
  "id, stage, customer_name, place, description, value_eur, open_points, " +
  "doc_number, site_id, assigned_worker_id, plan_eur, actual_eur, valid_until, " +
  "sent_at, archived_at, sort_order, created_at";

/** COLS ohne die Spalten aus noch nicht eingespielten Migrationen. */
const COLS_BASE = COLS.replace("sent_at, archived_at, ", "");

/**
 * Lädt Pipeline-Karten. `archived: false` (Standard) = aktives Board ohne
 * archivierte Vorgänge; `archived: true` = nur das Archiv.
 */
export async function listCards(
  opts: { archived?: boolean } = {}
): Promise<PipelineCard[]> {
  const wantArchived = opts.archived === true;
  if (!isBackendConnected() || !supabase) {
    return MOCK_CARDS.filter((c) =>
      wantArchived ? c.archivedAt != null : c.archivedAt == null
    );
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
    if (/archived_at|sent_at/.test(String(error?.message ?? ""))) {
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

  return { siteId, created, siteName };
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
        "Stufe „Versendet" erst nach DB-Migration aktiv (Constraint kennt sie noch nicht)."
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

// ---- Mock (Dev/Demo ohne Backend) ----
const MOCK_CARDS: PipelineCard[] = [
  { id: "m1", stage: "Anfrage", customerName: "Josef Borgmann",
    place: "Tunxdorferstraße 46 · 26871 Papenburg",
    description: "Doppelstabzaun 8/6/8 · 53 Matten (180/160/120) + 56 Pfosten + 3 Tore",
    valueEur: 9333.74, openPoints: "Tore: Hesse-Preis offen · Rückruf erbeten",
    docNumber: "AN-1253", sortOrder: 1, createdAt: "2026-05-19" },
  { id: "m2", stage: "Anfrage", customerName: "Diakoniestation Leer gGmbH",
    place: "Leer (Ostfriesland)",
    description: "Außenanlage: Pflasterung Eingangsbereich + Rasenmähkante",
    openPoints: "Vor-Ort-Termin / Aufmaß planen", sortOrder: 2, createdAt: "2026-05-17" },
  { id: "m3", stage: "Angebot", customerName: "Jan Hundertmark", place: "Weener",
    description: "Doppelstabzaun + Sichtschutzstreifen, Fundamente, Aufbau",
    valueEur: 1546.08, openPoints: "versendet", docNumber: "AN-1251",
    validUntil: "2026-05-28", sortOrder: 1, createdAt: "2026-05-08" },
  { id: "m4", stage: "Angebot", customerName: "Jan Hundertmark", place: "Weener",
    description: "Zaun zurückbauen + Neuaufbau, Entsorgung",
    valueEur: 2598.26, openPoints: "versendet", docNumber: "AN-1250",
    validUntil: "2026-05-22", sortOrder: 2, createdAt: "2026-05-07" },
  { id: "m5", stage: "Angebot", customerName: "Privat · Großprojekt", place: "Bunde",
    description: "Drainage + Gartenmauer + Pflaster + Rhombuszaun + Rasen (39 Pos.)",
    valueEur: 18290.50, openPoints: "Gültigkeit abgelaufen — nachfassen!",
    docNumber: "AN-1245", validUntil: "2026-04-16", sortOrder: 3, createdAt: "2026-04-23" },
  { id: "m6", stage: "Auftrag", customerName: "Andrea Remmert",
    place: "Bunde · Auftrag 26-08",
    description: "Baggerarbeiten Kettenbagger 22 to. (16 Std) + Transport",
    valueEur: 4350.00, planEur: 4350.00, openPoints: "Baustelle angelegt · Start KW 22",
    docNumber: "AN-1252", sortOrder: 1, createdAt: "2026-05-11" },
  { id: "m7", stage: "Auftrag", customerName: "Privat", place: "Weener",
    description: "Pflaster Hofeinfahrt + Randsteine in Beton",
    valueEur: 4426.25, planEur: 4426.25, openPoints: "Material: 4 Positionen offen",
    docNumber: "AN-1242", sortOrder: 2, createdAt: "2026-04-01" },
  { id: "m8", stage: "In Arbeit", customerName: "Privat", place: "Weener · aktiv seit KW 20",
    description: "Pflaster ums Haus + Zaun + Rasen + Palisaden (35 Pos.)",
    valueEur: 5334.56, planEur: 5334.56, actualEur: 3307.00,
    docNumber: "AN-1234", sortOrder: 1, createdAt: "2026-03-13" },
  { id: "m9", stage: "In Arbeit", customerName: "Privat", place: "Leer · aktiv seit KW 19",
    description: "Terrasse + Drainage + Einfassung",
    valueEur: 7468.71, planEur: 7468.71, actualEur: 6572.00,
    openPoints: "Ist knapp — beobachten", docNumber: "AN-1226",
    sortOrder: 2, createdAt: "2026-03-03" },
  { id: "m10", stage: "Abgerechnet", customerName: "Andrea Remmert",
    place: "Bunde · aus AN-1243", description: "Pflasterarbeiten — Schlussrechnung",
    valueEur: 2061.34, planEur: 2100.00, actualEur: 1972.00,
    openPoints: "bezahlt · DATEV ✓", docNumber: "RE-1254",
    sortOrder: 1, createdAt: "2026-04-24" }
];
