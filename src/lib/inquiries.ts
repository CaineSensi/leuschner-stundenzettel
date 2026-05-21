// Anfragen-Inbox API. Tabelle `inquiries` enthält Rohtext + strukturierte
// Felder, optional verknüpft mit pipeline_cards (Stage „Anfrage") und
// customers. Status: offen → in_arbeit → wurde_zu_angebot | verworfen.

import { supabase, isBackendConnected } from "./supabase";

export type InquirySource = 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web' | 'other';
export type InquiryStatus = 'offen' | 'in_arbeit' | 'wurde_zu_angebot' | 'verworfen';

export interface Inquiry {
  id: string;
  source: InquirySource;
  rawText: string;
  parsedJson?: any;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  street?: string;
  zip?: string;
  city?: string;
  description?: string;
  notes?: string;
  customerId?: string;
  pipelineCardId?: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryInput {
  source: InquirySource;
  rawText: string;
  parsedJson?: any;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  street?: string;
  zip?: string;
  city?: string;
  description?: string;
  notes?: string;
  customerId?: string;
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

function rowToInquiry(r: any): Inquiry {
  return {
    id: r.id,
    source: r.source,
    rawText: r.raw_text,
    parsedJson: r.parsed_json ?? undefined,
    customerName: r.customer_name ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    street: r.street ?? undefined,
    zip: r.zip ?? undefined,
    city: r.city ?? undefined,
    description: r.description ?? undefined,
    notes: r.notes ?? undefined,
    customerId: r.customer_id ?? undefined,
    pipelineCardId: r.pipeline_card_id ?? undefined,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLS = 'id, source, raw_text, parsed_json, customer_name, customer_phone, customer_email, street, zip, city, description, notes, customer_id, pipeline_card_id, status, created_at, updated_at';

export async function listInquiries(opts: { onlyOpen?: boolean } = {}): Promise<Inquiry[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  let q = sb.from('inquiries').select(COLS).eq('company_id', COMPANY_ID).order('created_at', { ascending: false });
  if (opts.onlyOpen) q = q.in('status', ['offen', 'in_arbeit']);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToInquiry);
}

export async function getInquiry(id: string): Promise<Inquiry | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb.from('inquiries').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToInquiry(data) : null;
}

export async function createInquiry(input: InquiryInput): Promise<Inquiry> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const { data, error } = await sb
    .from('inquiries')
    .insert({
      company_id: COMPANY_ID,
      source: input.source,
      raw_text: input.rawText,
      parsed_json: input.parsedJson ?? null,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_email: input.customerEmail ?? null,
      street: input.street ?? null,
      zip: input.zip ?? null,
      city: input.city ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      customer_id: input.customerId ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToInquiry(data);
}

export async function updateInquiry(id: string, patch: Partial<Inquiry>): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const row: Record<string, any> = {};
  if (patch.customerName !== undefined) row.customer_name = patch.customerName;
  if (patch.customerPhone !== undefined) row.customer_phone = patch.customerPhone;
  if (patch.customerEmail !== undefined) row.customer_email = patch.customerEmail;
  if (patch.street !== undefined) row.street = patch.street;
  if (patch.zip !== undefined) row.zip = patch.zip;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.customerId !== undefined) row.customer_id = patch.customerId;
  if (patch.pipelineCardId !== undefined) row.pipeline_card_id = patch.pipelineCardId;
  if (patch.status !== undefined) row.status = patch.status;
  const { error } = await sb.from('inquiries').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteInquiry(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from('inquiries').delete().eq('id', id);
  if (error) throw error;
}
