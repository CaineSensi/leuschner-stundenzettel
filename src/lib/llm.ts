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
  /** Legacy / Backwards-Compat (= leistungen[0]?.name). */
  leistung?: string;
  /** M8/M12: Mehrere Gewerke pro Anfrage, jedes mit eigenen Mengen und
   *  konkret benannten Material-Wünschen (Farbe/Qualität/Material-Art/Spec). */
  leistungen?: {
    name: string;
    mengen?: { wert: string; einheit?: string; was?: string }[];
    materialien?: { name: string; spec?: string; menge?: { wert: string; einheit?: string }; note?: string }[];
    /** M14: wörtliche Originaltext-Zitate, die diese Leistung belegen. */
    source_quotes?: string[];
  }[];
  mengen?: { wert: string; einheit?: string; was?: string }[];
  termin?: string;

  // Meta
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';

  // Vertrauen pro Feld + insgesamt
  confidence?: Partial<Record<string, Confidence>>;

  /** Welcher Pfad hat strukturiert. */
  parser?: 'gemini' | 'workers-ai-70b' | 'workers-ai-8b' | 'workers-ai' | 'anthropic' | 'heuristic';

  /** Diagnose-Meta vom Server (Konflikte LLM ↔ Heuristik, Modellname,
   *  Pre-Cleaning-Schritte, Self-Check-Hinweise). */
  meta?: {
    conflicts?: { field: string; llm: string; heuristic: string; chosen: string; reason: string }[];
    model?: string;
    preclean?: {
      applied: string[];
      shrunkBy: number;
      headers?: { from?: string; to?: string; subject?: string; date?: string };
    };
    review_hints?: { missing?: string[]; potentially_wrong?: string[]; note?: string };
    /** Flächen-Plausibilität: Teilflächen ergeben nicht die genannte Gesamtfläche. */
    flaechen_check?: { gesamt: number; zugeordnet: number; differenz: number; hinweis: string };
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
  'gemini':        'Gemini Flash · Google',
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

/* ──────────────────────────────────────────────────────────────────────
   M13 · SSE-Streaming-Variante
   ────────────────────────────────────────────────────────────────────── */

export type StepStatus = 'start' | 'done' | 'skipped';

export interface StreamStep {
  id: string;              // 'preclean' | 'heuristik' | 'llm' | 'crossvalidate' | 'selfcheck' | 'done'
  status: StepStatus;
  ms: number;              // Millisekunden seit Beginn
  info?: string;           // kurze Erklärung
  model?: string;          // bei 'llm': Modellname
  applied?: string[];      // bei 'preclean': angewendete Schritte
  shrunkBy?: number;
  totalMs?: number;
  path?: string;
}

export type StreamEvent =
  | { kind: 'step'; step: StreamStep }
  | { kind: 'result'; parsed: ParsedInquiry }
  | { kind: 'error'; message: string };

/** Streamt die Strukturierung Schritt für Schritt. `onEvent` wird für jedes
 *  SSE-Event aufgerufen. Resolved mit dem finalen `ParsedInquiry` sobald
 *  das `result`-Event eintrifft. Wirft bei `error`-Event. */
export async function llmStructureStream(
  text: string,
  onEvent: (e: StreamEvent) => void,
): Promise<ParsedInquiry> {
  const r = await fetch('/api/llm/structure', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok || !r.body) throw new Error(`Structure-Stream fehlgeschlagen (${r.status})`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finalResult: ParsedInquiry | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE-Frames sind durch \n\n getrennt
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const ev = parseSseFrame(frame);
      if (!ev) continue;

      if (ev.event === 'step') {
        try { onEvent({ kind: 'step', step: JSON.parse(ev.data) as StreamStep }); } catch {}
      } else if (ev.event === 'result') {
        try {
          finalResult = JSON.parse(ev.data) as ParsedInquiry;
          onEvent({ kind: 'result', parsed: finalResult });
        } catch {}
      } else if (ev.event === 'error') {
        try {
          const e = JSON.parse(ev.data) as { message: string };
          onEvent({ kind: 'error', message: e.message });
          throw new Error(e.message);
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
  }

  if (!finalResult) throw new Error('Stream endete ohne result-Event');
  return finalResult;
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
