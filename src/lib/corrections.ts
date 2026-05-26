// M11 · Korrektur-Log API
//
// Wird vom AnfrageNeu-Edit-Step gerufen, sobald der User auf "Anfrage anlegen"
// klickt: vergleicht die Werte vom LLM-Snapshot mit den aktuell im Formular
// stehenden Werten und schreibt für jeden geänderten Wert einen Datensatz
// in `parse_corrections`. Bestätigte ("✓ passt") Felder werden NICHT
// geloggt — kein Diff, keine Korrektur.
//
// Robustheit: schlägt der Insert fehl (z.B. Tabelle existiert noch nicht
// auf der Live-DB), schlucken wir den Fehler still. Korrektur-Log ist
// Komfort, nicht geschäftskritisch — die Anfrage selbst muss durchgehen.

import { supabase, isBackendConnected } from './supabase';
import type { ParsedInquiry } from './llm';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export interface CorrectionDiff {
  field: string;
  originalValue: string | null;
  correctedValue: string | null;
  originalConfidence?: 'high' | 'medium' | 'low';
}

/** Berechnet die Korrekturen aus parsed-snapshot vs. aktueller Wert. */
export function diffCorrections(
  parsed: ParsedInquiry | null | undefined,
  snapshot: Record<string, string>,
  current: Record<string, string>,
): CorrectionDiff[] {
  if (!parsed) return [];
  const out: CorrectionDiff[] = [];
  for (const field of Object.keys(snapshot)) {
    const orig = (snapshot[field] ?? '').trim();
    const cur = (current[field] ?? '').trim();
    if (orig === cur) continue;
    out.push({
      field,
      originalValue: orig.length ? orig : null,
      correctedValue: cur.length ? cur : null,
      originalConfidence: parsed.confidence?.[field] as ('high' | 'medium' | 'low' | undefined),
    });
  }
  return out;
}

/** Schreibt eine Liste Korrekturen in `parse_corrections`. Schluckt Fehler. */
export async function logCorrections(
  inquiryId: string,
  parsed: ParsedInquiry | null | undefined,
  diffs: CorrectionDiff[],
  vorgang?: string,
): Promise<void> {
  if (!isBackendConnected() || !supabase || diffs.length === 0) return;
  const sb: any = supabase;
  try {
    const rows = diffs.map((d) => ({
      company_id: COMPANY_ID,
      inquiry_id: inquiryId,
      field: d.field,
      original_value: d.originalValue,
      corrected_value: d.correctedValue,
      original_confidence: d.originalConfidence ?? null,
      parser: parsed?.parser ?? null,
      model: parsed?.meta?.model ?? null,
      vorgang: vorgang ?? null,
    }));
    await sb.from('parse_corrections').insert(rows);
  } catch {
    // still: Log ist Komfort, nicht kritisch
  }
}
