// Pre-Cleaning für Anfrage-Rohtexte (Sprint-2-M3, 26.05.2026)
//
// Ziel: vor dem LLM-Call den Rohtext so aufräumen, dass das Modell sich auf
// das eigentliche Anliegen konzentrieren kann — ohne Mail-Header, Quotes,
// Disclaimer und Forwarded-Markup zu interpretieren.
//
// WICHTIG: Signaturen werden NICHT entfernt. Dort stehen Name, Telefon,
// Adresse — die brauchen wir. Wir markieren nur die Position, sodass das LLM
// weiß: das ist Signatur, nicht Anfrage-Inhalt.

export interface PrecleanResult {
  /** Der bereinigte Text, der ans LLM geht. */
  cleaned: string;
  /** Extrahierte Mail-Header (falls vorhanden). */
  headers?: {
    from?: string;
    to?: string;
    subject?: string;
    date?: string;
  };
  /** Welche Schritte wurden angewendet (Diagnose). */
  applied: string[];
  /** Wie viele Zeichen wurden eingespart. */
  shrunkBy: number;
}

const SIG_TRIGGER = /(?:^|\n)\s*(?:mit\s+freundlichen?\s+gr(?:ü|ue)(?:ß|ss)en|viele\s+gr(?:ü|ue)(?:ß|ss)e|liebe\s+gr(?:ü|ue)(?:ß|ss)e|beste\s+gr(?:ü|ue)(?:ß|ss)e|herzliche\s+gr(?:ü|ue)(?:ß|ss)e|sonnige\s+gr(?:ü|ue)(?:ß|ss)e|mfg|lg|gr(?:ü|ue)(?:ß|ss)e?|gruß|gru(?:ß|ss))\s*[,!.]?\s*\n/i;

const DISCLAIMER_TRIGGER = /(?:^|\n)\s*(?:diese\s+e-?mail|disclaimer|vertraulichkeitshinweis|haftungsausschluss|legal\s+disclaimer|the\s+information\s+contained|this\s+e-?mail|kein\s+vertragsschluss|please\s+consider\s+the\s+environment|bitte\s+denken\s+sie\s+an\s+die\s+umwelt|--+\s*$)/im;

const FORWARDED_TRIGGER = /(?:^|\n)\s*(?:-{2,}\s*(?:ursprüngliche\s+nachricht|original\s+message|forwarded\s+message|weitergeleitete\s+nachricht)\s*-{2,}|\b(?:von|from):\s*.+\s*\n\s*(?:gesendet|sent|datum|date):)/i;

const QUOTE_LINE = /^\s*>+\s?/;

/** Mail-Header am Anfang abtrennen (Outlook-/Thunderbird-/Gmail-Paste-Stile). */
function extractHeaders(text: string): { headers?: PrecleanResult['headers']; rest: string } {
  // Header-Block: maximal die ersten 15 Zeilen, jede passt auf "Key: Value"
  const lines = text.split(/\r?\n/);
  const headerEnd = Math.min(15, lines.length);
  const headerRe = /^\s*(Von|From|An|To|Betreff|Subject|Datum|Date|Gesendet|Sent|Cc|Bcc|Reply-To|Antworten an):\s*(.*)$/i;

  let lastHeaderIdx = -1;
  const found: Record<string, string> = {};
  for (let i = 0; i < headerEnd; i++) {
    const m = lines[i].match(headerRe);
    if (m) {
      lastHeaderIdx = i;
      const key = m[1].toLowerCase();
      const norm =
        key === 'von' || key === 'from'           ? 'from'    :
        key === 'an'  || key === 'to'             ? 'to'      :
        key === 'betreff' || key === 'subject'    ? 'subject' :
        key === 'datum' || key === 'date' || key === 'gesendet' || key === 'sent' ? 'date' :
        '';
      if (norm && !found[norm]) found[norm] = m[2].trim();
    } else if (lastHeaderIdx >= 0 && lines[i].trim() === '') {
      // Leerzeile direkt nach dem Header-Block beendet ihn
      break;
    } else if (lastHeaderIdx >= 0) {
      // Continuation einer Header-Zeile (Outlook macht das gerne)
      continue;
    }
  }

  if (lastHeaderIdx < 0) return { rest: text };

  // Konsumieren bis erste Leerzeile NACH dem letzten Header
  let bodyStart = lastHeaderIdx + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  const rest = lines.slice(bodyStart).join('\n');
  return { headers: found as PrecleanResult['headers'], rest };
}

/** Quote-Zeilen (`> ...`) entfernen, aber NICHT wenn der gesamte Text aus
 *  Quotes besteht (dann ist das vermutlich der eigentliche Inhalt). */
function stripQuotes(text: string): string {
  const lines = text.split(/\r?\n/);
  const quoteCount = lines.filter((l) => QUOTE_LINE.test(l)).length;
  if (quoteCount === 0) return text;
  if (quoteCount / lines.length > 0.6) return text; // Mehrheit Quotes → drin lassen
  return lines.filter((l) => !QUOTE_LINE.test(l)).join('\n');
}

/** Disclaimer/Footer-Block am Ende abschneiden. */
function stripDisclaimer(text: string): string {
  const m = text.match(DISCLAIMER_TRIGGER);
  if (!m || m.index === undefined) return text;
  // Aber NICHT abschneiden wenn der Disclaimer schon in den ersten 30% steht
  if (m.index / text.length < 0.3) return text;
  return text.slice(0, m.index).trimEnd();
}

/** Forwarded-Markup + alles danach abschneiden. */
function stripForwarded(text: string): string {
  const m = text.match(FORWARDED_TRIGGER);
  if (!m || m.index === undefined) return text;
  return text.slice(0, m.index).trimEnd();
}

/** Signatur-Position markieren (NICHT entfernen — Stammdaten stehen dort).
 *  Wir setzen einen unauffälligen Marker, damit das LLM weiß: ab hier kommt
 *  vermutlich nur noch Name/Adresse/Kontakt, kein Anliegen mehr. */
function markSignature(text: string): string {
  const m = text.match(SIG_TRIGGER);
  if (!m || m.index === undefined) return text;
  // Wenn die Signatur erst nach 70% des Texts kommt, lohnt sich der Marker
  if (m.index / text.length < 0.4) return text;
  return text.slice(0, m.index) +
    '\n\n[--- Ab hier vermutlich Signatur (Name, Kontakt, Adresse — kein neues Anliegen) ---]\n' +
    text.slice(m.index);
}

/** Mehrfach-Leerzeilen + Trailing-Whitespace komprimieren. */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Hauptfunktion: räumt den Rohtext auf und liefert das Ergebnis + Diagnose. */
export function preClean(rawText: string): PrecleanResult {
  const original = rawText;
  const applied: string[] = [];

  // 1) Header abtrennen
  const { headers, rest: noHeaders } = extractHeaders(rawText);
  if (headers && Object.keys(headers).length) applied.push('headers');

  // 2) Forwarded-Block + alles danach raus
  const noFwd = stripForwarded(noHeaders);
  if (noFwd.length < noHeaders.length) applied.push('forwarded');

  // 3) Disclaimer am Ende abschneiden
  const noDisc = stripDisclaimer(noFwd);
  if (noDisc.length < noFwd.length) applied.push('disclaimer');

  // 4) Quote-Zeilen weg (außer Mehrheit-Quote)
  const noQuotes = stripQuotes(noDisc);
  if (noQuotes.length < noDisc.length) applied.push('quotes');

  // 5) Signatur markieren (nicht entfernen)
  const marked = markSignature(noQuotes);
  if (marked.length > noQuotes.length) applied.push('sig-marked');

  // 6) Aufräumen
  const cleaned = tidy(marked);
  if (cleaned.length < marked.length) applied.push('tidy');

  return {
    cleaned,
    headers,
    applied,
    shrunkBy: original.length - cleaned.length,
  };
}
