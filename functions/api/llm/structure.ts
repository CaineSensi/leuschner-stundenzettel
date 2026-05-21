// Strukturiert rohen Anfrage-Text in Felder. Versucht erst Anthropic Claude
// (falls ANTHROPIC_API_KEY gesetzt), fällt sonst auf reine Regex/Heuristik
// zurück — beides liefert dasselbe Schema, damit das Frontend gleich
// weiterarbeiten kann.

export interface Env {
  ANTHROPIC_API_KEY?: string;
}

interface Parsed {
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
  /** Quelle der Strukturierung — fürs Debugging im Frontend. */
  parser: 'anthropic' | 'heuristic';
}

const PROMPT_SYSTEM = `Du bekommst den Rohtext einer Kunden-Anfrage für einen Garten- und Landschaftsbau-Betrieb (Doppelstabmattenzaun, Pflasterarbeiten, Erdarbeiten, Drainage, Rasen, Bagger-/Transportarbeiten). Extrahiere strukturierte Daten als JSON. Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, ohne Erklärung, ohne Markdown-Codefence.

Schema:
{
  "customerName": string | null,
  "phone": string | null,
  "email": string | null,
  "street": string | null,
  "zip": string | null,
  "city": string | null,
  "description": string | null,        // 1-2 Sätze, was der Kunde will
  "leistung": string | null,            // Stichwort (z.B. "Doppelstabmattenzaun", "Pflaster Hofeinfahrt")
  "dringlichkeit": "niedrig" | "normal" | "hoch" | null,
  "mengen": [{ "wert": string, "einheit": string, "was": string }],
  "source_guess": "mail" | "phone" | "whatsapp" | "letter" | "in_person" | "web" | null
}`;

async function parseWithAnthropic(text: string, apiKey: string): Promise<Parsed | null> {
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
      system: PROMPT_SYSTEM,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const raw = data?.content?.[0]?.text ?? '';
  try {
    const json = JSON.parse(raw);
    return { ...json, parser: 'anthropic' };
  } catch {
    return null;
  }
}

function parseHeuristic(text: string): Parsed {
  const out: Parsed = { parser: 'heuristic' };

  // E-Mail
  const mail = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (mail) out.email = mail[0];

  // Telefon — deutsche Formate
  const phone = text.match(/(?:\+49|0)[\s\-/]?\d{2,5}[\s\-/]?\d{3,}[\s\-/]?\d{0,}/);
  if (phone) out.phone = phone[0].replace(/\s+/g, ' ').trim();

  // PLZ + Stadt
  const plzCity = text.match(/\b(\d{5})\s+([A-ZÄÖÜ][a-zäöüß][\w\säöüß.\-/()]*)/);
  if (plzCity) {
    out.zip = plzCity[1];
    out.city = plzCity[2].trim().replace(/[.,]$/, '');
  } else {
    const plz = text.match(/\b\d{5}\b/);
    if (plz) out.zip = plz[0];
  }

  // Straße — Heuristik: Wort + Hausnummer (optional Zusatz)
  const street = text.match(/[A-ZÄÖÜ][\wäöüß.\- ]{2,}?(?:straße|str\.?|weg|allee|gasse|platz|ring|chaussee|damm)\s+\d+[a-z]?/i);
  if (street) out.street = street[0].trim();

  // Name — erste Zeile die wie "Vorname Nachname" aussieht
  const nameLine = text
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) =>
      /^[A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+)+$/.test(l) ||
      /^Herr\s|^Frau\s|^Familie\s/i.test(l)
    );
  if (nameLine) out.customerName = nameLine.replace(/^(Herr|Frau|Familie)\s+/i, '');

  // Mengen — primitiv: Zahl + Einheit
  const unitRe = /(\d+(?:[.,]\d+)?)\s*(m²|qm|m³|cbm|m|lfm|Std|Stunden|Stk|Stück|t|kg|km)\b/gi;
  const mengen: { wert: string; einheit: string; was: string }[] = [];
  let m;
  while ((m = unitRe.exec(text)) !== null) {
    mengen.push({ wert: m[1].replace(',', '.'), einheit: m[2], was: '' });
  }
  if (mengen.length) out.mengen = mengen.slice(0, 8);

  // Leistung — Stichwort-Match
  const leistungs = [
    'Doppelstabmattenzaun', 'Doppelstabzaun', 'Zaun',
    'Pflaster', 'Pflasterung', 'Hofeinfahrt', 'Terrasse',
    'Erdarbeiten', 'Bagger', 'Drainage', 'Rasen', 'Mutterboden',
    'Gartenmauer', 'Mauer', 'Rasenbord', 'Sichtschutz', 'Tor',
  ];
  for (const key of leistungs) {
    const re = new RegExp(`\\b${key}\\w*`, 'i');
    const hit = text.match(re);
    if (hit) { out.leistung = hit[0]; break; }
  }

  // Beschreibung — erste ~180 Zeichen sinnvoll
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length) out.description = compact.length > 200 ? compact.slice(0, 197) + '…' : compact;

  // Dringlichkeit
  if (/dringend|so schnell|asap|kurzfristig|sofort/i.test(text)) out.dringlichkeit = 'hoch';
  else if (/ohne Eile|in Ruhe|nächste(?:s)? Jahr|2027/i.test(text)) out.dringlichkeit = 'niedrig';
  else out.dringlichkeit = 'normal';

  // Quellen-Hinweis
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

    if (env.ANTHROPIC_API_KEY) {
      const llm = await parseWithAnthropic(text, env.ANTHROPIC_API_KEY);
      if (llm) {
        return new Response(JSON.stringify(llm), {
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const heur = parseHeuristic(text);
    return new Response(JSON.stringify(heur), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 });
  }
};
