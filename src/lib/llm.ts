// Wrapper für die Cloudflare-Pages-Function /api/llm/structure.
// Eskalation in der Function: Workers AI (Llama 3.1 8B) → optional Anthropic
// → Heuristik. Frontend muss sich um die Reihenfolge nicht kümmern.

export type Confidence = 'high' | 'medium' | 'low';
export type Vorgang = 'angebot' | 'termin' | 'reklamation' | 'material' | 'sonstiges';

export interface ParsedInquiry {
  // Klassifikation
  vorgang?: Vorgang;

  // Stamm
  customerName?: string;
  firma?: string;
  phone?: string;          // Festnetz
  phone_mobile?: string;   // Mobil/Handy
  email?: string;
  street?: string;
  zip?: string;
  city?: string;

  // Inhalt
  description?: string;
  leistung?: string;
  mengen?: { wert: string; einheit?: string; was?: string }[];
  termin?: string;

  // Meta
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';

  // Vertrauen pro Feld + insgesamt
  confidence?: Partial<Record<string, Confidence>>;

  /** Welcher Pfad hat strukturiert. */
  parser?: 'workers-ai-70b' | 'workers-ai-8b' | 'workers-ai' | 'anthropic' | 'heuristic';

  /** Diagnose-Meta vom Server (Konflikte LLM ↔ Heuristik, Modellname). */
  meta?: {
    conflicts?: { field: string; llm: string; heuristic: string; chosen: string; reason: string }[];
    model?: string;
  };
}

export const VORGANG_LABEL: Record<Vorgang, string> = {
  angebot: 'Angebotsanfrage',
  termin: 'Termin / Rückruf',
  reklamation: 'Reklamation',
  material: 'Materialbestellung',
  sonstiges: 'Sonstiges',
};

/** Farbe pro Vorgangstyp — für Badges in der Inbox. */
export const VORGANG_COLOR: Record<Vorgang, string> = {
  angebot: '#DC6E2D',     // Kupfer (Standard)
  termin: '#1F7A3D',      // Moos (planbar)
  reklamation: '#B91C1C', // Rost (Priorität)
  material: '#6E5023',    // Bronze (Logistik)
  sonstiges: '#6A6E72',   // Steel (neutral)
};

export const PARSER_LABEL: Record<NonNullable<ParsedInquiry['parser']>, string> = {
  'workers-ai-70b': 'Llama 3.3 70B · Cloudflare',
  'workers-ai-8b': 'Llama 3.1 8B · Cloudflare (Fallback)',
  'workers-ai':    'Llama · Cloudflare (Legacy)',
  'anthropic':     'Claude Haiku',
  'heuristic':     'Regex-Heuristik',
};

export async function llmStructure(text: string): Promise<ParsedInquiry> {
  const r = await fetch('/api/llm/structure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`Structure-Call fehlgeschlagen (${r.status})`);
  return (await r.json()) as ParsedInquiry;
}
