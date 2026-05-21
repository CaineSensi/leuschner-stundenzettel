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

/** Sucht passende Kunden zu Name/E-Mail/Telefon — Score 0–100 pro Treffer. */
export interface CustomerMatch { customer: Customer; score: number; reason: string[] }
export function matchCustomers(
  all: Customer[],
  needle: { name?: string; email?: string; phone?: string },
  limit = 5,
): CustomerMatch[] {
  const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const onlyDigits = (s?: string) => (s ?? '').replace(/\D/g, '');
  const n = norm(needle.name);
  const e = norm(needle.email);
  const p = onlyDigits(needle.phone);

  const out: CustomerMatch[] = [];
  for (const c of all) {
    let score = 0;
    const reason: string[] = [];

    if (e && norm(c.email) && norm(c.email) === e) { score += 70; reason.push('E-Mail exakt'); }
    if (p && onlyDigits(c.phone) && onlyDigits(c.phone).slice(-7) === p.slice(-7)) {
      score += 60; reason.push('Telefon (letzte 7 Stellen)');
    }
    if (n) {
      const cn = norm(c.name);
      if (cn === n) { score += 80; reason.push('Name exakt'); }
      else if (cn.includes(n) || n.includes(cn)) { score += 35; reason.push('Name enthält'); }
      else {
        // Token-Overlap
        const nt = new Set(n.split(' ').filter((t) => t.length >= 3));
        const ct = new Set(cn.split(' ').filter((t) => t.length >= 3));
        let common = 0;
        nt.forEach((t) => { if (ct.has(t)) common++; });
        if (common && nt.size) { score += Math.round(20 * common / nt.size); reason.push(`Token-Overlap ${common}/${nt.size}`); }
      }
    }
    if (score > 0) out.push({ customer: c, score, reason });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
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
