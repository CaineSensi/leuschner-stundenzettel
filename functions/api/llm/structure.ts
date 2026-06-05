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
  /** Google Gemini Flash — primärer Motor, wenn gesetzt (gratis Tier, ~2s).
   *  Als Cloudflare-Pages-Secret hinterlegt. Fehlt der Key, fällt die
   *  Pipeline automatisch auf Workers AI (70B) zurück. */
  GEMINI_API_KEY?: string;
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
  /** M8: Mehrere Gewerke pro Anfrage strukturiert.
   *  M12: jede Leistung kann zusätzlich konkret benannte Materialien tragen
   *  (Farbe, Qualität, Material-Art, Sondermaß, Lieferant). */
  leistungen?: {
    name: string;
    mengen?: { wert: string; einheit?: string; was?: string }[];
    materialien?: { name: string; spec?: string; menge?: { wert: string; einheit?: string }; note?: string }[];
    /** M14: Originaltext-Zitate, die diese Leistung im Eingangstext belegen.
     *  Wörtliche kurze Phrasen (1–8 Wörter), max 3 pro Leistung. Frontend
     *  färbt diese Stellen im Originaltext ein. */
    source_quotes?: string[];
  }[];
  mengen?: { wert: string; einheit?: string; was?: string }[];
  termin?: string;

  // Metadaten
  dringlichkeit?: 'niedrig' | 'normal' | 'hoch';
  source_guess?: 'mail' | 'phone' | 'whatsapp' | 'letter' | 'in_person' | 'web';

  // Vertrauensgrad
  confidence?: Partial<Record<keyof Parsed | 'overall', Confidence>>;

  /** Welcher Pfad hat strukturiert — fürs Debugging im Frontend. */
  parser: 'gemini' | 'workers-ai-70b' | 'workers-ai-8b' | 'anthropic' | 'heuristic';

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

/* ────────────────────────────────────────────────────────────────────────
   Modell-Wahl (Workers AI)
   ────────────────────────────────────────────────────────────────────────
   Der Default kann pro Request über `model` im Body übersteuert werden —
   ausschließlich aus der Whitelist (kein beliebiger Modell-String von außen).
   Dient dem fairen Live-Benchmark verschiedener Modelle mit identischem
   Prompt + Pipeline. MODEL_PRIMARY ist der produktive Default. */
const MODEL_PRIMARY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct';
/** Gemini-Flash-Modell. 2.5-flash ist das aktuelle Flash (2.0-flash ist für
 *  Billing-Projekte abgekündigt). Schnell, stark bei strukturierter Extraktion,
 *  sehr günstig (~0,02 Cent/Anfrage). */
const GEMINI_MODEL = 'gemini-2.5-flash';
const MODEL_WHITELIST = new Set<string>([
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/meta/llama-3.1-8b-instruct',
]);
function pickModel(requested?: string): string {
  return requested && MODEL_WHITELIST.has(requested) ? requested : MODEL_PRIMARY;
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
  "leistungen": [{
    "name": string,
    "mengen": [{ "wert": string, "einheit": string, "was": string }],
    "materialien": [{ "name": string, "spec": string | null, "menge": { "wert": string, "einheit": string } | null, "note": string | null }],
    "source_quotes": [string]
  }],
  "mengen": [{ "wert": string, "einheit": string, "was": string }],
  "termin": string | null,
  "dringlichkeit": "niedrig" | "normal" | "hoch" | null,
  "source_guess": "mail" | "phone" | "whatsapp" | "letter" | "in_person" | "web" | null
}

${buildDomainHint()}

Regeln:
- vorgang "angebot" wenn Kunde nach Preis/Angebot/Kostenvoranschlag fragt
- vorgang "termin" wenn nur Rückruf, Aufmaß-Termin, Besichtigung gewünscht (kein Angebot direkt verlangt)
- vorgang "reklamation" bei Beschwerde über bereits ausgeführte Arbeit
- vorgang "material" wenn der Kunde nur Material (z.B. Mutterboden, Pflastersteine) bestellt
- vorgang "sonstiges" sonst
- Bei Tippfehlern oder informellem Stil: trotzdem extrahieren
- Bei unsicheren Werten lieber null statt zu raten
- Mengen mit Einheit (m, m², m³, lfm, Stk, t, Std — IMMER Standardform aus Glossar) und IMMER "was" füllen (was ist gemeint, z.B. "Zaun", "Pflasterfläche", "Mutterboden")
- WICHTIG bei mehreren Gewerken: leistungen[] enthält JEDE einzelne Leistung mit ihrer eigenen mengen[]-Liste. leistung (Singular) ist dann leistungen[0].name. Das globale mengen[]-Array darf zusätzlich existieren als Gesamtübersicht, ist aber redundant.
- GRANULARITÄT der leistungen[]: Ein Eintrag ist ein echtes GEWERK bzw. eine Arbeitsart (z.B. "Pflasterarbeiten", "Zaunbau", "Drainage", "Erdarbeiten", "Rasen anlegen", "Heckenschnitt"), NICHT ein einzelner Arbeitsort, ein Bauteil oder eine Teilaufgabe. Beispiel: "Ausbesserung am bestehenden Pflaster", "Führungsschienen der Poolabdeckung absenken", "Gartenhütte lasieren" sind KEINE drei Leistungen — das sind Teilaufgaben, die unter EIN passendes Gewerk gehören (hier "Pflaster-/Ausbesserungsarbeiten"). Lieber 1–2 saubere Gewerke mit mehreren source_quotes als viele Mini-Leistungen. Nur klar getrennte Gewerke (z.B. Zaun UND Pflaster) bekommen eigene Einträge.
- MATERIAL-ERKENNUNG pro Leistung: Konkrete Material-Wünsche (Farbe wie "anthrazit"/"RAL 7016", Qualität wie "Schwer"/"8/6/8", Material-Art wie "Naturstein"/"Granit"/"Beton C30/37"/"Splitt 8/16", Sondermaß wie "183×250cm", Lieferant wie "Hesse") gehören in leistungen[].materialien[]. Jedes Material klar EINER Leistung zuordnen (z.B. anthrazit gehört zum Zaun, nicht zum Pflaster). Bei ALTERNATIVEN ("Naturstein oder Betonrandsteine") beide als separate Materialien aufnehmen + note="Alternativ-Wahl gewünscht" am ersten. Wenn ein konkretes Maß oder eine Menge zum Material genannt ist, in menge füllen (z.B. "Doppelstabmatte schwer 183×250 anthrazit" → spec="183×250", menge=null, name="Doppelstabmatte", weil Stückzahl woanders).
- QUELLEN-ZITATE pro Leistung (source_quotes): Liste WÖRTLICHER kurzer Phrasen aus dem Originaltext (1–8 Wörter, max 3 Phrasen pro Leistung), die diese Leistung im Text belegen. ZWINGEND wörtlich (Zeichen-für-Zeichen, mit Umlauten und Satzzeichen wie im Original), damit das Frontend sie im Text wiederfinden und farbig markieren kann. Mengen-Angaben dürfen Teil der Quote sein. Beispiel: für "Pflasterung einer Terrasse, ca. 30 m²." gehören "Pflasterung einer Terrasse" und "ca. 30 m²" in source_quotes.
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
{"vorgang":"angebot","customerName":"Josef Borgmann","firma":null,"phone":"04961 / 12345","phone_mobile":null,"email":"m.borgmann@web.de","street":"Tunxdorferstraße 46","zip":"26871","city":"Papenburg","description":"Angebot für Doppelstabmattenzaun anthrazit, ca. 80 m Höhe 1,80 m, plus zwei Tore.","leistung":"Doppelstabmattenzaun","leistungen":[{"name":"Doppelstabmattenzaun","mengen":[{"wert":"80","einheit":"m","was":"Zaun"},{"wert":"1,80","einheit":"m","was":"Höhe"},{"wert":"2","einheit":"Stk","was":"Tore"}],"materialien":[{"name":"anthrazit","spec":"RAL 7016","menge":null,"note":"Farbwunsch"}],"source_quotes":["Doppelstabmattenzaun, anthrazit","ca. 80 m, Höhe 1,80 m","zwei Tore"]}],"mengen":[{"wert":"80","einheit":"m","was":"Zaun"},{"wert":"1,80","einheit":"m","was":"Höhe"},{"wert":"2","einheit":"Stk","was":"Tore"}],"termin":null,"dringlichkeit":"normal","source_guess":"mail"}

BEISPIEL 2 — Telefon-Notiz (mehrteilig, zeigt leistungen[])
Eingabe:
"Frau Hainke aus Bunde, 0171 2345678, will Hofeinfahrt gepflastert ca 45 qm und Drainage davor. Bittet um Rückruf."

Ausgabe:
{"vorgang":"angebot","customerName":"Hainke","firma":null,"phone":null,"phone_mobile":"0171 2345678","email":null,"street":null,"zip":null,"city":"Bunde","description":"Hofeinfahrt pflastern ca. 45 m² plus Drainage davor. Bittet um Rückruf.","leistung":"Pflasterarbeiten","leistungen":[{"name":"Pflasterarbeiten","mengen":[{"wert":"45","einheit":"m²","was":"Hofeinfahrt"}],"materialien":[],"source_quotes":["Hofeinfahrt gepflastert ca 45 qm"]},{"name":"Drainage","mengen":[],"materialien":[],"source_quotes":["Drainage davor"]}],"mengen":[{"wert":"45","einheit":"m²","was":"Hofeinfahrt"}],"termin":"Rückruf gewünscht","dringlichkeit":"normal","source_guess":"phone"}

BEISPIEL 3 — WhatsApp (informell, Tippfehler)
Eingabe:
"moin, hier de haan aus leer. brauch dringen mutterboden ca 70 kubik fürn neuen garten. wann könnt ihr liefern? 015112345678"

Ausgabe:
{"vorgang":"material","customerName":"De Haan","firma":null,"phone":null,"phone_mobile":"015112345678","email":null,"street":null,"zip":null,"city":"Leer","description":"Lieferung Mutterboden ca. 70 m³ für neuen Garten. Liefertermin gesucht.","leistung":"Mutterboden","leistungen":[{"name":"Mutterboden","mengen":[{"wert":"70","einheit":"m³","was":"Mutterboden"}],"materialien":[{"name":"Mutterboden","spec":null,"menge":{"wert":"70","einheit":"m³"},"note":"Bestellung Material, kein Verbau"}],"source_quotes":["mutterboden ca 70 kubik","fuern neuen garten"]}],"mengen":[{"wert":"70","einheit":"m³","was":"Mutterboden"}],"termin":"so schnell wie möglich","dringlichkeit":"hoch","source_guess":"whatsapp"}

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
    // 70B fp8-fast liefert manchmal {response: {text: '...'}} statt {response: '...'} —
    // wir prüfen beide Pfade. stripCodeFence stringifiziert defensiv.
    const candidate =
      resp?.response?.text ??
      resp?.response ??
      resp?.result?.response?.text ??
      resp?.result?.response ??
      '';
    if (!candidate) return { parsed: null, error: 'empty response: ' + JSON.stringify(resp).slice(0, 200) };
    const cleaned = stripCodeFence(candidate);
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

/** Google Gemini Flash · primärer Motor wenn GEMINI_API_KEY gesetzt.
 *  Gratis-Tier, ~2s, volle fp16-Präzision. `responseMimeType: application/json`
 *  erzwingt valides JSON (kein Codefence-Geraffel). Bei jedem Fehler (Rate-Limit,
 *  4xx/5xx, leere Antwort) liefert die Funktion `{parsed:null, error}` — der
 *  Aufrufer fällt dann sauber auf Workers AI zurück. */
async function parseWithGemini(
  text: string,
  apiKey: string,
  model: string = GEMINI_MODEL,
): Promise<{ parsed: Parsed | null; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const reqBody = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      // Reasoning AUS: 2.5-flash würde sonst das Token-Budget fürs interne
      // "Denken" verbrauchen und das eigentliche JSON abschneiden
      // (json-parse-fail bei langen Anfragen). Ohne Thinking ist es zudem
      // schneller und günstiger — genau richtig fürs sparsame Budget.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Gemini wirft sporadisch 503 (UNAVAILABLE, "high demand") oder 429. Diese
  // Fehler sind transient — ein schneller Retry fängt die meisten ab, bevor
  // wir aufs (langsame) Workers-AI-70B zurückfallen. Fehlgeschlagene Calls
  // (503/429) werden von Google nicht berechnet → sparsam-konform.
  const MAX_ATTEMPTS = 2;
  let lastError = 'gemini: unbekannter Fehler';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: reqBody,
      });
      if (!resp.ok) {
        const errTxt = await resp.text();
        lastError = `gemini ${resp.status}: ${errTxt.replace(/\s+/g, ' ').slice(0, 160)}`;
        const transient = resp.status === 503 || resp.status === 429 || resp.status === 500;
        if (transient && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        return { parsed: null, error: lastError };
      }
      const data: any = await resp.json();
      const raw: string =
        (data?.candidates?.[0]?.content?.parts ?? [])
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .join('') || '';
      if (!raw) {
        const reason = data?.candidates?.[0]?.finishReason ?? 'unknown';
        lastError = `gemini empty (finishReason=${reason})`;
        if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 600)); continue; }
        return { parsed: null, error: lastError };
      }
      const json = safeJson(stripCodeFence(raw));
      if (!json) return { parsed: null, error: 'gemini json-parse-fail: ' + raw.slice(0, 160) };
      const out = normalize({ ...json, parser: 'gemini' });
      out.meta = { ...(out.meta ?? {}), model };
      return { parsed: out };
    } catch (e: any) {
      lastError = 'gemini threw: ' + String(e?.message ?? e).slice(0, 160);
      if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 600)); continue; }
      return { parsed: null, error: lastError };
    }
  }
  return { parsed: null, error: lastError };
}

/** Robust gegen unerwartete Response-Shapes — Workers AI liefert beim
 *  70B-Modell gelegentlich Objekte statt Strings (z.B. {text: '...'} oder
 *  Tool-Call-Strukturen). Wir stringifizieren defensiv. */
function stripCodeFence(s: unknown): string {
  const str = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  return str.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
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
  // Telefon-Sanity (mehrere Korrekturen, weil LLMs hier auffällig oft danebenliegen):
  //   a) Nur `phone` gesetzt, Wert hat Mobil-Vorwahl → in `phone_mobile` schieben
  //   b) Beide gesetzt und gleicher Wert → Duplikat entfernen, ins passende Feld
  //   c) Beide gesetzt, verschiedene Werte → lassen, sind echte zwei Anschlüsse
  const isMobileNumber = (s: string) =>
    /^(?:\+49\s*|0)1[5-7]\d/.test(s.replace(/[\s\-/]/g, ''));
  const isLandline = (s: string) =>
    /^(?:\+?49|0)[2-9]\d/.test(s.replace(/[\s\-/]/g, '')) && !isMobileNumber(s);
  const normForCompare = (s: string) =>
    s.replace(/[\s\-/().]/g, '').replace(/^\+49/, '0').toLowerCase();

  if (out.phone && !out.phone_mobile && isMobileNumber(out.phone)) {
    out.phone_mobile = out.phone;
    delete out.phone;
  } else if (out.phone && out.phone_mobile && normForCompare(out.phone) === normForCompare(out.phone_mobile)) {
    // Duplikat — nur EINS behalten, je nach Vorwahl
    if (isMobileNumber(out.phone)) delete out.phone;
    else if (isLandline(out.phone_mobile)) delete out.phone_mobile;
    else delete out.phone; // bei Unsicherheit → behalten als phone_mobile (Default für moderne Erstkontakte)
  } else if (out.phone && out.phone_mobile && isMobileNumber(out.phone) && isLandline(out.phone_mobile)) {
    // Werte sind in den falschen Slots — tauschen
    const tmp = out.phone;
    out.phone = out.phone_mobile;
    out.phone_mobile = tmp;
  }
  if (Array.isArray(p.mengen)) {
    out.mengen = p.mengen
      .filter((m: any) => m && typeof m.wert === 'string')
      .slice(0, 8)
      .map((m: any) => ({ wert: String(m.wert), einheit: normEinheit(m.einheit), was: m.was ?? '' }));
  }

  // M8/M12: leistungen[] mit pro-Leistung-Mengen + Materialien
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
        materialien: Array.isArray(l.materialien)
          ? l.materialien
              .filter((mat: any) => mat && typeof mat.name === 'string' && mat.name.trim().length)
              .slice(0, 8)
              .map((mat: any) => ({
                name: String(mat.name).trim(),
                spec: typeof mat.spec === 'string' && mat.spec.trim() ? mat.spec.trim() : undefined,
                menge: mat.menge && typeof mat.menge.wert === 'string'
                  ? { wert: String(mat.menge.wert), einheit: normEinheit(mat.menge.einheit) }
                  : undefined,
                note: typeof mat.note === 'string' && mat.note.trim() ? mat.note.trim() : undefined,
              }))
          : undefined,
        source_quotes: Array.isArray(l.source_quotes)
          ? l.source_quotes
              .filter((q: any) => typeof q === 'string' && q.trim().length >= 3)
              .slice(0, 4)
              .map((q: string) => q.trim())
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

  // Telefon — alle Nummern finden, dann nach Mobil vs. Festnetz sortieren.
  // Das Lookbehind (?<![\w-]) verhindert Treffer MITTEN in Datei-/Datums-Tokens
  // wie "VID-20260424-WA0016.mp4" (WhatsApp-Export) oder "20260424" — eine echte
  // Nummer steht frei (nach Leerzeichen/Zeilenanfang/Doppelpunkt), nicht direkt
  // hinter einem Wortzeichen oder Bindestrich.
  const phoneRe = /(?:(Tel\.?|Telefon|Festnetz|Mobil|Handy|Mobil-Nr\.?|Phone)?[:\s]*)?((?<![\w-])(?:\+49|0)[\d\s\-/]{6,})/gi;
  const phones: { tag: string; value: string }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = phoneRe.exec(text)) !== null) {
    const value = pm[2].replace(/\s+/g, ' ').trim();
    // Echte DE-Nummer hat mind. 8 Ziffern (Vorwahl + Anschluss). Kürzeres ist
    // fast immer Müll aus Datei-/Datumsstrings ("0260424" aus VID-20260424).
    if (value.replace(/\D/g, '').length < 8) continue;
    const tag = (pm[1] || '').toLowerCase();
    if (!phones.find((p) => p.value === value)) phones.push({ tag, value });
  }
  for (const p of phones) {
    const isMobile = /mobil|handy/i.test(p.tag) || /^(?:\+49\s*|0)1[5-7]\d/.test(p.value.replace(/\s/g, ''));
    if (isMobile && !out.phone_mobile) out.phone_mobile = p.value;
    else if (!isMobile && !out.phone) out.phone = p.value;
    else if (isMobile && !out.phone) out.phone = p.value; // Fallback
  }

  // PLZ + Stadt. WICHTIG: erkannte Telefonnummern vorher maskieren, sonst wird
  // eine Ortsvorwahl (z.B. "04958") fälschlich als PLZ gegriffen. Stadt darf
  // auch klein geschrieben sein (informelle WhatsApp-Anfragen: "26844 jemgum").
  let textNoPhone = text;
  for (const p of phones) textNoPhone = textNoPhone.split(p.value).join(' ');
  const plzCity = textNoPhone.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöü][a-zäöüß][\wäöüß-]*(?:[\s/-][A-Za-zÄÖÜäöü][a-zäöüß][\wäöüß-]+){0,2})/);
  if (plzCity) {
    out.zip = plzCity[1];
    // Ort mit großem Anfangsbuchstaben normalisieren (jemgum -> Jemgum)
    out.city = plzCity[2].trim().replace(/^[a-zäöü]/, (c) => c.toUpperCase());
  } else {
    const plz = textNoPhone.match(/\b\d{5}\b/);
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
  // M13: Wenn Client SSE will, streamen wir Schritt-für-Schritt-Events.
  // Sonst klassische JSON-Response (Backwards-Compat).
  const wantsStream = request.headers.get('accept')?.includes('text/event-stream');
  if (wantsStream) {
    return streamResponse(request, env);
  }

  // Debug-Header: zeigen welche Bindings die Function tatsächlich sieht
  const debug = {
    hasAI: !!env.AI,
    hasAnthropic: !!env.ANTHROPIC_API_KEY,
    hasGemini: !!env.GEMINI_API_KEY,
    aiError: '' as string,
    aiPath: '' as string,
    preclean: '' as string,
  };
  try {
    const body = (await request.json()) as { text?: string; selfCheck?: boolean; model?: string };
    const rawText = (body?.text ?? '').trim();
    const primaryModel = pickModel(body?.model);
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

    // 0) Google Gemini Flash (Primärmotor, wenn Key gesetzt) — außer es wurde
    //    explizit ein Workers-AI-Modell angefragt (Benchmark/Vergleich).
    const forceWorkersModel = !!body?.model && MODEL_WHITELIST.has(body.model);
    if (env.GEMINI_API_KEY && !forceWorkersModel) {
      const g = await parseWithGemini(llmInput, env.GEMINI_API_KEY);
      if (g.parsed) {
        debug.aiPath = 'gemini:' + GEMINI_MODEL;
        const merged = mergeCrossValidate(g.parsed, heur, rawText);
        attachPrecleanMeta(merged, pre);
        if (shouldSelfCheck(rawText, body?.selfCheck) && env.AI) {
          merged.meta = { ...(merged.meta ?? {}), review_hints: await selfCheck(rawText, merged, env.AI) };
        }
        return jsonResponse(merged, debug);
      }
      debug.aiError = 'gemini: ' + (g.error ?? 'unknown') + ' | ';
    }

    // 1) Workers AI · Llama 3.3 70B fp8-fast (Fallback / oder Benchmark-Modell)
    if (env.AI) {
      const wa70 = await runWorkersAi(llmInput, env.AI, primaryModel);
      if (wa70.parsed) {
        debug.aiPath = primaryModel;
        const merged = mergeCrossValidate(wa70.parsed, heur, rawText);
        attachPrecleanMeta(merged, pre);
        if (shouldSelfCheck(rawText, body?.selfCheck)) {
          merged.meta = { ...(merged.meta ?? {}), review_hints: await selfCheck(rawText, merged, env.AI) };
        }
        return jsonResponse(merged, debug);
      }
      debug.aiError = primaryModel + ': ' + (wa70.error ?? 'unknown');

      // 2) Workers AI · Llama 3.1 8B (Fallback wenn Primärmodell versagt)
      const wa8 = await runWorkersAi(llmInput, env.AI, MODEL_FALLBACK);
      if (wa8.parsed) {
        debug.aiPath = 'llama-3.1-8b-fallback';
        const merged = mergeCrossValidate(wa8.parsed, heur, rawText);
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
        const merged = mergeCrossValidate(an, heur, rawText);
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

/** Self-Check ist standardmäßig AUS: Der zweite 70B-Call hat in der Praxis
 *  zu oft „Hinweise" produziert, obwohl die Extraktion stimmte (gefühlte
 *  Fehler), und kostete 1–3 s extra. Er läuft nur noch, wenn der Client ihn
 *  ausdrücklich anfordert (`selfCheck: true`) UND der Text substantiell ist. */
function shouldSelfCheck(rawText: string, optIn?: boolean): boolean {
  if (!optIn) return false;
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

/* ────────────────────────────────────────────────────────────────────────
   M13 · SSE-Streaming
   ────────────────────────────────────────────────────────────────────────
   Sendet Schritt-Events während der Verarbeitung. Frontend zeigt jeden
   Schritt live (○ pending → ⏳ running → ✓ done) mit echten Millisekunden.

   Event-Format:
     event: step
     data: {"id":"preclean","status":"done","ms":47,"info":"3 Schritte"}

   Letztes Event:
     event: result
     data: <komplette Parsed-JSON>

   Bei Fehler:
     event: error
     data: {"message": "..."}
   ──────────────────────────────────────────────────────────────────────── */

async function streamResponse(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { text?: string; selfCheck?: boolean; model?: string };
  const rawText = (body?.text ?? '').trim();
  const primaryModel = pickModel(body?.model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const step = (id: string, status: 'start' | 'done' | 'skipped', extra: Record<string, any> = {}) => {
        send('step', { id, status, ms: Date.now() - t0, ...extra });
      };

      try {
        if (!rawText) {
          send('error', { message: 'no text' });
          controller.close();
          return;
        }

        // 1) Pre-Cleaning
        step('preclean', 'start');
        const pre = preClean(rawText);
        step('preclean', 'done', {
          applied: pre.applied,
          shrunkBy: pre.shrunkBy,
          info: pre.applied.length ? pre.applied.join(' · ') : 'nichts zu tun',
        });

        // 2) Heuristik (Regex)
        step('heuristik', 'start');
        const heur = parseHeuristic(rawText);
        const heurFields = ['email', 'phone', 'phone_mobile', 'zip', 'city', 'street', 'customerName', 'leistung']
          .filter((f) => !!(heur as any)[f]).length;
        step('heuristik', 'done', { info: `${heurFields} Felder erkannt` });

        const llmInput = pre.headers ? buildLlmInputWithHeaders(pre.cleaned, pre.headers) : pre.cleaned;

        // 3) LLM Primary — Gemini Flash, dann Workers AI (70B→8B), dann Anthropic
        let merged: Parsed | null = null;
        let usedPath = '';

        const forceWorkersModel = !!body?.model && MODEL_WHITELIST.has(body.model);
        if (env.GEMINI_API_KEY && !forceWorkersModel) {
          step('llm', 'start', { model: 'Gemini Flash' });
          const g = await parseWithGemini(llmInput, env.GEMINI_API_KEY);
          if (g.parsed) {
            usedPath = 'gemini:' + GEMINI_MODEL;
            step('llm', 'done', { model: 'Gemini Flash', info: 'JSON erfolgreich geparst' });
            step('crossvalidate', 'start');
            merged = mergeCrossValidate(g.parsed, heur, rawText);
            attachPrecleanMeta(merged, pre);
            const conflicts = merged.meta?.conflicts?.length ?? 0;
            step('crossvalidate', 'done', { info: conflicts ? `${conflicts} Konflikte gelöst` : 'keine Konflikte' });
          } else {
            step('llm', 'done', { model: 'Gemini Flash', info: 'fehlgeschlagen, weiche auf Workers AI aus' });
          }
        }

        if (!merged && env.AI) {
          step('llm', 'start', { model: primaryModel });
          const wa70 = await runWorkersAi(llmInput, env.AI, primaryModel);
          if (wa70.parsed) {
            usedPath = primaryModel;
            step('llm', 'done', { model: primaryModel, info: 'JSON erfolgreich geparst' });
            // 4) Cross-Validate
            step('crossvalidate', 'start');
            merged = mergeCrossValidate(wa70.parsed, heur, rawText);
            attachPrecleanMeta(merged, pre);
            const conflicts = merged.meta?.conflicts?.length ?? 0;
            step('crossvalidate', 'done', { info: conflicts ? `${conflicts} Konflikte gelöst` : 'keine Konflikte' });
          } else {
            step('llm', 'done', { model: primaryModel, info: 'fehlgeschlagen, versuche 8B-Fallback' });
            step('llm', 'start', { model: 'Llama 3.1 8B' });
            const wa8 = await runWorkersAi(llmInput, env.AI, MODEL_FALLBACK);
            if (wa8.parsed) {
              usedPath = 'llama-3.1-8b-fallback';
              step('llm', 'done', { model: 'Llama 3.1 8B', info: 'Fallback erfolgreich' });
              step('crossvalidate', 'start');
              merged = mergeCrossValidate(wa8.parsed, heur, rawText);
              attachPrecleanMeta(merged, pre);
              const conflicts = merged.meta?.conflicts?.length ?? 0;
              step('crossvalidate', 'done', { info: conflicts ? `${conflicts} Konflikte gelöst` : 'keine Konflikte' });
            }
          }
        }

        if (!merged && env.ANTHROPIC_API_KEY) {
          step('llm', 'start', { model: 'Claude Haiku' });
          const an = await parseWithAnthropic(llmInput, env.ANTHROPIC_API_KEY);
          if (an) {
            usedPath = 'anthropic-haiku';
            step('llm', 'done', { model: 'Claude Haiku' });
            merged = mergeCrossValidate(an, heur, rawText);
            attachPrecleanMeta(merged, pre);
          }
        }

        if (!merged) {
          step('llm', 'skipped', { info: 'alle LLM-Pfade gescheitert' });
          usedPath = 'heuristic-only';
          merged = heur;
          attachPrecleanMeta(merged, pre);
        }

        // 5) Self-Check — standardmäßig AUS (war zu meckerig + kostet einen
        //    kompletten zweiten 70B-Call). Nur wenn der Client ihn ausdrücklich
        //    per selfCheck:true anfordert und der 70B-Pfad griff.
        if (env.AI && usedPath === primaryModel && shouldSelfCheck(rawText, body?.selfCheck)) {
          step('selfcheck', 'start');
          const hints = await selfCheck(rawText, merged, env.AI);
          if (hints) {
            merged.meta = { ...(merged.meta ?? {}), review_hints: hints };
            const found = (hints.missing?.length ?? 0) + (hints.potentially_wrong?.length ?? 0);
            step('selfcheck', 'done', { info: found ? `${found} Hinweise gefunden` : 'alles passt' });
          } else {
            step('selfcheck', 'done', { info: 'kein Befund' });
          }
        } else {
          step('selfcheck', 'skipped', { info: 'aus (auf Wunsch per Button zuschaltbar)' });
        }

        // 6) Done
        step('done', 'done', { totalMs: Date.now() - t0, path: usedPath });
        send('result', merged);
        controller.close();
      } catch (err: any) {
        send('error', { message: String(err?.message ?? err).slice(0, 300) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

function jsonResponse(p: Parsed, debug: any): Response {
  // HTTP-Header dürfen keine Zeilenumbrüche/Steuerzeichen enthalten — sonst
  // wirft die Runtime "Invalid header value" (500). Gemini-Fehlermeldungen
  // enthalten mehrzeiliges JSON, darum hier zwingend säubern + kürzen.
  const hsan = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 300);
  return new Response(JSON.stringify(p), {
    headers: {
      'content-type': 'application/json',
      'x-ai-available': String(debug.hasAI),
      'x-anthropic-available': String(debug.hasAnthropic),
      'x-gemini-available': String(debug.hasGemini),
      'x-ai-path': hsan(debug.aiPath),
      'x-ai-error': hsan(debug.aiError),
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

/** Kontaktfelder: hier kopiert die Regex zeichengenau, während LLMs gern
 *  Ziffern verdrehen. Stehen beide Werte im Text, gewinnt darum die Regex. */
const CONTACT_FIELDS = new Set(['email','phone','phone_mobile','zip']);

function normPhone(s?: string): string {
  return (s ?? '').replace(/\s|\-|\/|\(|\)|\./g, '').toLowerCase();
}
function normStr(s?: string): string {
  return (s ?? '').trim().toLowerCase();
}

/** Steht ein extrahierter Wert wörtlich im Originaltext? Das ist der stärkste
 *  Beleg dafür, dass er korrekt ist (kein LLM-Halluzinat, kein Regex-Fehlgriff).
 *  - Telefon: über die letzten 7+ Ziffern (prefix-/format-unabhängig)
 *  - sonst: normalisierter Teilstring-Vergleich (case-insensitiv) */
function appearsInText(field: string, value: string | undefined, rawText: string, textLower: string): boolean {
  if (!value) return false;
  if (field === 'phone' || field === 'phone_mobile') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 4) return false;
    const anchor = digits.slice(-7);
    return rawText.replace(/\D/g, '').includes(anchor);
  }
  return textLower.includes(value.trim().toLowerCase());
}

function valuesEqual(field: string, a?: string, b?: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (field === 'phone' || field === 'phone_mobile') return normPhone(a) === normPhone(b);
  return normStr(a) === normStr(b);
}

function mergeCrossValidate(primary: Parsed, heur: Parsed, rawText: string): Parsed {
  const out: any = { ...primary };
  const conflicts: NonNullable<Parsed['meta']>['conflicts'] = [];
  const textLower = rawText.toLowerCase();

  // leistung (Singular) NICHT cross-validaten: die Heuristik trifft hier oft
  // ein zufälliges Keyword ("zaunelemente") wörtlich, während das saubere
  // LLM-Gewerk ("Doppelstabmattenzaun") nur als Plural/Flexion im Text steht
  // und damit fälschlich verliert. leistung wird unten aus leistungen[0] gesetzt.
  const allFields = ['email','phone','phone_mobile','zip','city','street','customerName','description','firma'] as const;
  for (const k of allFields) {
    const llmVal = (primary as any)[k] as string | undefined;
    const heuVal = (heur as any)[k] as string | undefined;

    if (!llmVal && heuVal) {
      // Backfill: LLM hat's vergessen, Heuristik füllt
      out[k] = heuVal;
      continue;
    }
    if (llmVal && heuVal && !valuesEqual(k, llmVal, heuVal)) {
      // Konflikt: NICHT mehr blind nach Feld-Klasse entscheiden (das hat gute
      // LLM-Werte mit fehleranfälligen Regex-Treffern überschrieben). Stattdessen
      // gewinnt der Wert, der WÖRTLICH im Originaltext steht — der stärkste
      // Korrektheits-Beleg. Stehen beide drin, gewinnt bei Kontaktfeldern die
      // zeichengenaue Regex, sonst das semantisch bessere LLM.
      const llmInText = appearsInText(k, llmVal, rawText, textLower);
      const heuInText = appearsInText(k, heuVal, rawText, textLower);
      let chosen: string;
      let reason: string;
      if (llmInText && !heuInText) {
        chosen = llmVal; reason = 'llm-wörtlich-im-text';
      } else if (heuInText && !llmInText) {
        chosen = heuVal; reason = 'heuristik-wörtlich-im-text';
      } else if (CONTACT_FIELDS.has(k) && heuInText) {
        chosen = heuVal; reason = 'kontaktfeld-regex-zeichengenau';
      } else {
        chosen = llmVal; reason = 'llm-semantisch-besser';
      }
      out[k] = chosen;
      conflicts.push({ field: k, llm: llmVal, heuristic: heuVal, chosen, reason });
    }
  }

  // Mengen / Klassifikations-Felder klassisch backfillen
  if (!out.mengen && heur.mengen) out.mengen = heur.mengen;
  if ((!out.leistungen || out.leistungen.length === 0) && heur.leistungen) out.leistungen = heur.leistungen;
  // leistung (Singular) IMMER aus der Gewerksliste ableiten — saubere Quelle
  // statt Heuristik-Keyword. Fällt nur auf den vorhandenen Wert zurück, wenn
  // gar keine Liste existiert.
  if (out.leistungen?.length) out.leistung = out.leistungen[0].name;
  if (!out.dringlichkeit && heur.dringlichkeit) out.dringlichkeit = heur.dringlichkeit;
  if (!out.source_guess && heur.source_guess) out.source_guess = heur.source_guess;
  if (!out.vorgang && heur.vorgang) out.vorgang = heur.vorgang;

  // M6: Confidence nach Cross-Validation neu kalibrieren
  out.confidence = scoreConfidence(out, primary, heur, rawText);

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
  rawText: string,
): Parsed['confidence'] {
  const llmConf = (llm.confidence ?? {}) as Record<string, Confidence | null | undefined>;
  const out: any = {};
  const textLower = rawText.toLowerCase();

  const bumpUp = (c: Confidence | null | undefined): Confidence =>
    c === 'low' ? 'medium' : c === 'medium' ? 'high' : 'high';

  const fields = ['customerName','phone','phone_mobile','email','street','city','leistung','vorgang'] as const;

  for (const f of fields) {
    const val = (merged as any)[f] as string | undefined;
    if (!val) { out[f] = null; continue; }

    // Stärkster Beleg: Wert steht wörtlich im Originaltext → high. (Genau das
    // versprach der M6-Kommentar, war aber nie implementiert — dadurch landeten
    // korrekte Werte unnötig auf „medium"/„low" und blockierten das Speichern.)
    if (appearsInText(f, val, rawText, textLower)) { out[f] = 'high'; continue; }

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
