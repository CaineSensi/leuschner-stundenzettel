// Anfragen-Inbox API. Tabelle `inquiries` enthält Rohtext + strukturierte
// Felder, optional verknüpft mit pipeline_cards (Stage „Anfrage") und
// customers. Status: offen → in_arbeit → wurde_zu_angebot | verworfen.

import { supabase, isBackendConnected } from "./supabase";

export type InquirySource = 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web' | 'other';
export type InquiryStatus = 'offen' | 'in_arbeit' | 'wurde_zu_angebot' | 'verworfen';
export type InquiryPriority = 'niedrig' | 'normal' | 'hoch';

export interface InquiryNote {
  at: string;
  by?: string;
  kind: 'note' | 'status' | 'parse' | 'system';
  text: string;
}

export interface InquiryPhoto {
  path: string;    // Storage-Pfad im entry-photos Bucket
  mime: string;
  name: string;
  width?: number;
  height?: number;
  size?: number;
  type?: 'image' | 'video';   // fehlt = image (Rückwärtskompatibilität)
  at?: string;                 // ISO-Datum aus Dateiname/EXIF
}

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
  notesLog: InquiryNote[];
  priority: InquiryPriority;
  customerId?: string;
  pipelineCardId?: string;
  status: InquiryStatus;
  photos: InquiryPhoto[];
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
  priority?: InquiryPriority;
  customerId?: string;
  photos?: InquiryPhoto[];
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export const SOURCE_ICON: Record<InquirySource, string> = {
  whatsapp: "📱", mail: "✉", phone: "☎", letter: "📮",
  in_person: "🤝", web: "🌐", other: "•"
};
export const SOURCE_LABEL: Record<InquirySource, string> = {
  whatsapp: "WhatsApp", mail: "Mail", phone: "Telefon", letter: "Brief",
  in_person: "Persönlich", web: "Web", other: "Sonstige"
};

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
    notesLog: Array.isArray(r.notes_log) ? r.notes_log : [],
    priority: (r.priority as InquiryPriority) ?? 'normal',
    customerId: r.customer_id ?? undefined,
    pipelineCardId: r.pipeline_card_id ?? undefined,
    status: r.status,
    photos: Array.isArray(r.photos) ? r.photos : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLS = 'id, source, raw_text, parsed_json, customer_name, customer_phone, customer_email, street, zip, city, description, notes, notes_log, priority, customer_id, pipeline_card_id, status, photos, created_at, updated_at';

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

/** Holt die juengste Anfrage, die mit dieser Pipeline-Karte verknuepft ist. */
export async function getInquiryByCardId(cardId: string): Promise<Inquiry | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb
    .from('inquiries')
    .select(COLS)
    .eq('pipeline_card_id', cardId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data ?? [])[0] ? rowToInquiry(data[0]) : null;
}

export async function createInquiry(input: InquiryInput): Promise<Inquiry> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const initialLog: InquiryNote[] = [{
    at: new Date().toISOString(),
    kind: 'system',
    text: `Anfrage angelegt · Quelle ${input.source}`,
  }];
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
      notes_log: initialLog,
      priority: input.priority ?? 'normal',
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
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.parsedJson !== undefined) row.parsed_json = patch.parsedJson;
  if (patch.rawText !== undefined) row.raw_text = patch.rawText;
  if (patch.customerId !== undefined) row.customer_id = patch.customerId;
  if (patch.pipelineCardId !== undefined) row.pipeline_card_id = patch.pipelineCardId;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.notesLog !== undefined) row.notes_log = patch.notesLog;
  const { error } = await sb.from('inquiries').update(row).eq('id', id);
  if (error) throw error;
}

/** Hängt einen Verlauf-Eintrag an `notes_log` an (atomar via fetch+write). */
export async function appendNote(id: string, note: Omit<InquiryNote, 'at'> & { at?: string }): Promise<InquiryNote[]> {
  const current = await getInquiry(id);
  if (!current) throw new Error('Anfrage nicht gefunden');
  const entry: InquiryNote = {
    at: note.at ?? new Date().toISOString(),
    by: note.by,
    kind: note.kind,
    text: note.text,
  };
  const newLog = [...current.notesLog, entry];
  await updateInquiry(id, { notesLog: newLog });
  return newLog;
}

/**
 * Hängt eine Notiz/Info an einen PIPELINE-VORGANG (Karte) an — auch wenn dahinter
 * (noch) keine Anfrage existiert (z.B. direkt angelegte Aufträge wie AN-1243).
 * Gibt es schon eine verknüpfte Anfrage → Notiz dort anhängen. Sonst wird ein
 * schlanker Verlaufs-Träger angelegt (source 'other', status 'wurde_zu_angebot',
 * damit er NICHT als offene Anfrage in der Inbox auftaucht) und mit der Karte verknüpft.
 * Rückgabe: die (ggf. neu angelegte) Anfrage mit aktualisiertem Verlauf.
 */
export async function appendCardNote(
  cardId: string, text: string, by?: string, cardName?: string
): Promise<Inquiry> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const entry: InquiryNote = { at: new Date().toISOString(), by, kind: 'note', text };

  const existing = await getInquiryByCardId(cardId);
  if (existing) {
    const newLog = [...existing.notesLog, entry];
    await updateInquiry(existing.id, { notesLog: newLog });
    return { ...existing, notesLog: newLog };
  }

  const initialLog: InquiryNote[] = [
    { at: new Date().toISOString(), kind: 'system', text: 'Notiz-Verlauf zum Vorgang angelegt' },
    entry,
  ];
  const { data, error } = await sb
    .from('inquiries')
    .insert({
      company_id: COMPANY_ID,
      source: 'other',
      raw_text: '',
      customer_name: cardName ?? null,
      notes_log: initialLog,
      priority: 'normal',
      pipeline_card_id: cardId,
      status: 'wurde_zu_angebot',
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToInquiry(data);
}

/**
 * Speichert/ergänzt KONTAKTDATEN an einem Pipeline-Vorgang (Karte) — auch ohne
 * Anfrage dahinter. Nur übergebene Felder werden gesetzt (undefined = unverändert).
 * Existiert keine Anfrage, wird derselbe schlanke Verlaufs-Träger angelegt wie bei
 * appendCardNote. Rückgabe: die (ggf. neue) Anfrage mit aktualisierten Feldern.
 */
export async function upsertCardContact(
  cardId: string,
  fields: { customerPhone?: string; customerEmail?: string; street?: string; zip?: string; city?: string },
  cardName?: string
): Promise<Inquiry> {
  if (!isBackendConnected() || !supabase) throw new Error('Backend nicht verbunden');
  const sb: any = supabase;
  const clean = <T,>(v: T) => (typeof v === 'string' ? (v.trim() || undefined) : v);
  const patch = {
    customerPhone: clean(fields.customerPhone),
    customerEmail: clean(fields.customerEmail),
    street: clean(fields.street),
    zip: clean(fields.zip),
    city: clean(fields.city),
  };

  const existing = await getInquiryByCardId(cardId);
  if (existing) {
    await updateInquiry(existing.id, patch);
    await appendNote(existing.id, { kind: 'system', text: 'Kontaktdaten manuell ergänzt' });
    const fresh = await getInquiry(existing.id);
    return fresh ?? { ...existing, ...patch };
  }

  const initialLog: InquiryNote[] = [
    { at: new Date().toISOString(), kind: 'system', text: 'Notiz-Verlauf zum Vorgang angelegt' },
    { at: new Date().toISOString(), kind: 'system', text: 'Kontaktdaten manuell erfasst' },
  ];
  const { data, error } = await sb
    .from('inquiries')
    .insert({
      company_id: COMPANY_ID,
      source: 'other',
      raw_text: '',
      customer_name: cardName ?? null,
      customer_phone: patch.customerPhone ?? null,
      customer_email: patch.customerEmail ?? null,
      street: patch.street ?? null,
      zip: patch.zip ?? null,
      city: patch.city ?? null,
      notes_log: initialLog,
      priority: 'normal',
      pipeline_card_id: cardId,
      status: 'wurde_zu_angebot',
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToInquiry(data);
}

/** Helper: gibt's vergleichbare offene Anfrage in den letzten N Tagen? */
export async function findSimilar(rawText: string, days = 7): Promise<Inquiry[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await sb
    .from('inquiries')
    .select(COLS)
    .gte('created_at', since)
    .in('status', ['offen', 'in_arbeit']);
  if (error) return [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const needle = norm(rawText).slice(0, 200);
  return (data ?? [])
    .map(rowToInquiry)
    .filter((i: Inquiry) => {
      const hay = norm(i.rawText).slice(0, 200);
      // sehr simpler Vergleich — gemeinsames Längstes-Substring-Verhältnis
      const min = Math.min(needle.length, hay.length);
      if (min < 30) return false;
      let common = 0;
      for (let len = min; len > 20; len -= 5) {
        for (let start = 0; start + len <= needle.length; start++) {
          if (hay.includes(needle.slice(start, start + len))) { common = len; break; }
        }
        if (common) break;
      }
      return common >= 30;
    });
}

export async function deleteInquiry(id: string): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from('inquiries').delete().eq('id', id);
  if (error) throw error;
}

/** Komprimiert ein Bild (max 1600px, JPEG 0.85) und gibt Blob + Maße zurück. */
async function compressInquiryImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1600;
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas-Kontext fehlt"));
      ctx.drawImage(img, 0, 0, w, h);
      const outType = (file.type === "image/png" || file.type === "image/gif") ? file.type : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("toBlob fehlgeschlagen"));
          resolve({ blob, width: w, height: h });
        },
        outType, 0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild laden fehlgeschlagen")); };
    img.src = url;
  });
}

/** Lädt ein Foto in den entry-photos Bucket unter inquiries/{inquiryId}/ hoch. */
export async function uploadInquiryPhoto(file: File, inquiryId: string): Promise<InquiryPhoto> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const compressed = await compressInquiryImage(file);
  const ext = compressed.blob.type === "image/png" ? "png" : compressed.blob.type === "image/gif" ? "gif" : "jpg";
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${COMPANY_ID}/inquiries/${inquiryId}/${uid}.${ext}`;
  const sb: any = supabase;
  const { error } = await sb.storage.from("entry-photos").upload(path, compressed.blob, {
    contentType: compressed.blob.type,
    upsert: false,
  });
  if (error) throw error;
  return { path, mime: compressed.blob.type, name: file.name, width: compressed.width, height: compressed.height, size: compressed.blob.size };
}

/** Lädt ein Video direkt (ohne Komprimierung) in den entry-photos Bucket hoch. */
export async function uploadInquiryVideo(file: File, inquiryId: string): Promise<InquiryPhoto> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${COMPANY_ID}/inquiries/${inquiryId}/vid-${uid}.${ext}`;
  const sb: any = supabase;
  const { error } = await sb.storage.from("entry-photos").upload(path, file, {
    contentType: file.type || "video/mp4",
    upsert: false,
  });
  if (error) throw error;
  const at = (() => {
    const m = file.name.match(/[-_](\d{8})[-_]/);
    if (!m) return undefined;
    const s = m[1];
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  })();
  return { path, mime: file.type || "video/mp4", name: file.name, size: file.size, type: "video", at };
}

/** Aktualisiert das photos-Array einer Anfrage. */
export async function updateInquiryPhotos(id: string, photos: InquiryPhoto[]): Promise<void> {
  if (!isBackendConnected() || !supabase) return;
  const sb: any = supabase;
  const { error } = await sb.from("inquiries").update({ photos }).eq("id", id);
  if (error) throw error;
}

/** Löscht die Datei eines Anfrage-Mediums aus dem Storage (best effort).
 *  Die Liste selbst wird separat über updateInquiryPhotos aktualisiert. */
export async function deleteInquiryPhotoFile(path: string): Promise<void> {
  if (!isBackendConnected() || !supabase || !path) return;
  const sb: any = supabase;
  try { await sb.storage.from("entry-photos").remove([path]); } catch { /* ignore */ }
}

/** Gibt eine signierte URL für ein Anfrage-Foto zurück (1h gültig). */
export async function inquiryPhotoUrl(path: string): Promise<string | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb.storage.from("entry-photos").createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}
