// Material-Bestellungen pro Baustelle.
// Status-Flow: planned → ordered → delivered → installed (oder returned).
//
// Verwendet von SiteDetail (Material-Sektion) und beim Anlegen eines
// Angebots: Anfrage-Parser-Materialien können automatisch als 'planned'-
// Material in der zugehörigen Baustelle landen.

import { supabase, isBackendConnected } from "./supabase";

export type MaterialStatus = "planned" | "ordered" | "delivered" | "installed" | "returned";

export interface SiteMaterial {
  id: string;
  siteId: string;
  name: string;
  quantity?: number;
  unit?: string;
  status: MaterialStatus;
  supplier?: string;
  orderedAt?: string;
  deliveredAt?: string;
  priceEur?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const MATERIAL_STATUS_META: Record<MaterialStatus, { label: string; color: string; icon: string; rank: number }> = {
  planned:   { label: "geplant",     color: "#9CA3AF", icon: "○",  rank: 0 },
  ordered:   { label: "bestellt",    color: "#B45309", icon: "◐",  rank: 1 },
  delivered: { label: "geliefert",   color: "#1E40AF", icon: "◑",  rank: 2 },
  installed: { label: "verbaut",     color: "#15803D", icon: "●",  rank: 3 },
  returned:  { label: "retourniert", color: "#6B7280", icon: "↩",  rank: -1 },
};

const COLS = "id, site_id, name, quantity, unit, status, supplier, ordered_at, delivered_at, price_eur, notes, created_at, updated_at";

function rowToMaterial(r: any): SiteMaterial {
  return {
    id: r.id,
    siteId: r.site_id,
    name: r.name,
    quantity: r.quantity ?? undefined,
    unit: r.unit ?? undefined,
    status: r.status,
    supplier: r.supplier ?? undefined,
    orderedAt: r.ordered_at ?? undefined,
    deliveredAt: r.delivered_at ?? undefined,
    priceEur: r.price_eur ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSiteMaterials(siteId: string): Promise<SiteMaterial[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("site_materials")
    .select(COLS)
    .eq("site_id", siteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToMaterial);
}

export async function createSiteMaterial(input: {
  siteId: string;
  name: string;
  quantity?: number;
  unit?: string;
  status?: MaterialStatus;
  supplier?: string;
  notes?: string;
}): Promise<SiteMaterial> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  const { data, error } = await sb
    .from("site_materials")
    .insert({
      site_id: input.siteId,
      name: input.name,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      status: input.status ?? "planned",
      supplier: input.supplier ?? null,
      notes: input.notes ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToMaterial(data);
}

export async function updateSiteMaterialStatus(id: string, status: MaterialStatus): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const patch: any = { status };
  if (status === "ordered") patch.ordered_at = new Date().toISOString().slice(0, 10);
  if (status === "delivered") patch.delivered_at = new Date().toISOString().slice(0, 10);
  const { error } = await sb.from("site_materials").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updateSiteMaterial(id: string, patch: Partial<{
  name: string; quantity: number | null; unit: string | null; supplier: string | null; notes: string | null;
}>): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const row: any = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.quantity !== undefined) row.quantity = patch.quantity;
  if (patch.unit !== undefined) row.unit = patch.unit;
  if (patch.supplier !== undefined) row.supplier = patch.supplier;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await sb.from("site_materials").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteSiteMaterial(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from("site_materials").delete().eq("id", id);
  if (error) throw error;
}
