// Kunden-Stamm: gelistet aus der customers-Tabelle (spiegelt sevDesk-Contacts).
// Fuzzy-Suche per Name / Telefon / E-Mail für das Match-Picker-UI bei
// Anfrage-Anlage. Anlage in der App geht parallel via sevdeskCreateContact()
// in lib/sevdesk.ts, weil sevDesk die führende Quelle bleibt.

import { supabase, isBackendConnected } from "./supabase";

export interface Customer {
  id: string;
  sevdeskContactId?: string;
  customerNumber?: string;
  name: string;
  surename?: string;
  familyname?: string;
  isCompany: boolean;
  email?: string;
  phone?: string;
  street?: string;
  zip?: string;
  city?: string;
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

/** Praefix fuer synthetische IDs von sevDesk-Kontakten, die (noch) keinen
 *  Spiegel-Datensatz in der App-customers-Tabelle haben. So bleibt im
 *  Match-Picker und im Speichern klar: dieser Treffer existiert bereits in
 *  sevDesk, muss aber lokal noch angelegt (gespiegelt) werden — und es darf
 *  KEIN neuer sevDesk-Contact entstehen. */
export const SEVDESK_ID_PREFIX = 'sevdesk:';
export function isSevdeskOnly(c: Customer): boolean {
  return c.id.startsWith(SEVDESK_ID_PREFIX);
}

/** Mischt App-Stammkunden mit live aus sevDesk geladenen Kontakten zu einer
 *  einzigen Trefferliste. Kontakte, die bereits lokal gespiegelt sind (gleiche
 *  sevdesk_contact_id), werden NICHT doppelt aufgenommen — der lokale
 *  Datensatz gewinnt, weil er die echte customers.id fuers Verknuepfen traegt. */
export function mergeCandidates(local: Customer[], sevdesk: Customer[]): Customer[] {
  const mirrored = new Set(
    local.map((c) => c.sevdeskContactId).filter(Boolean) as string[],
  );
  const extra = sevdesk.filter(
    (s) => !s.sevdeskContactId || !mirrored.has(s.sevdeskContactId),
  );
  return [...local, ...extra];
}

function rowToCustomer(r: any): Customer {
  return {
    id: r.id,
    sevdeskContactId: r.sevdesk_contact_id ?? undefined,
    customerNumber: r.customer_number ?? undefined,
    name: r.name,
    surename: r.surename ?? undefined,
    familyname: r.familyname ?? undefined,
    isCompany: !!r.is_company,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    street: r.street ?? undefined,
    zip: r.zip ?? undefined,
    city: r.city ?? undefined,
  };
}

const COLS = 'id, sevdesk_contact_id, customer_number, name, surename, familyname, is_company, email, phone, street, zip, city';

/** Lädt alle Kunden (für lokales Fuzzy-Matching). Skala: 32 Stück — kein Problem. */
export async function listCustomers(): Promise<Customer[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from('customers')
    .select(COLS)
    .eq('company_id', COMPANY_ID)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(rowToCustomer);
}

// ── Normalisierungs-Helfer fuer robustes Namens-Matching ──────────────────
// Deutsche Umlaute falten, Anreden/Rechtsform-Rauschen entfernen, Partikel
// (de/van/von …) als nicht-diskriminierende Tokens behandeln. Dadurch matcht
// "Herr de Haan" zuverlaessig auf den Stammkunden "Marco De Haan".

const SALUTATION_RE = /\b(herrn?|frau|familie|fam|hr|fr|firma|fa)\b\.?/g;
/** Partikel + Rechtsformen, die als Einzel-Token nicht unterscheiden. */
const PARTICLE = new Set([
  'de', 'van', 'von', 'der', 'den', 'ter', 'el', 'la', 'le', 'di', 'da', 'do', 'und',
  'gmbh', 'ug', 'ohg', 'gbr', 'kg', 'ek', 'ag', 'co', 'mbh', 'eg',
]);

function foldUmlauts(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

function normName(s?: string): string {
  // toLowerCase + Umlaute falten, Anreden raus, dann auf [a-z0-9 ] reduzieren
  // (entfernt zugleich etwaige restliche Akzente/Sonderzeichen).
  return foldUmlauts((s ?? '').toLowerCase())
    .replace(SALUTATION_RE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(s?: string): string[] {
  return normName(s).split(' ').filter((t) => t.length >= 2 && !PARTICLE.has(t));
}

/** Levenshtein-Distanz (klein, fuer Tippfehler-Toleranz auf Nachnamen). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

const onlyDigits = (s?: string) => (s ?? '').replace(/\D/g, '');

/** Sucht passende Kunden zu Name/E-Mail/Telefon — Score 0–100 pro Treffer.
 *  Harte Anker (E-Mail/Telefon) dominieren; Namens-Scoring ist gegen Anreden,
 *  Umlaut-Schreibweisen, Partikel und Tippfehler abgehaertet. */
export interface CustomerMatch { customer: Customer; score: number; reason: string[]; hardAnchor: boolean }
export function matchCustomers(
  all: Customer[],
  needle: { name?: string; email?: string; phone?: string },
  limit = 5,
): CustomerMatch[] {
  const e = (needle.email ?? '').trim().toLowerCase();
  const pTail = onlyDigits(needle.phone).slice(-7);
  const nNorm = normName(needle.name);
  const nTokens = nameTokens(needle.name);
  const nSet = new Set(nTokens);

  const out: CustomerMatch[] = [];
  for (const c of all) {
    let score = 0;
    let hardAnchor = false;
    const reason: string[] = [];

    if (e && c.email && c.email.trim().toLowerCase() === e) {
      score += 70; hardAnchor = true; reason.push('E-Mail exakt');
    }
    if (pTail.length === 7 && onlyDigits(c.phone).slice(-7) === pTail) {
      score += 60; hardAnchor = true; reason.push('Telefon');
    }

    if (nTokens.length) {
      const cNorm = normName(c.name);
      const cTokens = nameTokens(c.name);
      const cSet = new Set(cTokens);
      const familyTokens = nameTokens(c.familyname);

      let nameScore = 0;
      if (cNorm && cNorm === nNorm) {
        nameScore = 80; reason.push('Name exakt'); hardAnchor = true;
      } else if (familyTokens.length && familyTokens.every((t) => nSet.has(t))) {
        // Alle Nachname-Tokens kommen in der Anfrage vor → starker Treffer
        nameScore = 58; reason.push('Nachname-Treffer'); hardAnchor = true;
      } else if (cNorm && nNorm && (cNorm.includes(nNorm) || nNorm.includes(cNorm))) {
        nameScore = 40; reason.push('Name enthält');
      } else {
        // Token-Overlap (Jaccard) + Tippfehler-Toleranz auf laengstem Token
        let common = 0;
        cSet.forEach((t) => { if (nSet.has(t)) common++; });
        const union = new Set([...cSet, ...nSet]).size || 1;
        if (common) {
          nameScore = Math.round(45 * common / union);
          reason.push(`Token-Overlap ${common}`);
        }
        // Fuzzy-Nachname: ein Anfrage-Token liegt 1 Edit vom Nachnamen entfernt
        const fam = familyTokens[familyTokens.length - 1];
        if (fam && fam.length >= 4) {
          const near = nTokens.some((t) => t.length >= 4 && levenshtein(t, fam) <= 1);
          if (near && nameScore < 45) { nameScore = Math.max(nameScore, 45); reason.push('Nachname ~'); }
        }
      }
      score += nameScore;
    }

    if (score > 0) out.push({ customer: c, score, reason, hardAnchor });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Liefert den Top-Treffer nur, wenn er sicher genug fuer eine automatische
 *  Verknuepfung ist: harter Anker (E-Mail/Telefon/exakter Name/Nachname) UND
 *  klarer Abstand zum Zweitplatzierten — sonst null (nur Vorschlag zeigen). */
export function bestConfidentMatch(matches: CustomerMatch[]): CustomerMatch | null {
  const top = matches[0];
  if (!top || !top.hardAnchor) return null;
  if (top.score >= 80) return top;
  const runnerUp = matches[1]?.score ?? 0;
  if (top.score >= 55 && top.score - runnerUp >= 20) return top;
  return null;
}

/** Sucht einen existierenden Kunden anhand harter Anker (sevdesk_contact_id,
 *  email, oder telefon-letzte-7). Vermeidet Duplikate beim Anlegen aus
 *  Anfragen, wenn der Kontakt schon aus einer früheren Mail/Telefonat im
 *  Stamm existiert. Gibt den ERSTEN exakten Treffer zurück (oder null). */
export async function findExistingCustomer(needle: {
  sevdeskContactId?: string;
  email?: string;
  phone?: string;
}): Promise<Customer | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const filters: string[] = [];
  if (needle.sevdeskContactId) filters.push(`sevdesk_contact_id.eq.${needle.sevdeskContactId}`);
  if (needle.email) filters.push(`email.eq.${needle.email.toLowerCase().trim()}`);
  if (filters.length === 0 && !needle.phone) return null;
  let q = sb.from('customers').select(COLS).eq('company_id', COMPANY_ID).limit(1);
  if (filters.length === 1) {
    // Single-Filter direkt anwenden (eq.<value>)
    const [f, ...rest] = filters[0].split('.');
    q = q.eq(f, rest.slice(1).join('.'));
  } else if (filters.length > 1) {
    q = q.or(filters.join(','));
  }
  const { data, error } = await q;
  if (error) return null;
  let match = (data ?? [])[0] as any;
  if (!match && needle.phone) {
    // Letzter Versuch: phone-letzte-7 (lokaler Vergleich, weil PostgREST
    // kein right()-Filter über REST anbietet)
    const tail7 = needle.phone.replace(/\D/g, '').slice(-7);
    if (tail7.length >= 7) {
      const all = await listCustomers();
      match = all.find((c) => (c.phone ?? '').replace(/\D/g, '').endsWith(tail7));
    }
  }
  return match ? rowToCustomer(match as any) : null;
}

/** Legt einen Kunden in der App-DB an (nachdem sevDesk-Anlage erfolgte). */
export async function createCustomerLocal(input: {
  sevdeskContactId?: string;
  customerNumber?: string;
  name: string;
  surename?: string;
  familyname?: string;
  isCompany?: boolean;
  email?: string;
  phone?: string;
  street?: string;
  zip?: string;
  city?: string;
}): Promise<Customer> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const { data, error } = await sb
    .from('customers')
    .insert({
      company_id: COMPANY_ID,
      sevdesk_contact_id: input.sevdeskContactId ?? null,
      customer_number: input.customerNumber ?? null,
      name: input.name,
      surename: input.surename ?? null,
      familyname: input.familyname ?? null,
      is_company: !!input.isCompany,
      email: input.email ?? null,
      phone: input.phone ?? null,
      street: input.street ?? null,
      zip: input.zip ?? null,
      city: input.city ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToCustomer(data);
}
