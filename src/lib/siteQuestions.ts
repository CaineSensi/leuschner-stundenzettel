// Klärpunkte pro Baustelle. Offene Fragen, Wiedervorlagen, Klärungen.
// Auto-Anlage: Beim Anlegen eines Angebots aus einer Anfrage werden alle
// Material-Alternativen aus dem Parser (M12, note ~ /alternativ/i) als
// Klärpunkt mit kind='material' angelegt.

import { supabase, isBackendConnected } from "./supabase";

export type QuestionKind = "material" | "termin" | "technisch" | "sonstiges";
export type QuestionStatus = "offen" | "wartet" | "erledigt" | "verworfen";

export interface SiteQuestion {
  id: string;
  siteId: string;
  kind: QuestionKind;
  title: string;
  detail?: string;
  owner?: string;
  status: QuestionStatus;
  dueAt?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  sourceInquiryId?: string;
  sourceField?: string;
  createdAt: string;
  updatedAt: string;
}

export const KIND_META: Record<QuestionKind, { label: string; icon: string }> = {
  material:  { label: "Material",  icon: "🧱" },
  termin:    { label: "Termin",    icon: "📅" },
  technisch: { label: "Technisch", icon: "⚙" },
  sonstiges: { label: "Sonstiges", icon: "📝" },
};

export const STATUS_META: Record<QuestionStatus, { label: string; color: string; bg: string }> = {
  offen:     { label: "offen",      color: "#B91C1C", bg: "rgba(185,28,28,0.10)" },
  wartet:    { label: "wartet",     color: "#B45309", bg: "rgba(180,83,9,0.10)" },
  erledigt:  { label: "erledigt",   color: "#15803D", bg: "rgba(21,128,61,0.10)" },
  verworfen: { label: "verworfen",  color: "#6B7280", bg: "rgba(107,114,128,0.10)" },
};

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const COLS = "id, site_id, kind, title, detail, owner, status, due_at, resolved_at, resolution_note, source_inquiry_id, source_field, created_at, updated_at";

function rowToQuestion(r: any): SiteQuestion {
  return {
    id: r.id,
    siteId: r.site_id,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? undefined,
    owner: r.owner ?? undefined,
    status: r.status,
    dueAt: r.due_at ?? undefined,
    resolvedAt: r.resolved_at ?? undefined,
    resolutionNote: r.resolution_note ?? undefined,
    sourceInquiryId: r.source_inquiry_id ?? undefined,
    sourceField: r.source_field ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSiteQuestions(siteId: string): Promise<SiteQuestion[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("site_questions")
    .select(COLS)
    .eq("site_id", siteId)
    .order("status", { ascending: true })   // offen zuerst
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToQuestion);
}

export async function createSiteQuestion(input: {
  siteId: string;
  kind?: QuestionKind;
  title: string;
  detail?: string;
  owner?: string;
  dueAt?: string;
  sourceInquiryId?: string;
  sourceField?: string;
}): Promise<SiteQuestion> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const { data, error } = await sb
    .from("site_questions")
    .insert({
      company_id: COMPANY_ID,
      site_id: input.siteId,
      kind: input.kind ?? "sonstiges",
      title: input.title,
      detail: input.detail ?? null,
      owner: input.owner ?? null,
      due_at: input.dueAt ?? null,
      source_inquiry_id: input.sourceInquiryId ?? null,
      source_field: input.sourceField ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToQuestion(data);
}

export async function updateSiteQuestion(id: string, patch: Partial<{
  status: QuestionStatus;
  title: string;
  detail: string | null;
  owner: string | null;
  dueAt: string | null;
  resolutionNote: string | null;
  kind: QuestionKind;
}>): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const row: any = {};
  if (patch.status !== undefined) {
    row.status = patch.status;
    row.resolved_at = (patch.status === "erledigt" || patch.status === "verworfen") ? new Date().toISOString() : null;
  }
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.detail !== undefined) row.detail = patch.detail;
  if (patch.owner !== undefined) row.owner = patch.owner;
  if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
  if (patch.resolutionNote !== undefined) row.resolution_note = patch.resolutionNote;
  if (patch.kind !== undefined) row.kind = patch.kind;
  const { error } = await sb.from("site_questions").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteSiteQuestion(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from("site_questions").delete().eq("id", id);
  if (error) throw error;
}
