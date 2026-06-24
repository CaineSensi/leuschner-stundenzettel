/* ====================================================================
 * GAEB DA-XML Import (X81 / X82 / X83) – sirAdos und kompatibel
 * --------------------------------------------------------------------
 * Liest eine GAEB-DA-XML-Datei (Format 3.2 oder 3.3) und extrahiert
 * Positionen mit Lohn/Material/Gerät, Spanne (von/avg/bis), Einheit,
 * sirAdos-IDs (falls vorhanden), Volltext + Kurztitel.
 *
 * Verwendung im Importer:
 *   const xml = await file.text();
 *   const parsed = parseGaebDoc(xml);
 *   // → parsed.items[] ready for Mapping gegen lv_positions
 *
 * Demo-Positionen ohne Preise werden mit isDemo=true markiert (nicht
 * gefiltert) – die UI kann sie ausgrauen und vom Import ausschließen.
 * ==================================================================== */

export interface GaebItem {
  /** Position-Nummer innerhalb der Liste, z.B. "003", "010" */
  rNoPart:        string;
  /** Einheit, z.B. "m²", "m³", "Stk" – kann null sein */
  unit:           string | null;
  /** Einheitspreis gesamt (Avg) */
  upTotal:        number;
  /** Anteil Lohn  (UPComp1) */
  upWage:         number;
  /** Anteil Material (UPComp2) */
  upMaterial:     number;
  /** Anteil Gerät (UPComp3) */
  upPlant:        number;
  /** Untere Spannengrenze */
  upFrom:         number | null;
  /** Mittelwert (meist == upTotal) */
  upAvg:          number | null;
  /** Obere Spannengrenze */
  upTo:           number | null;
  /** Stunden pro Einheit */
  timePerUnit:    number | null;
  /** Kurz-Bezeichnung (Outline) */
  outlineText:    string;
  /** Volltext-Beschreibung */
  detailText:     string;
  /** sirAdos-numerische ID (z.B. "94310") */
  siradosId:      string | null;
  /** sirAdos-GUID  */
  siradosGuid:    string | null;
  /** DIN 276 Kostengruppe (2008-12) */
  din276_08:      string | null;
  /** DIN 276 Kostengruppe (2018-12) */
  din276_18:      string | null;
  /** Standard-Leistungsbereich-Code */
  slb:            string | null;
  /** Demo-Eintrag ohne Preise (UP=0 + "[SIRADOS-Demo …]") */
  isDemo:         boolean;
}

export interface GaebExport {
  /** "Sirados" – aus GAEBInfo/ProgName */
  source:         string;
  /** Export-Datum, z.B. "2026-06-23" */
  exportDate:     string;
  /** Export-Zeit, z.B. "09:15:30" */
  exportTime:     string;
  /** Projekt-Name aus PrjInfo/NamePrj */
  projectName:    string;
  /** Währung */
  currency:       string;
  /** GAEB-DA-Version (z.B. "3.2") */
  gaebVersion:    string;
  /** DA-Phase: 81 (LV) / 82 (Kostenanschlag) / 83 (Angebot) */
  daPhase:        string;
  /** Alle gefundenen Positionen */
  items:          GaebItem[];
  /** Wie viele davon importierbar (kein Demo) */
  validItemCount: number;
}

/* ---------- helpers ----------- */
function text(el: Element | null, tag: string): string | null {
  if (!el) return null;
  const child = el.getElementsByTagName(tag)[0];
  return child ? (child.textContent ?? '').trim() : null;
}
function num(el: Element | null, tag: string): number {
  const t = text(el, tag);
  if (t == null || t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(el: Element | null, tag: string): number | null {
  const t = text(el, tag);
  if (t == null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function findCatalog(item: Element, catalogId: string): string | null {
  const list = item.getElementsByTagName('CtlgAssign');
  for (let i = 0; i < list.length; i++) {
    const ca = list[i];
    const id = text(ca, 'CtlgID');
    if (id === catalogId) return text(ca, 'CtlgCode');
  }
  return null;
}
function collectText(el: Element | null): string {
  if (!el) return '';
  const spans = el.getElementsByTagName('span');
  if (spans.length === 0) return (el.textContent ?? '').trim();
  const parts: string[] = [];
  for (let i = 0; i < spans.length; i++) {
    const t = (spans[i].textContent ?? '').trim();
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

/* ---------- parser ----------- */

/** Strip default-Namespace damit getElementsByTagName auf rohe Tag-Namen
 *  matcht. GAEB-Files nutzen meist `xmlns="http://www.gaeb.de/…"` – ohne
 *  Strippen müsste man mit getElementsByTagNameNS arbeiten, was unnötig
 *  fragil ist (Namespace-URI in Version 3.3 abweichend). */
function stripDefaultNamespace(xml: string): string {
  return xml.replace(/\sxmlns="[^"]*"/g, '');
}

export function parseGaebDoc(xmlText: string): GaebExport {
  const cleaned = stripDefaultNamespace(xmlText);
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml');

  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error('GAEB: Datei kann nicht als XML gelesen werden – ' + (parseError.textContent ?? '').slice(0, 200));
  }

  const root = doc.getElementsByTagName('GAEB')[0];
  if (!root) {
    throw new Error('GAEB: <GAEB>-Wurzelelement fehlt. Ist das eine GAEB-DA-XML?');
  }

  const info = root.getElementsByTagName('GAEBInfo')[0] ?? null;
  const prj  = root.getElementsByTagName('PrjInfo')[0]  ?? null;
  const award= root.getElementsByTagName('Award')[0]    ?? null;

  const meta = {
    source:      text(info, 'ProgName')   ?? 'Unbekannt',
    exportDate:  text(info, 'Date')       ?? '',
    exportTime:  text(info, 'Time')       ?? '',
    projectName: text(prj,  'NamePrj')    ?? '',
    currency:    text(prj,  'Cur')        ?? 'EUR',
    gaebVersion: text(info, 'Version')    ?? '',
    daPhase:     text(award, 'DP')        ?? '',
  };

  const itemEls = root.getElementsByTagName('Item');
  const items: GaebItem[] = [];

  for (let i = 0; i < itemEls.length; i++) {
    const it = itemEls[i];

    // Description-Auszug
    const descRoot = it.getElementsByTagName('Description')[0] ?? null;
    const detailEl = descRoot?.getElementsByTagName('DetailTxt')[0] ?? null;
    const outlineEl= descRoot?.getElementsByTagName('TextOutlTxt')[0] ?? null;
    const detailText  = collectText(detailEl);
    const outlineText = collectText(outlineEl);

    const upTotal = num(it, 'UP');
    const isDemo  = upTotal === 0 && /\[SIRADOS-Demo/i.test(detailText);

    items.push({
      rNoPart:     it.getAttribute('RNoPart') ?? '',
      unit:        text(it, 'QU') || null,
      upTotal,
      upWage:      num(it, 'UPComp1'),
      upMaterial:  num(it, 'UPComp2'),
      upPlant:     num(it, 'UPComp3'),
      upFrom:      numOrNull(it, 'UPFrom'),
      upAvg:       numOrNull(it, 'UPAvg'),
      upTo:        numOrNull(it, 'UPTo'),
      timePerUnit: numOrNull(it, 'TimeQu'),
      outlineText,
      detailText,
      siradosId:   findCatalog(it, 'SIRADOSID'),
      siradosGuid: findCatalog(it, 'SIRADOSGUID'),
      din276_08:   findCatalog(it, 'SDIN276-08'),
      din276_18:   findCatalog(it, 'SDIN276-18'),
      slb:         findCatalog(it, 'SLB'),
      isDemo,
    });
  }

  return {
    ...meta,
    items,
    validItemCount: items.filter(i => !i.isDemo && i.upTotal > 0).length,
  };
}

/* ====================================================================
 * Match-Helfer: schlage Leuschner-LV-Positionen vor, die zu einer
 * GAEB-Position passen könnten (Fuzzy-Match auf outlineText).
 * ==================================================================== */

export interface MatchCandidate {
  lvId: string;
  lvName: string;
  score: number;
}

/** Sehr einfaches Token-Overlap-Scoring – reicht für Vorschläge,
 *  finale Entscheidung trifft der Mensch im Picker. */
export function suggestMatches(
  gaeb: GaebItem,
  positions: Array<{ id: string; name: string; cat?: string | null }>,
  topN = 5,
): MatchCandidate[] {
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[,\.\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const STOP = new Set(['der','die','das','und','oder','mit','auf','von','bis','bei','aus','ein','eine','m','m2','m3','stk','st']);
  const tokens = (s: string) => normalize(s)
    .split(' ')
    .filter(t => t.length > 2 && !STOP.has(t));

  const needle = new Set(tokens(gaeb.outlineText + ' ' + gaeb.detailText.slice(0, 200)));
  if (needle.size === 0) return [];

  const scored: MatchCandidate[] = [];
  for (const p of positions) {
    const hay = new Set(tokens(p.name));
    if (hay.size === 0) continue;
    let overlap = 0;
    for (const t of needle) if (hay.has(t)) overlap++;
    const score = overlap / Math.sqrt(needle.size * hay.size);
    if (score > 0) scored.push({ lvId: p.id, lvName: p.name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/** Format der `reason`-Spalte in lv_price_history bei sirAdos-Import.
 *  Konvention: zentral hier definieren, damit Audit-Trail einheitlich
 *  bleibt und später per LIKE 'sirAdos:%' filterbar wird. */
export function formatPriceSource(gaeb: GaebItem, exportDate: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateOnly = exportDate || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();
  const spanne = gaeb.upFrom != null && gaeb.upTo != null
    ? ` Spanne ${gaeb.upFrom.toFixed(2)}–${gaeb.upTo.toFixed(2)}`
    : '';
  return `sirAdos:${gaeb.siradosId ?? '?'} | ${dateOnly} | EP ${gaeb.upTotal.toFixed(2)}€${spanne}`;
}

/* ====================================================================
 * sirAdos .sir – internes Projekt-/Angebots-Format
 * --------------------------------------------------------------------
 * UserData → NodeList → Node[typeName="projekt"]
 *   ↳ Node[typeName="angebot"]
 *     ↳ Node[typeName="lv_titel"]   (mehrere möglich)
 *       ↳ Node[typeName="lv_position"]   (die eigentlichen Positionen)
 *
 * Jeder Node hat <Data> mit CDATA-eingebettetem JSON-Array von
 * "Eigenschafts-Gruppen" (Kalkulationsdaten / MengeEinheit / …) und
 * optional <Documents> mit CDATA-JSON für Beschreibungstexte.
 *
 * Wichtig: Geldbeträge sind in **Cent** gespeichert (×100) – beim
 * Lesen direkt nach Euro umrechnen. Mengen sind in `Faktor` (m², m³,
 * m, Stk) zu finden, NICHT in `Menge` (das ist immer 1).
 * ==================================================================== */

export interface SirAddress {
  street: string | null;
  zip:    string | null;
  city:   string | null;
}

export interface SirPriceFactor {
  state:      string | null;
  location:   string | null;
  postalCode: string | null;
  factor:     number | null;
}

export interface SirOfferSummary {
  wageTotal:     number;   // €, Netto-Anteil Lohn
  materialTotal: number;
  plantTotal:    number;
  netTotal:      number;
  vatRate:       number;   // 0.19
  vatAmount:     number;
  grossTotal:    number;
  hours:         number | null;
}

export interface SirPosition {
  /** sirAdos-numerische ID, abgeleitet aus dem 64-bit-Tail der GUID */
  siradosId:    string;
  /** Vollständige sirAdos-GUID */
  siradosGuid:  string;
  /** Position-Name (kurz) */
  name:         string;
  /** sirAdos-LV-Nummer hierarchisch, z.B. "01.002" */
  positionNum:  string;
  /** sirAdos-Volltext-LV-Code, z.B. "1.002.0.10.003" */
  lvNumber:     string | null;
  /** Specs (z.B. "30,20" für 20-30 cm) */
  specs:        string | null;
  /** Einheit (m², m³, m, Stk, t, h) */
  unit:         string | null;
  /** Menge (echte Stück-/Flächen-/Volumen-Zahl, aus Faktor) */
  quantity:     number;
  /** Einheitspreis €/Einheit – schon in Euro (aus Cent /100) */
  unitPrice:    number;
  /** Anteil Lohn pro Einheit (€) */
  wage:         number;
  /** Anteil Material pro Einheit (€) */
  material:     number;
  /** Anteil Gerät pro Einheit (€) */
  plant:        number;
  /** Position-Gesamtpreis (€) = quantity × unitPrice */
  total:        number;
  /** Stunden pro Einheit (für Lohn-Schätzung) */
  hoursPerUnit: number | null;
  /** DIN-276 Kostengruppe 2018 */
  kg2018:       string | null;
  /** DIN-276 Kostengruppe 2008 */
  kg2008:       string | null;
  /** sirAdos-Gewerk-Code (z.B. "002" = Erdarbeiten) */
  gewerk:       string | null;
  /** sirAdos-Titel-Code */
  titel:        string | null;
  /** Beschreibungstext (aus <Documents> CDATA) */
  description:  string;
  /** Hinweis-Text (Leistungsansatz, technische Regelwerke …) */
  hint:         string | null;
  /** Untere/Obere Spanne (€) */
  rangeLow:     number | null;
  rangeMid:     number | null;
  rangeHigh:    number | null;
  /** Zugeordnete LV-Titel-Gruppe (z.B. "Erdarbeiten / Rasen / Pflasterarbeiten") */
  groupTitle:   string;
}

export interface SirExport {
  /** "Sirados" */
  source:        string;
  /** sirAdos-Version, z.B. "4.7.2.215" */
  version:       string;
  /** User-Email aus dem Login */
  user:          string | null;
  /** Export-Datum (dd.mm.yyyy) */
  exportDate:    string;
  /** Projekt-Name */
  projectName:   string;
  /** Objekt-Adresse */
  objectAddr:    SirAddress;
  /** Angebots-Name (typeName="angebot") */
  offerName:     string;
  /** Angebots-Summen */
  offer:         SirOfferSummary;
  /** Verwendeter Ortsfaktor (kann falsch konfiguriert sein!) */
  priceFactor:   SirPriceFactor;
  /** Alle gefundenen Positionen */
  positions:     SirPosition[];
}

/* ---------- .sir parsing helpers ---------- */

function parseCdataJson(cdataText: string | null): unknown {
  if (!cdataText) return null;
  const trimmed = cdataText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Gleitet durch die sirAdos-Eigenschafts-Gruppen-Struktur:
 *    [{ name:"Kalkulationsdaten", values:[{name:"Lohn",userValue:...}] }, …]
 *  und gibt den userValue der gesuchten Property zurück. */
function getProp(
  groups: unknown,
  groupName: string,
  propName: string,
): unknown {
  if (!Array.isArray(groups)) return undefined;
  for (const g of groups) {
    if (typeof g !== 'object' || g == null) continue;
    const gg = g as { name?: unknown; values?: unknown };
    if (gg.name !== groupName) continue;
    if (!Array.isArray(gg.values)) continue;
    for (const v of gg.values) {
      if (typeof v !== 'object' || v == null) continue;
      const vv = v as { name?: unknown; userValue?: unknown; value?: unknown };
      if (vv.name === propName) {
        return vv.userValue !== undefined ? vv.userValue : vv.value;
      }
    }
  }
  return undefined;
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function asNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = asNumber(v);
  return n === 0 && typeof v !== 'number' ? null : n;
}
function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Wandelt Cent-Wert aus .sir nach Euro */
const cent2eur = (cent: number): number => Math.round(cent) / 100;

/** Extrahiert siradosId aus GUID "00000008-0000-0000-0000-000000094310" → "94310" */
function siradosIdFromGuid(guid: string | null | undefined): string {
  if (!guid) return '';
  const tail = guid.split('-').pop() ?? '';
  return String(parseInt(tail, 10) || 0) || '';
}

/** Findet rekursiv alle Nodes mit bestimmtem typeName */
function findNodesByType(root: Element, typeName: string): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.tagName === 'Node') {
        if (c.getAttribute('typeName') === typeName) out.push(c);
        stack.push(c);
      } else if (c.tagName === 'NodeList') {
        stack.push(c);
      }
    }
  }
  return out;
}

function directChildByTag(el: Element, tag: string): Element | null {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].tagName === tag) return el.children[i];
  }
  return null;
}

/** Liefert den first-level Beschreibungstext aus <Documents>-CDATA-JSON. */
function extractTexts(docsJson: unknown): { description: string; hint: string | null } {
  if (typeof docsJson !== 'object' || docsJson == null) {
    return { description: '', hint: null };
  }
  let description = '';
  let hint: string | null = null;
  for (const key of Object.keys(docsJson as Record<string, unknown>)) {
    const entry = (docsJson as Record<string, unknown>)[key];
    if (typeof entry !== 'object' || entry == null) continue;
    const ee = entry as { name?: unknown; text?: unknown };
    const name = typeof ee.name === 'string' ? ee.name : '';
    const text = typeof ee.text === 'string' ? ee.text : '';
    if (name === 'Beschreibung') description = text;
    else if (name === 'Hinweis')   hint = text;
  }
  return { description: description.trim(), hint: hint?.trim() || null };
}

export function parseSirDoc(xmlText: string): SirExport {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error('.sir: Datei kann nicht als XML gelesen werden – ' + (parseError.textContent ?? '').slice(0, 200));
  }

  const userData = doc.getElementsByTagName('UserData')[0];
  if (!userData) throw new Error('.sir: <UserData>-Wurzel fehlt – ist das wirklich eine sirAdos-Sicherung?');

  const projectNode = findNodesByType(userData, 'projekt')[0];
  if (!projectNode) throw new Error('.sir: kein "projekt"-Node gefunden');

  const offerNode = findNodesByType(projectNode, 'angebot')[0];
  if (!offerNode) throw new Error('.sir: kein "angebot"-Node gefunden – diese Datei enthält keine Kalkulation');

  /* ---- Projekt-Adresse ---- */
  const projectName = directChildByTag(projectNode, 'Name')?.textContent?.trim() ?? '';
  const projectData = parseCdataJson(directChildByTag(projectNode, 'Data')?.textContent ?? null);
  const objectAddr: SirAddress = {
    street: asString(getProp(projectData, 'Objektadresse', 'ObjektStraße')),
    zip:    asString(getProp(projectData, 'Objektadresse', 'ObjektPLZ')),
    city:   asString(getProp(projectData, 'Objektadresse', 'ObjektOrt')),
  };

  /* ---- Angebots-Summen ---- */
  const offerName = directChildByTag(offerNode, 'Name')?.textContent?.trim() ?? '';
  const offerData = parseCdataJson(directChildByTag(offerNode, 'Data')?.textContent ?? null);

  const offer: SirOfferSummary = {
    wageTotal:     cent2eur(asNumber(getProp(offerData, 'Kalkulationsdaten', 'Lohn'))),
    materialTotal: cent2eur(asNumber(getProp(offerData, 'Kalkulationsdaten', 'Material'))),
    plantTotal:    cent2eur(asNumber(getProp(offerData, 'Kalkulationsdaten', 'Gerät'))),
    netTotal:      cent2eur(asNumber(getProp(offerData, 'Preisberechnung',  'Nettopreis'))),
    vatRate:       asNumber(getProp(offerData, 'MwstNachlass', 'MwStSatz')),
    vatAmount:     cent2eur(asNumber(getProp(offerData, 'Preisberechnung',  'MwstBetrag'))),
    grossTotal:    cent2eur(asNumber(getProp(offerData, 'Preisberechnung',  'BruttoPreis'))),
    hours:         asNumberOrNull(getProp(offerData, 'Allgemeine Daten', 'Zeit')),
  };

  /* ---- Ortsfaktor ---- */
  const ortsfaktorRaw = getProp(offerData, 'Einstellungen', 'Ortsfaktor');
  const ofObj = (typeof ortsfaktorRaw === 'object' && ortsfaktorRaw != null)
    ? ortsfaktorRaw as Record<string, unknown> : null;
  const priceFactor: SirPriceFactor = {
    state:      asString(ofObj?.PriceFactorState),
    location:   asString(ofObj?.PriceFactorLocation),
    postalCode: asString(ofObj?.PriceFactorPostalCode),
    factor:     asNumberOrNull(ofObj?.priceFactorForUse ?? ofObj?.PriceFactorPostalCodefactor),
  };

  /* ---- Positionen ---- */
  const titleNodes = findNodesByType(offerNode, 'lv_titel');
  const positions: SirPosition[] = [];

  for (const titleNode of titleNodes) {
    const groupTitle = directChildByTag(titleNode, 'Name')?.textContent?.trim() ?? '';
    const posNodes = findNodesByType(titleNode, 'lv_position');
    for (const pn of posNodes) {
      const name        = directChildByTag(pn, 'Name')?.textContent?.trim() ?? '';
      const positionNum = directChildByTag(pn, 'Number')?.textContent?.trim() ?? '';
      const specs       = directChildByTag(pn, 'Specs')?.textContent?.trim() || null;
      const siradosGuid = pn.getAttribute('siradosId') ?? '';
      const dataJson    = parseCdataJson(directChildByTag(pn, 'Data')?.textContent ?? null);
      const docsJson    = parseCdataJson(directChildByTag(pn, 'Documents')?.textContent ?? null);
      const { description, hint } = extractTexts(docsJson);

      const lvNumber = asString(getProp(dataJson, 'LV_PosAllgemein', 'LvNummer'));
      const quantity = asNumber(getProp(dataJson, 'MengeEinheit',   'Faktor'));
      const unit     = asString(getProp(dataJson, 'MengeEinheit',   'KK_Mengeneinheit'));

      // Geld in Cent, durch 100 zu Euro
      const wage     = cent2eur(asNumber(getProp(dataJson, 'Kalkulationsdaten', 'Lohn')));
      const material = cent2eur(asNumber(getProp(dataJson, 'Kalkulationsdaten', 'Material')));
      const plant    = cent2eur(asNumber(getProp(dataJson, 'Kalkulationsdaten', 'Gerät')));
      const epCent   = asNumber(getProp(dataJson, 'Kalkulationsdaten', 'EP'));
      // EP im .sir ist „Positions-EP × Menge / 100"-Mix → wir berechnen den Einheits-EP
      // direkt aus quantity, weil EP-Feld die Position-Summe / Menge ist.
      const total    = cent2eur(asNumber(getProp(dataJson, 'Kosten', 'Kostensumme')));
      const unitPrice= quantity > 0 ? total / quantity : cent2eur(epCent);

      positions.push({
        siradosGuid,
        siradosId:    siradosIdFromGuid(siradosGuid),
        name,
        positionNum,
        lvNumber,
        specs,
        unit,
        quantity,
        unitPrice,
        wage:        quantity > 0 ? wage / quantity     : wage,
        material:    quantity > 0 ? material / quantity : material,
        plant:       quantity > 0 ? plant / quantity    : plant,
        total,
        hoursPerUnit: asNumberOrNull(getProp(dataJson, 'Allgemeine Daten', 'Zeit')),
        kg2018:      asString(getProp(dataJson, 'Allgemeine Daten', 'KG')),
        kg2008:      asString(getProp(dataJson, 'Allgemeine Daten', 'KG2008')),
        gewerk:      asString(getProp(dataJson, 'Kalkulationsdaten', 'Gewerk')),
        titel:       asString(getProp(dataJson, 'Kalkulationsdaten', 'Titel')),
        description,
        hint,
        rangeLow:    asNumberOrNull(getProp(dataJson, 'Ausschreibungsdaten', 'Von')) != null
                       ? cent2eur(asNumber(getProp(dataJson, 'Ausschreibungsdaten', 'Von')))   / Math.max(1, quantity)
                       : null,
        rangeMid:    asNumberOrNull(getProp(dataJson, 'Ausschreibungsdaten', 'Mittel')) != null
                       ? cent2eur(asNumber(getProp(dataJson, 'Ausschreibungsdaten', 'Mittel'))) / Math.max(1, quantity)
                       : null,
        rangeHigh:   asNumberOrNull(getProp(dataJson, 'Ausschreibungsdaten', 'Bis')) != null
                       ? cent2eur(asNumber(getProp(dataJson, 'Ausschreibungsdaten', 'Bis')))   / Math.max(1, quantity)
                       : null,
        groupTitle,
      });
    }
  }

  return {
    source:      userData.getAttribute('source') ?? 'Sirados',
    version:     userData.getAttribute('version') ?? '',
    user:        userData.getAttribute('user'),
    exportDate:  userData.getAttribute('exportDate') ?? '',
    projectName,
    objectAddr,
    offerName,
    offer,
    priceFactor,
    positions,
  };
}

/** Übersetzt sirAdos-Gewerk-Code in unsere Leuschner-LV-Kategorie.
 *  Gewerk-Codes nach sirAdos SLB: 002=Erdarb, 003=Pflanzungen, 010=Rasen,
 *  080=Bordstein/Pflaster, 040=Treppen, 005=Zaun, 020=Wasser/Drainage,…
 *  Mapping bewusst grob – User kann pro Position überschreiben. */
export function gewerkToLvCat(gewerk: string | null, kg2018: string | null): 'ERD'|'PFL'|'GTN'|'ZAU'|'VWG'|'UMZ'|'SON'|'MAT'|'ERR' {
  const g = (gewerk ?? '').trim();
  if (g === '002')              return 'ERD';
  if (g === '003' || g === '010' || g === '011') return 'GTN';
  if (g === '080' || g === '081' || g === '082') return 'PFL';
  if (g === '005' || g === '006') return 'ZAU';
  // Fallback über KG276-2018: 511=Erdbau, 521/531=Wege, 571=Vegetation
  const kg = (kg2018 ?? '').trim();
  if (kg === '511')              return 'ERD';
  if (kg === '521' || kg === '531') return 'PFL';
  if (kg === '571')              return 'GTN';
  return 'SON';
}

/** Quellenangabe für lv_price_history.reason — sirAdos-Variante (.sir). */
export function formatSirPriceSource(p: SirPosition, exportDate: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // exportDate ist im Format dd.mm.yyyy → in yyyy-mm-dd umformen für Konsistenz
  let iso = exportDate;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(exportDate);
  if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (!iso) {
    const d = new Date();
    iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  const spanne = p.rangeLow != null && p.rangeHigh != null
    ? ` Spanne ${p.rangeLow.toFixed(2)}–${p.rangeHigh.toFixed(2)}`
    : '';
  return `sirAdos:${p.siradosId} | ${iso} | EP ${p.unitPrice.toFixed(2)}€${spanne}`;
}

/* ====================================================================
 * Hauptposition + Auflagen-Heuristik (Rick-Konzept 19.06.2026)
 * --------------------------------------------------------------------
 * sirAdos listet jede Variante als eigene Position:
 *   "Oberboden abtragen, entsorgen, bis 30 cm"
 *   "Oberboden abtragen, seitlich lagern, 30 cm"
 *   "Oberboden abtragen, außerhalb lagern"
 *   …
 * In unserem LV ist das **eine Hauptposition** "Oberboden abtragen"
 * mit anhängbaren Auflagen (lagern/entsorgen/austauschen/kultivieren/
 * liefern). Beim Import erkennen wir das via Stamm-Vergleich und
 * schlagen pro sirAdos-Position vor, ob sie Hauptposition oder Auflage
 * werden soll.
 * ==================================================================== */

/** Stamm-Heuristik: alles vor erstem Komma → Hauptposition-Name.
 *    "Oberboden abtragen, entsorgen, bis 30 cm" → "Oberboden abtragen" */
export function derivePositionStem(name: string): string {
  const idx = name.indexOf(',');
  return (idx > 0 ? name.slice(0, idx) : name).trim();
}

/** Erkennt Auflagen-Schlüssel aus dem Position-Namen. Liefert einen der
 *  bei uns etablierten Keys oder null, wenn die Position als
 *  Hauptposition zu deuten ist. */
export function detectOptionKey(
  name: string,
): 'lagern' | 'entsorgen' | 'austauschen' | 'kultivieren' | 'liefern' | null {
  const n = name.toLowerCase();
  if (/\bentsorg/.test(n))                                                   return 'entsorgen';
  if (/\baußerhalb lagern|außerhalb der baustelle|seitlich lagern|in mieten\b/.test(n)) return 'lagern';
  if (/\bliefer/.test(n))                                                    return 'liefern';
  if (/\bandecken|anplanier|kultivier|einsä|abstreu/.test(n))                return 'kultivieren';
  if (/\baustausch/.test(n))                                                 return 'austauschen';
  return null;
}

/** Label für eine Auflage aus dem Position-Namen ableiten.
 *  "Oberboden abtragen, entsorgen, bis 30 cm" → "entsorgen (bis 30 cm)" */
export function deriveOptionLabel(name: string): string {
  const idx = name.indexOf(',');
  if (idx < 0) return name;
  const rest = name.slice(idx + 1).trim();
  // Erste Phrase als Hauptlabel, optional gefolgt von Dimensionen in Klammern
  const parts = rest.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return rest;
  return `${parts[0]} (${parts.slice(1).join(', ')})`;
}

/** Schlägt vor, welche sirAdos-Positionen zur selben Hauptposition
 *  gruppiert werden sollten. Liefert eine Map<stamm, positions[]>. */
export function groupPositionsByStem(positions: SirPosition[]): Map<string, SirPosition[]> {
  const m = new Map<string, SirPosition[]>();
  for (const p of positions) {
    const stem = derivePositionStem(p.name).toLowerCase();
    const arr = m.get(stem) ?? [];
    arr.push(p);
    m.set(stem, arr);
  }
  return m;
}

/** Match-Vorschläge für eine sirAdos-Position gegen Leuschner-LV.
 *  Verwendet Token-Overlap auf Name, optional gewichtet mit Kategorie-Match. */
export function suggestMatchesSir(
  pos: SirPosition,
  positions: Array<{ id: string; name: string; cat?: string | null }>,
  topN = 5,
): MatchCandidate[] {
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[,\.\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const STOP = new Set(['der','die','das','und','oder','mit','auf','von','bis','bei','aus','ein','eine','m','m2','m3','stk','st','cm']);
  const tokens = (s: string) => normalize(s)
    .split(' ')
    .filter(t => t.length > 2 && !STOP.has(t));

  const needle = new Set(tokens(pos.name));
  if (needle.size === 0) return [];
  const expectedCat = gewerkToLvCat(pos.gewerk, pos.kg2018);

  const scored: MatchCandidate[] = [];
  for (const p of positions) {
    const hay = new Set(tokens(p.name));
    if (hay.size === 0) continue;
    let overlap = 0;
    for (const t of needle) if (hay.has(t)) overlap++;
    let score = overlap / Math.sqrt(needle.size * hay.size);
    if (p.cat && p.cat === expectedCat) score *= 1.25;  // Kategorie-Boost
    if (score > 0) scored.push({ lvId: p.id, lvName: p.name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
