// Wrapper für die Cloudflare-Pages-Function /api/llm/structure.
// Ohne ANTHROPIC_API_KEY-Secret läuft die Function auf Heuristik-Parser
// (Regex für Mail/Telefon/PLZ/Stadt). Beide liefern dasselbe Schema.

export interface ParsedInquiry {
  customerName?: string;
  phone?: string;
  email?: string;
  street?: string;
  zip?: string;
  city?: string;
  description?: string;
  leistung?: string;
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  mengen?: { wert: string; einheit?: string; was?: string }[];
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';
  parser?: 'anthropic' | 'heuristic';
}

export async function llmStructure(text: string): Promise<ParsedInquiry> {
  const r = await fetch('/api/llm/structure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`Structure-Call fehlgeschlagen (${r.status})`);
  return (await r.json()) as ParsedInquiry;
}
