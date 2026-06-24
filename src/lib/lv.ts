import { supabase, isBackendConnected } from './supabase';
import type { LvPosition, LvPositionInput } from './types';

function requireBackend(): NonNullable<typeof supabase> {
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlt).");
  }
  return supabase;
}

// MAT seit 19.06.2026: Material-/Liefer-Positionen separat von den Arbeit-Cats.
// Werden über Auflagen mit den Arbeit-Positionen verknüpft (z.B. ERD-108
// „Mutterboden einbauen" → MAT-/SON-XXX „Mutterboden gesiebt liefern").
export const LV_CAT_ORDER = ['ERD', 'PFL', 'GTN', 'ZAU', 'VWG', 'UMZ', 'SON', 'MAT', 'ERR'] as const;

export const LV_CATEGORIES: Record<string, { label: string }> = {
  ERD: { label: 'Erdarbeiten' },
  PFL: { label: 'Pflasterarbeiten' },
  GTN: { label: 'Gartenarbeiten' },
  ZAU: { label: 'Zaunarbeiten' },
  VWG: { label: 'Verwaltung' },
  UMZ: { label: 'Umzug' },
  SON: { label: 'Sonstige' },
  MAT: { label: 'Material' },
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

/* ====================================================================
 * Aliases · Master-Merger (16.06.2026)
 *   alias_id  → master_id (siehe public.lv_position_aliases)
 *   Wenn jemand eine alte ID („ERD-138") sucht, wird automatisch der
 *   Master („ERD-100") geliefert.
 * ==================================================================== */

export interface LvAlias {
  aliasId:   string;
  masterId:  string;
  reason:    string | null;
  createdAt: string;
}

/** Alle Aliasse der eigenen Company. Form: aliasId → masterId. */
export async function listAliases(): Promise<LvAlias[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('lv_position_aliases')
    .select('alias_id, master_id, reason, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    aliasId: r.alias_id, masterId: r.master_id, reason: r.reason, createdAt: r.created_at,
  }));
}

/** Lookup-Map alias_id → master_id (für Frontend-Resolves). */
export async function getAliasMap(): Promise<Map<string, string>> {
  const rows = await listAliases();
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.aliasId, r.masterId);
  return m;
}

/** Alle Aliasse, die auf ein bestimmtes Master verweisen. */
export function aliasesOf(masterId: string, all: LvAlias[]): string[] {
  return all.filter((a) => a.masterId === masterId).map((a) => a.aliasId);
}

/** Resolvet eine LV-ID: wenn Alias bekannt → Master, sonst Original. */
export function resolveLvId(maybeAlias: string, map: Map<string, string>): string {
  return map.get(maybeAlias) ?? maybeAlias;
}

/** Mergt eine Position in einen Master: archiviert die Position weich,
 *  legt einen Alias-Eintrag an, hebt den Master-Preis auf MAX falls die
 *  archivierte Position teurer war (Rick-Regel: „immer höchsten Preis"). */
export async function mergePositionIntoMaster(
  aliasId: string, masterId: string, reason?: string,
): Promise<void> {
  if (aliasId === masterId) throw new Error('Alias und Master dürfen nicht identisch sein.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;

  // 1) Beide Positionen laden (Preisvergleich + company_id)
  const { data: rows, error: re } = await sb
    .from('lv_positions')
    .select('id, price, company_id, archived_at')
    .in('id', [aliasId, masterId]);
  if (re) throw re;
  const alias = rows.find((r: { id: string }) => r.id === aliasId);
  const master = rows.find((r: { id: string }) => r.id === masterId);
  if (!alias) throw new Error(`Position ${aliasId} existiert nicht.`);
  if (!master) throw new Error(`Master ${masterId} existiert nicht.`);
  if (master.archived_at) throw new Error(`Master ${masterId} ist archiviert.`);

  // 2) Master-Preis auf MAX heben (wenn Alias teurer)
  const aliasPrice  = alias.price  != null ? Number(alias.price)  : null;
  const masterPrice = master.price != null ? Number(master.price) : null;
  if (aliasPrice != null && (masterPrice == null || aliasPrice > masterPrice)) {
    const { error: pe } = await sb.from('lv_positions')
      .update({ price: aliasPrice, updated_at: new Date().toISOString() })
      .eq('id', masterId);
    if (pe) throw pe;
  }

  // 3) Alias archivieren
  if (!alias.archived_at) {
    const { error: ae } = await sb.from('lv_positions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', aliasId);
    if (ae) throw ae;
  }

  // 4) Alias-Eintrag schreiben
  const { error: ie } = await sb.from('lv_position_aliases').insert({
    alias_id: aliasId,
    master_id: masterId,
    company_id: master.company_id,
    reason: reason ?? 'manuell gemergt',
  });
  if (ie && ie.code !== '23505') throw ie; // 23505 = unique_violation (alias schon da → ignorieren)
}

/** Entfernt einen Alias-Eintrag und entarchiviert die alte Position
 *  (Rückgängig-Funktion für versehentliche Merges). */
export async function unmergePosition(aliasId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { error: de } = await sb.from('lv_position_aliases').delete().eq('alias_id', aliasId);
  if (de) throw de;
  const { error: ue } = await sb.from('lv_positions')
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq('id', aliasId);
  if (ue) throw ue;
}

/* ====================================================================
 * Preis-Historie (16.06.2026)
 *   Automatischer Trigger-Log in public.lv_price_history.
 * ==================================================================== */

export interface LvPriceHistoryEntry {
  id:        number;
  lvId:      string;
  oldPrice:  number | null;
  newPrice:  number | null;
  changedAt: string;
  reason:    string | null;
}

export async function getPriceHistory(lvId: string): Promise<LvPriceHistoryEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('lv_price_history')
    .select('id, lv_id, old_price, new_price, changed_at, reason')
    .eq('lv_id', lvId)
    .order('changed_at', { ascending: false });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, lvId: r.lv_id,
    oldPrice: r.old_price != null ? Number(r.old_price) : null,
    newPrice: r.new_price != null ? Number(r.new_price) : null,
    changedAt: r.changed_at, reason: r.reason,
  }));
}

/* ====================================================================
 * Used-By · welche Anfragen referenzieren diese Position?
 *   Heuristik via name-match in pipeline_cards.positions (jsonb).
 *   Liefert nur die Anzahl — Details bei Bedarf nachladen.
 * ==================================================================== */

export interface LvUsageEntry {
  cardId:       string;
  docNumber:    string | null;
  customerName: string;
  positionName: string;
  stage:        string;
}

/** Map<lv_id, usage_count> für alle aktiven LV-Positionen einer Company.
 *  Implementierung: ein Round-Trip, lädt alle pipeline_cards.positions
 *  und matcht im Frontend (kein RPC nötig). Für ~250 Karten OK. */
export async function getUsageCounts(positions: LvPosition[]): Promise<Map<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('pipeline_cards')
    .select('positions');
  if (error) throw error;
  const counts = new Map<string, number>();
  const lvByLower = new Map<string, string>();
  for (const p of positions) lvByLower.set(p.name.trim().toLowerCase(), p.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const pos = Array.isArray(row.positions) ? row.positions : [];
    for (const it of pos) {
      const n = String(it?.name ?? '').trim().toLowerCase();
      if (!n) continue;
      // Exakt-Match auf LV-Name (häufigster Fall — sevDesk-Sync übernimmt Name 1:1)
      const exact = lvByLower.get(n);
      if (exact) {
        counts.set(exact, (counts.get(exact) ?? 0) + 1);
        continue;
      }
      // Substring-Match: LV-Name als Teil des Position-Namens
      for (const [lvLower, lvId] of lvByLower) {
        if (lvLower.length > 8 && n.includes(lvLower)) {
          counts.set(lvId, (counts.get(lvId) ?? 0) + 1);
          break;
        }
      }
    }
  }
  return counts;
}

/* ====================================================================
 * Auflagen-Optionen pro Hauptposition (19.06.2026)
 *   Konzept: „Oberboden abtragen" (Haupt) + anhängbare Auflagen
 *   wie lagern/entsorgen/austauschen/kultivieren, die je nach Anwahl
 *   eine Folge-LV-Position automatisch ins Angebot ergänzen.
 * ==================================================================== */

export interface LvPositionOption {
  id:            number;
  baseLvId:      string;
  key:           string;          // 'lagern' | 'entsorgen' | …
  label:         string;
  followLvId:    string | null;   // optional: LV-ID der Folge-Position
  qtyFormula:    string | null;   // Hinweis welche Menge gerechnet wird
  defaultActive: boolean;
  displayOrder:  number;
  info:          string | null;
  createdAt:     string;
  updatedAt:     string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToOption(r: any): LvPositionOption {
  return {
    id:            r.id,
    baseLvId:      r.base_lv_id,
    key:           r.key,
    label:         r.label,
    followLvId:    r.follow_lv_id,
    qtyFormula:    r.qty_formula,
    defaultActive: !!r.default_active,
    displayOrder:  r.display_order,
    info:          r.info,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  };
}

/** Alle Auflagen, gruppierbar nach baseLvId. Ein Round-Trip — Aufrufer
 *  kann daraus eine Map<baseLvId, options[]> bauen. */
export async function listLvOptions(): Promise<LvPositionOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('lv_position_options')
    .select('*')
    .order('base_lv_id')
    .order('display_order');
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => rowToOption(r));
}

/** Auflagen für eine konkrete Hauptposition. */
export async function listOptionsFor(baseLvId: string): Promise<LvPositionOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('lv_position_options')
    .select('*')
    .eq('base_lv_id', baseLvId)
    .order('display_order');
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => rowToOption(r));
}

export interface LvOptionInput {
  baseLvId:      string;
  key:           string;
  label:         string;
  followLvId?:   string | null;
  qtyFormula?:   string | null;
  defaultActive?: boolean;
  displayOrder?: number;
  info?:         string | null;
}

export async function addLvOption(input: LvOptionInput): Promise<LvPositionOption> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  // company_id wird über den Master gezogen
  const { data: base, error: be } = await sb
    .from('lv_positions')
    .select('company_id')
    .eq('id', input.baseLvId)
    .single();
  if (be) throw be;
  const { data, error } = await sb.from('lv_position_options').insert({
    base_lv_id:    input.baseLvId,
    key:           input.key.trim().toLowerCase(),
    label:         input.label.trim(),
    follow_lv_id:  input.followLvId ?? null,
    qty_formula:   input.qtyFormula ?? null,
    default_active: input.defaultActive ?? false,
    display_order: input.displayOrder ?? 100,
    info:          input.info ?? null,
    company_id:    base.company_id,
  }).select('*').single();
  if (error) throw error;
  return rowToOption(data);
}

export async function updateLvOption(id: number, patch: Partial<LvOptionInput>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {};
  if (patch.label         !== undefined) row.label          = patch.label.trim();
  if (patch.followLvId    !== undefined) row.follow_lv_id   = patch.followLvId;
  if (patch.qtyFormula    !== undefined) row.qty_formula    = patch.qtyFormula;
  if (patch.defaultActive !== undefined) row.default_active = patch.defaultActive;
  if (patch.displayOrder  !== undefined) row.display_order  = patch.displayOrder;
  if (patch.info          !== undefined) row.info           = patch.info;
  const { error } = await sb.from('lv_position_options').update(row).eq('id', id);
  if (error) throw error;
}

export async function removeLvOption(id: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { error } = await sb.from('lv_position_options').delete().eq('id', id);
  if (error) throw error;
}

/** Convenience: Map<baseLvId, options[]> — fürs Frontend zur schnellen Anzeige. */
export function groupOptionsByBase(opts: LvPositionOption[]): Map<string, LvPositionOption[]> {
  const m = new Map<string, LvPositionOption[]>();
  for (const o of opts) {
    const arr = m.get(o.baseLvId) ?? [];
    arr.push(o);
    m.set(o.baseLvId, arr);
  }
  return m;
}

/** Details der Anfragen, die eine bestimmte Position referenzieren (Drill-Down). */
export async function getUsageDetail(lvId: string, positions: LvPosition[]): Promise<LvUsageEntry[]> {
  const target = positions.find((p) => p.id === lvId);
  if (!target) return [];
  const tn = target.name.trim().toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = requireBackend() as any;
  const { data, error } = await sb
    .from('pipeline_cards')
    .select('id, doc_number, customer_name, stage, positions');
  if (error) throw error;
  const out: LvUsageEntry[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const pos = Array.isArray(row.positions) ? row.positions : [];
    for (const it of pos) {
      const n = String(it?.name ?? '').trim().toLowerCase();
      if (!n) continue;
      if (n === tn || (tn.length > 8 && n.includes(tn))) {
        out.push({
          cardId: row.id,
          docNumber: row.doc_number,
          customerName: row.customer_name,
          positionName: it.name,
          stage: row.stage,
        });
        break;
      }
    }
  }
  return out;
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
