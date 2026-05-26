// Strukturiert rohen Anfrage-Text in Felder.
//
// Eskalations-Reihenfolge:
//   1) Cloudflare Workers AI · Llama 3.3 70B fp8-fast — Default (Sprint-1-Upgrade
//      26.05.2026, vorher 8B). EU-Edge, im Account inkludiert (Free-Tier
//      ~150–200 große Anfragen/Tag). Binding `AI` aus dem Cloudflare-Pages-Dashboard.
//   2) Workers AI · Llama 3.1 8B — schneller Fallback wenn 70B in Auslastung
//      läuft oder einen Fehler wirft.
//   3) Anthropic Claude Haiku — nur wenn ANTHROPIC_API_KEY gesetzt UND beide
//      Workers-AI-Pfade scheitern (Premium-Notfall, derzeit nicht aktiv).
//   4) Heuristik (Regex/Pattern) — Notfall-Fallback ohne externe Calls,
//      damit das Anfragen-Modul nie komplett tot ist.
//
// Sprint-1-Maßnahmen (26.05.2026) im Detail:
//   M1  Modell-Upgrade 8B → 70B (siehe oben)
//   M2  Drei Few-Shot-Beispiele im SYSTEM_PROMPT (Mail / Telefon-Notiz / WhatsApp)
//   M4  Cross-Validation Heuristik ↔ LLM in `mergeCrossValidate`:
//       - Bei Mail/Telefon/PLZ/Hausnummer gewinnt die Heuristik bei Konflikt
//         (Regex ist deterministisch präziser)
//       - Bei Name/Leistung/Beschreibung gewinnt das LLM (semantisch besser)
//       - Konflikte werden in `meta.conflicts` mitgeloggt (Diagnose)
//   M6  Kalibrierte Confidence `scoreConfidence()`:
//       - Feld wörtlich im Originaltext? → high
//       - Heuristik bestätigt LLM-Wert? → +1 Stufe
//       - Sonst LLM-Selbstauskunft als Ausgangspunkt
//
// Sprint-2-Maßnahmen (26.05.2026):
//   M3  Pre-Cleaning via `preClean()` aus ./preclean.ts: EML-Header,
//       Quote-Zeilen, Disclaimer, Forwarded-Markup raus. Signatur DRIN
//       (Name/Tel/Mail stehen dort). Headers gehen separat ans LLM als
//       Kontext-Block.
//   M5  Self-Check-Pass: zweiter Workers-AI-Call mit Originaltext + JSON,
//       Frage „was fehlt / was ist falsch?". Ergebnis in `meta.review_hints`.
//       Skip bei kurzen Texten (< 100 Zeichen — Self-Check würde mehr Zeit
//       als Wert bringen).

import { preClean, type PrecleanResult } from './preclean';
import { buildDomainHint, EINHEITEN_ALIAS, LEISTUNGEN } from './domain';

interface AiBinding {
  run(model: string, input: any): Promise<any>;
}

export interface Env {
  AI?: AiBinding;
  ANTHROPIC_API_KEY?: string;
}

/** Wie sicher ist Pipeline bei einem Feld bzw. der Gesamtaussage. */
type Confidence = 'high' | 'medium' | 'low';

/** Welche Art von Anfrage liegt vor.
 *  Steuert Sortierung/Highlight in der Inbox und Empfehlung des nächsten
 *  Schritts (Angebot vs. Termin-Notiz vs. Reklamationsticket). */
type Vorgang = 'angebot' | 'termin' | 'reklamation' | 'material' | 'sonstiges';

interface Parsed {
  // Klassifikation
  vorgang?: Vorgang;

  // Stammdaten (gleiche Feldnamen wie Frontend erwartet)
  customerName?: string;
  firma?: string;
  phone?: string;         // Festnetz primär
  phone_mobile?: string;  // Mobil (Handy)
  email?: string;
  street?: string;
  zip?: string;
  city?: string;

  // Inhalt
  description?: string;
  /** Legacy / Backwards-Compat — wird automatisch aus leistungen[0]?.name befüllt. */
  leistung?: string;
  /** M8: Mehrere Gewerke pro Anfrage strukturiert. */
  leistungen?: { name: string; mengen?: { wert: string; einheit?: string; was?: string }[] }[];
  mengen?: { wert: string; einheit?: string; was?: string }[];
  termin?: string;

  // Metadaten
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';

  // Vertrauensgrad
  confidence?: Partial<Record<keyof Parsed | 'overall', Confidence>>;

  /** Welcher Pfad hat strukturiert — fürs Debugging im Frontend. */
  parser: 'workers-ai-70b' | 'workers-ai-8b' | 'anthropic' | 'heuristic';

  /** Diagnose: Felder mit divergierenden Werten zwischen LLM und Heuristik.
   *  Wird im Frontend für Re-Parse-Anzeige / Debugging genutzt. */
  meta?: {
    conflicts?: { field: string; llm: string; heuristic: string; chosen: string; reason: string }[];
    model?: string;
    /** Welche Pre-Cleaning-Schritte wurden angewendet. */
    preclean?: { applied: string[]; shrunkBy: number; headers?: PrecleanResult['headers'] };
    /** Self-Check-Hinweise (M5): was hat der zweite LLM-Call kritisiert? */
    review_hints?: { missing?: string[]; potentially_wrong?: string[]; note?: string };
  };
}

/** System-Prompt mit Schema + Regeln + Few-Shot-Examples (M2).
 *
 *  Die drei Beispiele decken die drei häufigsten Anfrage-Stile ab:
 *  - lange Mail mit Adressblock und Signatur
 *  - kurze Telefon-Notiz (oft nur 1–2 Sätze, mehrteilig)
 *  - WhatsApp-Stil (informell, Tippfehler, Mobilnummer)
 *
 *  Bei 70B-Modellen ist Few-Shot der höchste Hebel — das Modell lernt im
 *  Kontext, wie unsere konkrete JSON-Form aussieht und welche Felder bei
 *  welchem Input-Stil typisch füllen.
 */
const SYSTEM_PROMPT = `Du strukturierst Kunden-Anfragen für einen Garten- und Landschaftsbau-Betrieb in Ostfriesland (Rund um's Haus Leuschner). Typische Leistungen: Doppelstabmattenzaun, Pflasterarbeiten (Hofeinfahrt, Terrasse), Erdarbeiten, Bagger-/Transportarbeiten, Drainage, Rasen anlegen, Mutterboden, Gartenmauer, Rasenbord, Sichtschutz, Tore.

Extrahiere die Felder unten als striktes JSON. Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, ohne Erklärung, ohne Markdown-Codefence.

Schema:
{
  "vorgang": "angebot" | "termin" | "reklamation" | "material" | "sonstiges",
  "customerName": string | null,
  "firma": string | null,
  "phone": string | null,
  "phone_mobile": string | null,
  "email": string | null,
  "street": string | null,
  "zip": string | null,
  "city": string | null,
  "description": string | null,
  "leistung": string | null,
  "leistungen": [{ "name": string, "mengen": [{ "wert": string, "einheit": string, "was": string }] }],
  "mengen": [{ "wert": string, "einheit": string, "was": string }],
  "termin": string | null,
  "dringlichkeit": "niedrig" | "normal" | "hoch" | null,
  "source_guess": "mail" | "phone" | "whatsapp" | "letter" | "in_person" | "web" | null,
  "confidence": {
    "overall": "high" | "medium" | "low",
    "customerName": "high" | "medium" | "low" | null,
    "phone": "high" | "medium" | "low" | null,
    "phone_mobile": "high" | "medium" | "low" | null,
    "email": "high" | "medium" | "low" | null,
    "street": "high" | "medium" | "low" | null,
    "city": "high" | "medium" | "low" | null,
    "leistung": "high" | "medium" | "low" | null,
    "vorgang": "high" | "medium" | "low"
  }
}

${buildDomainHint()}

Regeln:
- vorgang "angebot" wenn Kunde nach Preis/Angebot/Kostenvoranschlag fragt
- vorgang "termin" wenn nur Rückruf, Aufmaß-Termin, Besichtigung gewünscht (kein Angebot direkt verlangt)
- vorgang "reklamation" bei Beschwerde über bereits ausgeführte Arbeit
- vorgang "material" wenn der Kunde nur Material (z.B. Mutterboden, Pflastersteine) bestellt
- vorgang "sonstiges" sonst
- Bei Tippfehlern oder informellem Stil: trotzdem extrahieren, confidence "medium" setzen
- Bei unsicheren Werten lieber null + confidence "low" statt zu raten
- Mengen mit Einheit (m, m², m³, lfm, Stk, t, Std — IMMER Standardform aus Glossar) und IMMER "was" füllen (was ist gemeint, z.B. "Zaun", "Pflasterfläche", "Mutterboden")
- WICHTIG bei mehreren Gewerken: leistungen[] enthält JEDE einzelne Leistung mit ihrer eigenen mengen[]-Liste. leistung (Singular) ist dann leistungen[0].name. Das globale mengen[]-Array darf zusätzlich existieren als Gesamtübersicht, ist aber redundant.
- Telefon im Originalformat lassen
- WICHTIG: Wenn zwei Telefonnummern im Text stehen, gehört die mit Mobil-Vorwahl
  (deutsche Handy-Vorwahlen 015x, 016x, 017x oder am Wort "Mobil", "Handy",
  "Mobil-Nr") in "phone_mobile", die andere (Festnetz mit Ortsvorwahl 0xxxx
  oder am Wort "Telefon", "Festnetz") in "phone". Ist nur eine Nummer da:
  bei Mobil-Vorwahl → phone_mobile, sonst phone, das jeweils andere Feld null.
- Wenn Name in Inline-Phrase steht ("mein Name ist X", "ich bin X", "hier spricht X"), übernehmen
- Straße: nur die echte Adresse extrahieren, nicht den Fließtext
- description: 1-2 Sätze, was der Kunde will, NICHT der ganze Originaltext
- Antworte AUSSCHLIESSLICH mit dem JSON-Objekt

Drei Beispiele zur Orientierung:

BEISPIEL 1 — Mail
Eingabe:
"Von: m.borgmann@web.de
Betreff: Anfrage Zaun

Sehr geehrte Damen und Herren,

ich hätte gerne ein Angebot für einen Doppelstabmattenzaun, anthrazit, ca. 80 m, Höhe 1,80 m, dazu zwei Tore. Mein Grundstück ist in der Tunxdorferstraße 46, 26871 Papenburg.

Mit freundlichen Grüßen
Josef Borgmann
Tel: 04961 / 12345"

Ausgabe:
{"vorgang":"angebot","customerName":"Josef Borgmann","firma":null,"phone":"04961 / 12345","phone_mobile":null,"email":"m.borgmann@web.de","street":"Tunxdorferstraße 46","zip":"26871","city":"Papenburg","description":"Angebot für Doppelstabmattenzaun anthrazit, ca. 80 m Höhe 1,80 m, plus zwei Tore.","leistung":"Doppelstabmattenzaun","mengen":[{"wert":"80","einheit":"m","was":"Zaun"},{"wert":"1,80","einheit":"m","was":"Höhe"},{"wert":"2","einheit":"Stk","was":"Tore"}],"termin":null,"dringlichkeit":"normal","source_guess":"mail","confidence":{"overall":"high","customerName":"high","phone":"high","phone_mobile":null,"email":"high","street":"high","city":"high","leistung":"high","vorgang":"high"}}

BEISPIEL 2 — Telefon-Notiz (mehrteilig, zeigt leistungen[])
Eingabe:
"Frau Hainke aus Bunde, 0171 2345678, will Hofeinfahrt gepflastert ca 45 qm und Drainage davor. Bittet um Rückruf."

Ausgabe:
{"vorgang":"angebot","customerName":"Hainke","firma":null,"phone":null,"phone_mobile":"0171 2345678","email":null,"street":null,"zip":null,"city":"Bunde","description":"Hofeinfahrt pflastern ca. 45 m² plus Drainage davor. Bittet um Rückruf.","leistung":"Pflasterarbeiten","leistungen":[{"name":"Pflasterarbeiten","mengen":[{"wert":"45","einheit":"m²","was":"Hofeinfahrt"}]},{"name":"Drainage","mengen":[]}],"mengen":[{"wert":"45","einheit":"m²","was":"Hofeinfahrt"}],"termin":"Rückruf gewünscht","dringlichkeit":"normal","source_guess":"phone","confidence":{"overall":"medium","customerName":"medium","phone":null,"phone_mobile":"high","email":null,"street":null,"city":"high","leistung":"high","vorgang":"high"}}

BEISPIEL 3 — WhatsApp (informell, Tippfehler)
Eingabe:
"moin, hier de haan aus leer. brauch dringen mutterboden ca 70 kubik fürn neuen garten. wann könnt ihr liefern? 015112345678"

Ausgabe:
{"vorgang":"material","customerName":"De Haan","firma":null,"phone":null,"phone_mobile":"015112345678","email":null,"street":null,"zip":null,"city":"Leer","description":"Lieferung Mutterboden ca. 70 m³ für neuen Garten. Liefertermin gesucht.","leistung":"Mutterboden","mengen":[{"wert":"70","einheit":"m³","was":"Mutterboden"}],"termin":"so schnell wie möglich","dringlichkeit":"hoch","source_guess":"whatsapp","confidence":{"overall":"medium","customerName":"medium","phone":null,"phone_mobile":"high","email":null,"street":null,"city":"high","leistung":"high","vorgang":"high"}}

Jetzt strukturiere die folgende Anfrage nach demselben Schema. Antworte AUSSCHLIESSLICH mit dem JSON-Objekt.`;

/**
 * Workers AI · Modell-Aufruf (universell für 70B + 8B).
 * Gemeinsame Logik, nur Modellname unterschiedlich.
 */
async function runWorkersAi(text: string, ai: AiBinding, model: string): Promise<{ parsed: Parsed | null; error?: string }> {
  try {
    const resp: any = await ai.run(model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 1500, // 70B liefert ausführlichere confidence-Blöcke
      temperature: 0.1,
      // response_format weggelassen: Cloudflare-Workers-AI verlangt für
      // strict-JSON ein eigenes `json_schema`-Format. Stattdessen erzwingt
      // der System-Prompt das JSON, safeJson räumt Codefences/Vorwort weg.
    });
    const raw: string = resp?.response ?? resp?.result?.response ?? '';
    if (!raw) return { parsed: null, error: 'empty response: ' + JSON.stringify(resp).slice(0, 200) };
    const cleaned = stripCodeFence(raw);
    const json = safeJson(cleaned);
    if (!json) return { parsed: null, error: 'json-parse-fail: ' + cleaned.slice(0, 200) };
    const parserTag: Parsed['parser'] = model.includes('70b') ? 'workers-ai-70b' : 'workers-ai-8b';
    const out = normalize({ ...json, parser: parserTag });
    out.meta = { ...(out.meta ?? {}), model };
    return { parsed: out };
  } catch (e: any) {
    return { parsed: null, error: 'ai.run threw: ' + String(e?.message ?? e).slice(0, 200) };
  }
}

/** Optional: Anthropic Haiku. Erst aktiv wenn ANTHROPIC_API_KEY gesetzt
 *  UND beide Workers-AI-Pfade gescheitert sind (Premium-Notfall). */
async function parseWithAnthropic(text: string, apiKey: string): Promise<Parsed | null> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const raw: string = data?.content?.[0]?.text ?? '';
    const cleaned = stripCodeFence(raw);
    const json = safeJson(cleaned);
    if (!json) return null;
    return normalize({ ...json, parser: 'anthropic' });
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function safeJson(s: string): any {
  // Versuch 1: direkt parsen
  try { return JSON.parse(s); } catch {}
  // Versuch 2: das erste {...}-Substring herausschneiden
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

/** Sicherstellen dass das LLM-Schema sauber ist und nichts fehlt was das
 *  Frontend erwartet. */
function normalize(p: any): Parsed {
  const out: Parsed = { parser: p.parser ?? 'workers-ai-70b' };
  if (p.vorgang && ['angebot','termin','reklamation','material','sonstiges'].includes(p.vorgang)) out.vorgang = p.vorgang;
  for (const k of ['customerName','firma','phone','phone_mobile','email','street','zip','city','description','leistung','termin'] as const) {
    if (typeof p[k] === 'string' && p[k].trim().length) (out as any)[k] = p[k].trim();
  }
  // Sanity: wenn nur eine Nummer geliefert wurde aber sie eine Mobil-Vorwahl
  // hat, korrigiere phone → phone_mobile (das LLM verwechselt das gelegentlich)
  if (out.phone && !out.phone_mobile && /^\+?49?\s*0?1[5-7]\d/.test(out.phone.replace(/\s/g, ''))) {
    out.phone_mobile = out.phone;
    delete out.phone;
  }
  if (Array.isArray(p.mengen)) {
    out.mengen = p.mengen
      .filter((m: any) => m && typeof m.wert === 'string')
      .slice(0, 8)
      .map((m: any) => ({ wert: String(m.wert), einheit: normEinheit(m.einheit), was: m.was ?? '' }));
  }

  // M8: leistungen[] mit pro-Leistung-Mengen
  if (Array.isArray(p.leistungen)) {
    out.leistungen = p.leistungen
      .filter((l: any) => l && typeof l.name === 'string' && l.name.trim().length)
      .slice(0, 6)
      .map((l: any) => ({
        name: String(l.name).trim(),
        mengen: Array.isArray(l.mengen)
          ? l.mengen
              .filter((m: any) => m && typeof m.wert === 'string')
              .slice(0, 5)
              .map((m: any) => ({ wert: String(m.wert), einheit: normEinheit(m.einheit), was: m.was ?? '' }))
          : undefined,
      }));
    // Backwards-Compat: leistung (Singular) = erste Leistung, falls LLM sie
    // nicht selbst gesetzt hat
    if (!out.leistung && out.leistungen?.length) {
      out.leistung = out.leistungen[0].name;
    }
  } else if (out.leistung) {
    // Wenn LLM nur leistung (Singular) lieferte, leistungen[] daraus ableiten
    out.leistungen = [{ name: out.leistung, mengen: out.mengen ? [...out.mengen] : undefined }];
  }
  if (['niedrig','normal','hoch'].includes(p.dringlichkeit)) out.dringlichkeit = p.dringlichkeit;
  if (['mail','phone','whatsapp','letter','in_person','web'].includes(p.source_guess)) out.source_guess = p.source_guess;
  if (p.confidence && typeof p.confidence === 'object') {
    const c: any = {};
    for (const [k, v] of Object.entries(p.confidence)) {
      if (['high','medium','low'].includes(v as string)) c[k] = v;
    }
    out.confidence = c;
  }
  return out;
}

/** Einheit auf Standardform normalisieren (qm→m², kubik→m³, …). */
function normEinheit(raw: any): string {
  if (typeof raw !== 'string') return '';
  const trim = raw.trim();
  if (!trim) return '';
  const alias = EINHEITEN_ALIAS[trim.toLowerCase()];
  return alias ?? trim;
}

function parseHeuristic(text: string): Parsed {
  const out: Parsed = { parser: 'heuristic', confidence: { overall: 'low' } };

  // E-Mail
  const mail = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (mail) out.email = mail[0];

  // Telefon — alle Nummern finden, dann nach Mobil vs. Festnetz sortieren
  const phoneRe = /(?:(Tel\.?|Telefon|Festnetz|Mobil|Handy|Mobil-Nr\.?|Phone)?[:\s]*)?((?:\+49|0)[\d\s\-/]{6,})/gi;
  const phones: { tag: string; value: string }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = phoneRe.exec(text)) !== null) {
    const value = pm[2].replace(/\s+/g, ' ').trim();
    const tag = (pm[1] || '').toLowerCase();
    if (!phones.find((p) => p.value === value)) phones.push({ tag, value });
  }
  for (const p of phones) {
    const isMobile = /mobil|handy/i.test(p.tag) || /^\+?49?\s*0?1[5-7]\d/.test(p.value.replace(/\s/g, ''));
    if (isMobile && !out.phone_mobile) out.phone_mobile = p.value;
    else if (!isMobile && !out.phone) out.phone = p.value;
    else if (isMobile && !out.phone) out.phone = p.value; // Fallback
  }

  // PLZ + Stadt — Stadt 1-3 Wörter, stoppt am Punkt/Komma
  const plzCity = text.match(/\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß][\wäöüß-]*(?:[\s/-][A-ZÄÖÜ][a-zäöüß][\wäöüß-]+){0,2})/);
  if (plzCity) {
    out.zip = plzCity[1];
    out.city = plzCity[2].trim();
  } else {
    const plz = text.match(/\b\d{5}\b/);
    if (plz) out.zip = plz[0];
  }

  // Straße
  const STREET_ENDING = '(?:straße|stra(?:ss|ß)e|str\\.?|weg|allee|gasse|platz|ring|chaussee|damm|ufer|pfad|stieg)';
  const streetSingle = text.match(new RegExp(`\\b[A-ZÄÖÜ][\\wäöüß-]{2,30}${STREET_ENDING}\\.?\\s+\\d+\\s*[a-z]?\\b`, 'i'));
  const streetMulti = text.match(new RegExp(`(?:in der|Adresse:?|wohnhaft|wohnen?|am|im)\\s+([A-ZÄÖÜ][\\wäöüß-]+(?:\\s+[A-ZÄÖÜ][\\wäöüß-]+){0,3}\\s+\\d+\\s*[a-z]?)\\b`, 'i'));
  if (streetSingle) out.street = streetSingle[0].trim();
  else if (streetMulti) out.street = streetMulti[1].trim();

  // Name — Inline-Phrase oder Signatur
  const inline = text.match(/(?:mein\s+name\s+ist|ich\s+bin|ich\s+hei(?:ß|ss)e|hier\s+(?:spricht|ist|schreibt)|von\s+)\s+([A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+){1,2})\b/i);
  const greetingRe = /^(viele|liebe|herzliche|beste|freundliche|sonnige)\s+gr(ü|ue)(ß|ss)e?$|^mit\s+freundlichen?\s+gr|^mfg$|^lg$|^gru(ß|ss)$/i;
  const sigLine = text.split(/\n/).map((l) => l.trim()).filter((l) => !greetingRe.test(l))
    .find((l) => /^[A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+)+$/.test(l) || /^(?:Herr|Frau|Familie)\s+[A-ZÄÖÜ]/i.test(l));
  if (inline) out.customerName = inline[1];
  else if (sigLine) out.customerName = sigLine.replace(/^(Herr|Frau|Familie)\s+/i, '');

  // Mengen
  const unitRe = /(\d+(?:[.,]\d+)?)\s*(m²|qm|m³|cbm|m|lfm|Std|Stunden|Stk|Stück|t|kg|km)\b/gi;
  const mengen: { wert: string; einheit: string; was: string }[] = [];
  let m;
  while ((m = unitRe.exec(text)) !== null) {
    mengen.push({ wert: m[1].replace(',', '.'), einheit: m[2], was: '' });
  }
  if (mengen.length) out.mengen = mengen.slice(0, 8);

  // Leistung — M8: mehrere Treffer sammeln, nicht nur den ersten
  const leistungKeys = ['Doppelstabmattenzaun','Doppelstabzaun','Zaun','Pflaster','Pflasterung','Hofeinfahrt','Terrasse','Erdarbeiten','Bagger','Drainage','Rasen','Mutterboden','Gartenmauer','Mauer','Rasenbord','Sichtschutz','Tor'];
  const foundLeistungen: string[] = [];
  for (const key of leistungKeys) {
    const re = new RegExp(`\\b${key}\\w*`, 'i');
    const hit = text.match(re);
    if (hit && !foundLeistungen.some((l) => l.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(l.toLowerCase()))) {
      foundLeistungen.push(hit[0]);
    }
  }
  if (foundLeistungen.length > 0) {
    out.leistung = foundLeistungen[0];
    out.leistungen = foundLeistungen.map((name) => ({ name }));
  }

  // Vorgangs-Klassifikation per Schlagwörtern
  if (/reklamation|beschwerde|nachbesserung|mängel|ist (?:nicht|kaputt|locker|schief)/i.test(text)) out.vorgang = 'reklamation';
  else if (/^(?=.*\b(?:mutterboden|pflastersteine|kies|sand|splitt|beton)\b)(?=.*\bbestell)/i.test(text)) out.vorgang = 'material';
  else if (/aufma(?:ß|ss)|besichtigung|rückruf|vorbeikommen|termin/i.test(text) && !/angebot|kostenvoranschlag/i.test(text)) out.vorgang = 'termin';
  else if (/angebot|kostenvoranschlag|preis|kosten/i.test(text)) out.vorgang = 'angebot';
  else out.vorgang = 'sonstiges';

  // Beschreibung
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length) out.description = compact.length > 200 ? compact.slice(0, 197) + '…' : compact;

  // Dringlichkeit
  if (/dringend|so schnell|asap|kurzfristig|sofort/i.test(text)) out.dringlichkeit = 'hoch';
  else if (/ohne Eile|in Ruhe|nächste(?:s)? Jahr|2027/i.test(text)) out.dringlichkeit = 'niedrig';
  else out.dringlichkeit = 'normal';

  // Quelle
  if (/whatsapp|whats app/i.test(text)) out.source_guess = 'whatsapp';
  else if (out.email && !out.phone) out.source_guess = 'mail';
  else if (out.phone && !out.email) out.source_guess = 'phone';

  return out;
}

type Ctx = { request: Request; env: Env };
export const onRequestPost = async ({ request, env }: Ctx) => {
  // Debug-Header: zeigen welche Bindings die Function tatsächlich sieht
  const debug = {
    hasAI: !!env.AI,
    hasAnthropic: !!env.ANTHROPIC_API_KEY,
    aiError: '' as string,
    aiPath: '' as string,
    preclean: '' as string,
  };
  try {
    const body = (await request.json()) as { text?: string; skipSelfCheck?: boolean };
    const rawText = (body?.text ?? '').trim();
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'no text' }), { status: 400 });
    }

    // M3: Pre-Cleaning vor allem anderen. Heuristik nutzt aber den ORIGINALTEXT,
    // damit Regex-Anker (Signaturen, Adressen) nicht in Mitleidenschaft geraten —
    // der gereinigte Text geht nur ans LLM.
    const pre = preClean(rawText);
    debug.preclean = pre.applied.join('+') || 'none';

    // Header (Von/Betreff/Datum) als Kontext-Block ans LLM hängen — hilft dem
    // Modell, ohne dass wir Header-Tokens zwischen den eigentlichen Anfrage-Inhalt mischen.
    const llmInput = pre.headers
      ? buildLlmInputWithHeaders(pre.cleaned, pre.headers)
      : pre.cleaned;

    const heur = parseHeuristic(rawText);

    // 1) Workers AI · Llama 3.3 70B fp8-fast (Primary)
    if (env.AI) {
      const wa70 = await runWorkersAi(llmInput, env.AI, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
      if (wa70.parsed) {
        debug.aiPath = 'llama-3.3-70b';
        const merged = mergeCrossValidate(wa70.parsed, heur);
        attachPrecleanMeta(merged, pre);
        if (shouldSelfCheck(rawText, body?.skipSelfCheck)) {
          merged.meta = { ...(merged.meta ?? {}), review_hints: await selfCheck(rawText, merged, env.AI) };
        }
        return jsonResponse(merged, debug);
      }
      debug.aiError = '70b: ' + (wa70.error ?? 'unknown');

      // 2) Workers AI · Llama 3.1 8B (Fallback wenn 70B versagt)
      const wa8 = await runWorkersAi(llmInput, env.AI, '@cf/meta/llama-3.1-8b-instruct');
      if (wa8.parsed) {
        debug.aiPath = 'llama-3.1-8b-fallback';
        const merged = mergeCrossValidate(wa8.parsed, heur);
        attachPrecleanMeta(merged, pre);
        // Self-Check beim 8B-Fallback skippen — 8B als Self-Check ist zu unzuverlässig.
        return jsonResponse(merged, debug);
      }
      debug.aiError += ' | 8b: ' + (wa8.error ?? 'unknown');
    }

    // 3) Anthropic (Premium-Notfall, nur wenn explizit konfiguriert)
    if (env.ANTHROPIC_API_KEY) {
      const an = await parseWithAnthropic(llmInput, env.ANTHROPIC_API_KEY);
      if (an) {
        debug.aiPath = 'anthropic-haiku';
        const merged = mergeCrossValidate(an, heur);
        attachPrecleanMeta(merged, pre);
        return jsonResponse(merged, debug);
      }
    }

    // 4) Heuristik (Notfall ohne externe Calls)
    debug.aiPath = 'heuristic-only';
    attachPrecleanMeta(heur, pre);
    return jsonResponse(heur, debug);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err), debug }), { status: 500 });
  }
};

function buildLlmInputWithHeaders(body: string, h: NonNullable<PrecleanResult['headers']>): string {
  const lines: string[] = ['[--- Mail-Header (Kontext, nicht der eigentliche Anfrage-Text) ---]'];
  if (h.from)    lines.push(`Von: ${h.from}`);
  if (h.to)      lines.push(`An: ${h.to}`);
  if (h.subject) lines.push(`Betreff: ${h.subject}`);
  if (h.date)    lines.push(`Datum: ${h.date}`);
  lines.push('[--- Anfrage-Text ---]', '', body);
  return lines.join('\n');
}

function attachPrecleanMeta(p: Parsed, pre: PrecleanResult): void {
  if (!pre.applied.length && !pre.headers) return;
  p.meta = {
    ...(p.meta ?? {}),
    preclean: { applied: pre.applied, shrunkBy: pre.shrunkBy, headers: pre.headers },
  };
}

/** Self-Check nur lohnenswert wenn der Originaltext substantiell ist
 *  UND der User es nicht explizit deaktiviert hat (z.B. bei Live-Tippen). */
function shouldSelfCheck(rawText: string, skip?: boolean): boolean {
  if (skip) return false;
  return rawText.length >= 100;
}

/** M5 · Self-Check-Pass.
 *  Ein zweiter Workers-AI-Call mit Originaltext + extrahierter JSON.
 *  Frage: was fehlt? was ist falsch? Output → review_hints für die UI.
 *  Bei Fehler stillschweigend `undefined` — Self-Check ist Komfort, nicht
 *  geschäftskritisch. */
async function selfCheck(
  rawText: string,
  parsed: Parsed,
  ai: AiBinding,
): Promise<NonNullable<Parsed['meta']>['review_hints'] | undefined> {
  const prompt = `Du prüfst eine bereits extrahierte Anfrage gegen den Originaltext. Antworte AUSSCHLIESSLICH als JSON.

Schema:
{
  "missing": [string],          // Relevante Aussagen aus dem Text, die NICHT in der Extraktion stehen (max 3)
  "potentially_wrong": [string],// Felder die wahrscheinlich falsch übernommen wurden (max 3, Format "feldname: kurze Begründung")
  "note": string | null         // Ein Satz Gesamteinschätzung oder null
}

Sei knapp. Wenn alles passt: leere Arrays + note=null.
Erfinde nichts. Bewerte nur, was im Originaltext steht.`;

  const userMsg = `ORIGINALTEXT:
${rawText}

EXTRAHIERT:
${JSON.stringify({
  customerName: parsed.customerName, firma: parsed.firma,
  phone: parsed.phone, phone_mobile: parsed.phone_mobile, email: parsed.email,
  street: parsed.street, zip: parsed.zip, city: parsed.city,
  description: parsed.description, leistung: parsed.leistung,
  mengen: parsed.mengen, termin: parsed.termin,
  vorgang: parsed.vorgang, dringlichkeit: parsed.dringlichkeit,
}, null, 2)}`;

  try {
    const resp: any = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 500,
      temperature: 0.0,
    });
    const raw: string = resp?.response ?? resp?.result?.response ?? '';
    if (!raw) return undefined;
    const json = safeJson(stripCodeFence(raw));
    if (!json) return undefined;
    const out: NonNullable<Parsed['meta']>['review_hints'] = {};
    if (Array.isArray(json.missing))           out.missing           = json.missing.filter((x: any) => typeof x === 'string').slice(0, 3);
    if (Array.isArray(json.potentially_wrong)) out.potentially_wrong = json.potentially_wrong.filter((x: any) => typeof x === 'string').slice(0, 3);
    if (typeof json.note === 'string')         out.note              = json.note.slice(0, 200);
    // Wenn alles leer: undefined zurück, damit Frontend keinen leeren Block rendert
    if (!out.missing?.length && !out.potentially_wrong?.length && !out.note) return undefined;
    return out;
  } catch {
    return undefined;
  }
}

function jsonResponse(p: Parsed, debug: any): Response {
  return new Response(JSON.stringify(p), {
    headers: {
      'content-type': 'application/json',
      'x-ai-available': String(debug.hasAI),
      'x-anthropic-available': String(debug.hasAnthropic),
      'x-ai-path': debug.aiPath || '',
      'x-ai-error': debug.aiError || '',
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────
   M4 · Cross-Validation Heuristik ↔ LLM
   ────────────────────────────────────────────────────────────────────────
   - Backfill (LLM-Feld leer → Heuristik füllt): Lücke schließen
   - Konflikt (LLM-Feld ≠ Heuristik-Feld, beide gesetzt):
       - Mail/Telefon/PLZ/Hausnummer-Felder: Heuristik gewinnt (Regex präziser)
       - Name/Leistung/Beschreibung: LLM gewinnt (semantisch besser)
       - Konflikt wird in meta.conflicts geloggt
   Die Confidence-Anhebung bei Heuristik-Bestätigung passiert in M6 unten.
   ──────────────────────────────────────────────────────────────────────── */

const HEURISTIC_WINS = new Set(['email','phone','phone_mobile','zip']);
const LLM_WINS       = new Set(['customerName','leistung','description','vorgang','firma']);

function normPhone(s?: string): string {
  return (s ?? '').replace(/\s|\-|\/|\(|\)|\./g, '').toLowerCase();
}
function normStr(s?: string): string {
  return (s ?? '').trim().toLowerCase();
}

function valuesEqual(field: string, a?: string, b?: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (field === 'phone' || field === 'phone_mobile') return normPhone(a) === normPhone(b);
  return normStr(a) === normStr(b);
}

function mergeCrossValidate(primary: Parsed, heur: Parsed): Parsed {
  const out: any = { ...primary };
  const conflicts: NonNullable<Parsed['meta']>['conflicts'] = [];

  const allFields = ['email','phone','phone_mobile','zip','city','street','customerName','leistung','description','firma'] as const;
  for (const k of allFields) {
    const llmVal = (primary as any)[k] as string | undefined;
    const heuVal = (heur as any)[k] as string | undefined;

    if (!llmVal && heuVal) {
      // Backfill: LLM hat's vergessen, Heuristik füllt
      out[k] = heuVal;
      continue;
    }
    if (llmVal && heuVal && !valuesEqual(k, llmVal, heuVal)) {
      // Konflikt: entscheiden je nach Feld-Klasse
      let chosen = llmVal;
      let reason = 'llm-default';
      if (HEURISTIC_WINS.has(k)) {
        chosen = heuVal;
        reason = 'regex-präziser-als-LLM';
      } else if (LLM_WINS.has(k)) {
        chosen = llmVal;
        reason = 'llm-semantisch-besser';
      }
      out[k] = chosen;
      conflicts.push({ field: k, llm: llmVal, heuristic: heuVal, chosen, reason });
    }
  }

  // Mengen / Klassifikations-Felder klassisch backfillen
  if (!out.mengen && heur.mengen) out.mengen = heur.mengen;
  if ((!out.leistungen || out.leistungen.length === 0) && heur.leistungen) out.leistungen = heur.leistungen;
  if (!out.dringlichkeit && heur.dringlichkeit) out.dringlichkeit = heur.dringlichkeit;
  if (!out.source_guess && heur.source_guess) out.source_guess = heur.source_guess;
  if (!out.vorgang && heur.vorgang) out.vorgang = heur.vorgang;

  // M6: Confidence nach Cross-Validation neu kalibrieren
  out.confidence = scoreConfidence(out, primary, heur);

  // Diagnose anhängen
  if (conflicts.length) {
    out.meta = { ...(out.meta ?? {}), conflicts };
  }

  return out as Parsed;
}

/* ────────────────────────────────────────────────────────────────────────
   M6 · Kalibrierte Confidence (post-hoc, ersetzt LLM-Selbstauskunft)
   ────────────────────────────────────────────────────────────────────────
   Regeln:
   - Feld leer → null (keine Confidence-Aussage)
   - Feld wörtlich im Originaltext gefunden → high
   - Heuristik bestätigt denselben Wert → +1 Stufe gegenüber LLM-Auskunft
   - Sonst Ausgangswert von LLM (oder medium als Default)
   ──────────────────────────────────────────────────────────────────────── */

function scoreConfidence(
  merged: Parsed,
  llm: Parsed,
  heur: Parsed,
): Parsed['confidence'] {
  const llmConf = (llm.confidence ?? {}) as Record<string, Confidence | null | undefined>;
  const out: any = {};

  const bumpUp = (c: Confidence | null | undefined): Confidence =>
    c === 'low' ? 'medium' : c === 'medium' ? 'high' : 'high';

  const fields = ['customerName','phone','phone_mobile','email','street','city','leistung','vorgang'] as const;

  for (const f of fields) {
    const val = (merged as any)[f] as string | undefined;
    if (!val) { out[f] = null; continue; }

    const llmHas = !!(llm as any)[f];
    const heuHas = !!(heur as any)[f];
    const matchesHeuristic = heuHas && valuesEqual(f, val, (heur as any)[f]);

    // E-Mail vom Heuristik-Pfad ist immer „high" (Regex ist deterministisch)
    if ((f === 'email' || f === 'phone' || f === 'phone_mobile') && heuHas && matchesHeuristic) {
      out[f] = 'high';
      continue;
    }

    const base = (llmConf[f] as Confidence | undefined) ?? (llmHas ? 'medium' : 'low');

    // Heuristik bestätigt → eine Stufe rauf
    if (matchesHeuristic) {
      out[f] = bumpUp(base);
      continue;
    }

    out[f] = base;
  }

  // Overall: niedrigster Wert der besetzten Felder bestimmt die Gesamtnote
  const present = fields.map((f) => out[f]).filter(Boolean) as Confidence[];
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  if (present.length === 0) {
    out.overall = 'low';
  } else {
    const minRank = Math.min(...present.map((c) => rank[c]));
    out.overall = (Object.entries(rank).find(([, r]) => r === minRank)?.[0] as Confidence) ?? 'medium';
  }

  return out;
}
