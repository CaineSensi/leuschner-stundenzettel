import { supabase, isBackendConnected } from './supabase';
import type { LvPosition, LvPositionInput } from './types';

function requireBackend(): NonNullable<typeof supabase> {
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlt).");
  }
  return supabase;
}

export const LV_CAT_ORDER = ['ERD', 'PFL', 'GTN', 'ZAU', 'VWG', 'UMZ', 'SON', 'ERR'] as const;

export const LV_CATEGORIES: Record<string, { label: string }> = {
  ERD: { label: 'Erdarbeiten' },
  PFL: { label: 'Pflasterarbeiten' },
  GTN: { label: 'Gartenarbeiten' },
  ZAU: { label: 'Zaunarbeiten' },
  VWG: { label: 'Verwaltung' },
  UMZ: { label: 'Umzug' },
  SON: { label: 'Sonstige' },
  ERR: { label: 'Zulagen' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPosition(r: any): LvPosition {
  return {
    id:         r.id,
    companyId:  r.company_id,
    cat:        r.cat,
    name:       r.name,
    price:      r.price    != null ? Number(r.price)     : null,
    priceMin:   r.price_min != null ? Number(r.price_min) : null,
    priceMax:   r.price_max != null ? Number(r.price_max) : null,
    unit:       r.unit ?? null,
    surcharge:  r.surcharge ?? null,
    shortText:  r.short_text ?? null,
    longText:   r.long_text ?? null,
    zulagen:    r.zulagen ?? [],
    usedCount:  r.used_count ?? 0,
    lastUsed:   r.last_used ?? null,
    archivedAt: r.archived_at ?? null,
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  };
}

export async function listLvPositions(): Promise<LvPosition[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('lv_positions')
    .select('*')
    .is('archived_at', null)
    .order('cat')
    .order('id');
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => rowToPosition(r));
}

export async function createLvPosition(input: LvPositionInput): Promise<LvPosition> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data: { user } } = await sb.auth.getUser();
  const { data: w, error: we } = await sb
    .from('workers')
    .select('company_id')
    .eq('auth_user_id', user.id)
    .single();
  if (we) throw we;
  const { data, error } = await sb.from('lv_positions').insert({
    id:         input.id.trim().toUpperCase(),
    company_id: w.company_id,
    cat:        input.cat,
    name:       input.name.trim(),
    price:      input.price ?? null,
    unit:       input.unit?.trim() ?? null,
    surcharge:  input.surcharge?.trim() ?? null,
    short_text: input.shortText?.trim() ?? null,
    long_text:  input.longText?.trim() ?? null,
    zulagen:    input.zulagen ?? [],
  }).select('*').single();
  if (error) throw error;
  return rowToPosition(data);
}

export async function updateLvPosition(id: string, patch: Partial<LvPositionInput>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = { updated_at: new Date().toISOString() };
  if (patch.name      !== undefined) row.name       = patch.name.trim();
  if (patch.cat       !== undefined) row.cat        = patch.cat;
  if (patch.price     !== undefined) row.price      = patch.price;
  if (patch.unit      !== undefined) row.unit       = patch.unit?.trim();
  if (patch.surcharge !== undefined) row.surcharge  = patch.surcharge?.trim();
  if (patch.shortText !== undefined) row.short_text = patch.shortText?.trim();
  if (patch.longText  !== undefined) row.long_text  = patch.longText?.trim();
  if (patch.zulagen   !== undefined) row.zulagen    = patch.zulagen;
  const { error } = await sb.from('lv_positions').update(row).eq('id', id);
  if (error) throw error;
}

export async function archiveLvPosition(id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { error } = await sb
    .from('lv_positions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

function fmtNum(n: number): string {
  return n % 1 === 0 ? `${n}` : n.toFixed(2).replace('.', ',');
}

export function priceStr(p: LvPosition): string {
  if (p.surcharge) return p.surcharge;
  if (p.price === null && p.priceMin === null) return '–';
  const unit = p.unit ? `/${p.unit}` : '';
  if (p.priceMin !== null && p.priceMax !== null && p.priceMin !== p.priceMax) {
    return `${fmtNum(p.priceMin)}–${fmtNum(p.priceMax)} €${unit}`;
  }
  const val = p.price ?? p.priceMin ?? 0;
  return `${fmtNum(val)} €${unit}`;
}
