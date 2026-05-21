// Strukturiert rohen Anfrage-Text in Felder.
//
// Eskalations-Reihenfolge:
//   1) Cloudflare Workers AI (Llama 3.1 8B) — Default, EU-Edge, im Account
//      schon enthalten. Binding `AI` aus dem Cloudflare-Pages-Dashboard.
//   2) Anthropic Claude Haiku — nur wenn ANTHROPIC_API_KEY gesetzt UND
//      Workers AI eine niedrige Confidence liefert (Hybrid-Eskalation,
//      derzeit nicht scharfgeschaltet, vorbereitet).
//   3) Heuristik (Regex/Pattern) — Notfall-Fallback ohne externe Calls,
//      damit das Anfragen-Modul nie komplett tot ist.
//
// Antwort-Schema (verträglich mit altem Frontend, neue Felder optional):
//   { vorgang, stamm{...}, inhalt{...}, dringlichkeit, source_guess,
//     confidence, parser, customerName, phone, email, street, zip, city,
//     description, leistung, mengen[] }

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
  phone?: string;
  email?: string;
  street?: string;
  zip?: string;
  city?: string;

  // Inhalt
  description?: string;
  leistung?: string;
  mengen?: { wert: string; einheit?: string; was?: string }[];
  termin?: string;

  // Metadaten
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';

  // Vertrauensgrad
  confidence?: Partial<Record<keyof Parsed | 'overall', Confidence>>;

  /** Welcher Pfad hat strukturiert — fürs Debugging im Frontend. */
  parser: 'workers-ai' | 'anthropic' | 'heuristic';
}

const SYSTEM_PROMPT = `Du strukturierst Kunden-Anfragen für einen Garten- und Landschaftsbau-Betrieb in Ostfriesland (Rund um's Haus Leuschner). Typische Leistungen: Doppelstabmattenzaun, Pflasterarbeiten (Hofeinfahrt, Terrasse), Erdarbeiten, Bagger-/Transportarbeiten, Drainage, Rasen anlegen, Mutterboden, Gartenmauer, Rasenbord, Sichtschutz, Tore.

Extrahiere die Felder unten als striktes JSON. Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, ohne Erklärung, ohne Markdown-Codefence.

Schema:
{
  "vorgang": "angebot" | "termin" | "reklamation" | "material" | "sonstiges",
  "customerName": string | null,
  "firma": string | null,
  "phone": string | null,
  "email": string | null,
  "street": string | null,
  "zip": string | null,
  "city": string | null,
  "description": string | null,
  "leistung": string | null,
  "mengen": [{ "wert": string, "einheit": string, "was": string }],
  "termin": string | null,
  "dringlichkeit": "niedrig" | "normal" | "hoch" | null,
  "source_guess": "mail" | "phone" | "whatsapp" | "letter" | "in_person" | "web" | null,
  "confidence": {
    "overall": "high" | "medium" | "low",
    "customerName": "high" | "medium" | "low" | null,
    "phone": "high" | "medium" | "low" | null,
    "email": "high" | "medium" | "low" | null,
    "street": "high" | "medium" | "low" | null,
    "city": "high" | "medium" | "low" | null,
    "leistung": "high" | "medium" | "low" | null,
    "vorgang": "high" | "medium" | "low"
  }
}

Regeln:
- vorgang "angebot" wenn Kunde nach Preis/Angebot/Kostenvoranschlag fragt
- vorgang "termin" wenn nur Rückruf, Aufmaß-Termin, Besichtigung gewünscht (kein Angebot direkt verlangt)
- vorgang "reklamation" bei Beschwerde über bereits ausgeführte Arbeit
- vorgang "material" wenn der Kunde nur Material (z.B. Mutterboden, Pflastersteine) bestellt
- vorgang "sonstiges" sonst
- Bei Tippfehlern oder informellem Stil: trotzdem extrahieren, confidence "medium" setzen
- Bei unsicheren Werten lieber null + confidence "low" statt zu raten
- Mengen mit Einheit (m, m², qm, m³, lfm, Stk, t, Std)
- Telefon im Originalformat lassen
- Wenn Name in Inline-Phrase steht ("mein Name ist X", "ich bin X", "hier spricht X"), übernehmen
- Straße: nur die echte Adresse extrahieren, nicht den Fließtext
- description: 1-2 Sätze, was der Kunde will, NICHT der ganze Originaltext
- Antworte AUSSCHLIESSLICH mit dem JSON-Objekt`;

/**
 * Workers AI · Llama 3.1 8B Instruct.
 * Edge-Run im Cloudflare-Account, inkludiert (10k Neuronen/Tag im Free-Tier).
 */
async function parseWithWorkersAI(text: string, ai: AiBinding): Promise<Parsed | null> {
  try {
    const resp: any = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 1024,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    const raw: string = resp?.response ?? resp?.result?.response ?? '';
    if (!raw) return null;
    const cleaned = stripCodeFence(raw);
    const json = safeJson(cleaned);
    if (!json) return null;
    return normalize({ ...json, parser: 'workers-ai' });
  } catch {
    return null;
  }
}

/** Optional: Anthropic Haiku. Erst aktiv wenn ANTHROPIC_API_KEY gesetzt. */
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
        max_tokens: 1024,
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
  const out: Parsed = { parser: p.parser ?? 'workers-ai' };
  if (p.vorgang && ['angebot','termin','reklamation','material','sonstiges'].includes(p.vorgang)) out.vorgang = p.vorgang;
  for (const k of ['customerName','firma','phone','email','street','zip','city','description','leistung','termin'] as const) {
    if (typeof p[k] === 'string' && p[k].trim().length) (out as any)[k] = p[k].trim();
  }
  if (Array.isArray(p.mengen)) {
    out.mengen = p.mengen
      .filter((m: any) => m && typeof m.wert === 'string')
      .slice(0, 8)
      .map((m: any) => ({ wert: String(m.wert), einheit: m.einheit ?? '', was: m.was ?? '' }));
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

function parseHeuristic(text: string): Parsed {
  const out: Parsed = { parser: 'heuristic', confidence: { overall: 'low' } };

  // E-Mail
  const mail = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (mail) out.email = mail[0];

  // Telefon
  const phone = text.match(/(?:Tel\.?|Telefon|Mobil|Phone)?[:\s]*((?:\+49|0)[\d\s\-/]{6,})/i);
  if (phone) out.phone = phone[1].replace(/\s+/g, ' ').trim();

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

  // Leistung
  const leistungs = ['Doppelstabmattenzaun','Doppelstabzaun','Zaun','Pflaster','Pflasterung','Hofeinfahrt','Terrasse','Erdarbeiten','Bagger','Drainage','Rasen','Mutterboden','Gartenmauer','Mauer','Rasenbord','Sichtschutz','Tor'];
  for (const key of leistungs) {
    const re = new RegExp(`\\b${key}\\w*`, 'i');
    const hit = text.match(re);
    if (hit) { out.leistung = hit[0]; break; }
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
  try {
    const body = (await request.json()) as { text?: string };
    const text = (body?.text ?? '').trim();
    if (!text) {
      return new Response(JSON.stringify({ error: 'no text' }), { status: 400 });
    }

    // 1) Workers AI (Default-Pfad)
    if (env.AI) {
      const wa = await parseWithWorkersAI(text, env.AI);
      if (wa) {
        // Heuristik als Backfill für Felder, die das LLM eventuell weggelassen hat
        const heur = parseHeuristic(text);
        const merged = mergeBackfill(wa, heur);
        return jsonResponse(merged);
      }
    }

    // 2) Anthropic (nur wenn explizit konfiguriert)
    if (env.ANTHROPIC_API_KEY) {
      const an = await parseWithAnthropic(text, env.ANTHROPIC_API_KEY);
      if (an) {
        const heur = parseHeuristic(text);
        return jsonResponse(mergeBackfill(an, heur));
      }
    }

    // 3) Heuristik (Notfall)
    return jsonResponse(parseHeuristic(text));
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 });
  }
};

function jsonResponse(p: Parsed): Response {
  return new Response(JSON.stringify(p), {
    headers: { 'content-type': 'application/json' },
  });
}

/** LLM-Ergebnis hat Vorrang; Heuristik füllt nur Lücken. So bekommen wir
 *  z.B. zuverlässig die E-Mail-Adresse, selbst wenn das LLM-JSON sie
 *  vergisst. */
function mergeBackfill(primary: Parsed, heur: Parsed): Parsed {
  const out: any = { ...primary };
  for (const k of ['email','phone','zip','city','street','customerName','leistung','description'] as const) {
    if (!out[k] && (heur as any)[k]) out[k] = (heur as any)[k];
  }
  if (!out.mengen && heur.mengen) out.mengen = heur.mengen;
  if (!out.dringlichkeit && heur.dringlichkeit) out.dringlichkeit = heur.dringlichkeit;
  if (!out.source_guess && heur.source_guess) out.source_guess = heur.source_guess;
  if (!out.vorgang && heur.vorgang) out.vorgang = heur.vorgang;
  return out as Parsed;
}
