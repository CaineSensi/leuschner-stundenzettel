// Garten-Skizzen pro Baustelle. Speichert den JSON-Stand des Editors in
// `site_sketches` (eine Skizze je Baustelle, Upsert über site_id). Schreiben
// läuft über den authentifizierten Supabase-Client (RLS: Admin der Company).

import { supabase, isBackendConnected } from "./supabase";

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export interface SiteSketch {
  id: string;
  siteId?: string;
  title?: string;
  data: any;
  updatedAt: string;
}

export async function getSketchForSite(siteId: string): Promise<SiteSketch | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb
    .from('site_sketches')
    .select('id, site_id, title, data, updated_at')
    .eq('site_id', siteId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: data.id, siteId: data.site_id ?? undefined, title: data.title ?? undefined, data: data.data, updatedAt: data.updated_at }
    : null;
}

export async function saveSketchForSite(siteId: string, data: any, title?: string): Promise<void> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const { error } = await sb
    .from('site_sketches')
    .upsert(
      {
        company_id: COMPANY_ID,
        site_id: siteId,
        title: title ?? null,
        data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_id' }
    );
  if (error) throw error;
}

/** Name einer Baustelle (für den Editor-Titel). */
export async function getSiteName(siteId: string): Promise<string | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb.from('sites').select('name').eq('id', siteId).maybeSingle();
  if (error) throw error;
  return data?.name ?? null;
}
