// Frontend-Wrapper für die Cloudflare-Pages-Function /api/sevdesk/*
// Token bleibt server-side. Pfade unten sind 1:1 sevDesk-Endpunkte.

import { llmStructure } from "./llm";
import { SEVDESK_ID_PREFIX, type Customer } from "./customers";
export { llmStructure };

async function sd<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/sevdesk/${path}`, init);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`sevDesk ${path} ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export interface SevContactInput {
  surename?: string;
  familyname?: string;
  name?: string;          // Firmenname falls is_company
  isCompany?: boolean;
  email?: string;
  phone?: string;         // Festnetz
  phoneMobile?: string;   // Mobil/Handy — wird als ZWEITE Telefonnummer angelegt
  street?: string;
  zip?: string;
  city?: string;
}

/** Legt einen Contact in sevDesk an. Gibt die sevDesk-ID zurück. */
export async function sevdeskCreateContact(input: SevContactInput): Promise<{ id: string; customerNumber: string }> {
  const body: any = {
    name: input.isCompany ? (input.name ?? '') : null,
    surename: input.isCompany ? null : (input.surename ?? null),
    familyname: input.isCompany ? null : (input.familyname ?? null),
    category: { id: '3', objectName: 'Category' },     // Kunde
    customerNumber: '',                                 // sevDesk vergibt
  };
  const created = await sd<any>('Contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contactId = String(created?.objects?.id ?? '');
  if (!contactId) throw new Error('sevDesk Contact ohne ID');

  // Adresse separat, falls Daten da
  if (input.street || input.zip || input.city) {
    await sd('ContactAddress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: { id: contactId, objectName: 'Contact' },
        street: input.street ?? null,
        zip: input.zip ?? null,
        city: input.city ?? null,
        country: { id: '1', objectName: 'StaticCountry' },
      }),
    });
  }
  // Email/Phone als CommunicationWay separat speichern (sevDesk-Eigenheit)
  if (input.email) {
    await sd('CommunicationWay', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: { id: contactId, objectName: 'Contact' },
        type: 'EMAIL', value: input.email, key: { id: '2', objectName: 'CommunicationWayKey' },
      }),
    }).catch(() => {});
  }
  // Telefonnummern als CommunicationWay. key.id=2 = bestandskonform (alle 28
  // vorhandenen sevDesk-Telefonnummern nutzen key 2). Festnetz UND Mobil werden
  // BEIDE angelegt — sonst fehlt bei reinen Mobil-Kontakten (Telefon/WhatsApp-
  // Anfragen, der Normalfall) die Nummer komplett im sevDesk-Kontakt.
  // Hier KEIN .catch()-Schlucken: scheitert die Telefon-Anlage, soll der Fehler
  // hochblubbern, damit kein Kontakt unbemerkt ohne Nummer entsteht.
  if (input.phone) {
    await sd('CommunicationWay', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: { id: contactId, objectName: 'Contact' },
        type: 'PHONE', value: input.phone, key: { id: '2', objectName: 'CommunicationWayKey' },
      }),
    });
  }
  if (input.phoneMobile && input.phoneMobile.replace(/\D/g, '') !== (input.phone ?? '').replace(/\D/g, '')) {
    await sd('CommunicationWay', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: { id: contactId, objectName: 'Contact' },
        type: 'PHONE', value: input.phoneMobile, key: { id: '2', objectName: 'CommunicationWayKey' },
      }),
    });
  }

  return {
    id: contactId,
    customerNumber: String(created?.objects?.customerNumber ?? ''),
  };
}

// ── Live-Kontaktsuche: erkennt schon beim Strukturieren einer Anfrage, dass
//    die Person bereits in sevDesk existiert — auch wenn sie nach dem letzten
//    Import angelegt wurde und im lokalen Stamm noch fehlt. ────────────────

let _contactCache: { at: number; data: Customer[] } | null = null;
const CONTACT_TTL = 5 * 60 * 1000; // 5 Min — sevDesk-Kontakte aendern sich selten

/** Laedt Kontakte live aus sevDesk (inkl. E-Mail/Telefon/Adresse via embed)
 *  und mappt sie auf das Customer-Format, damit dieselbe gehaertete
 *  Match-Logik wie fuer den App-Stamm greift. Synthetische id
 *  `sevdesk:<contactId>` markiert Kontakte, die noch nicht lokal gespiegelt
 *  sind. 5-Min-Cache gegen unnoetige API-Last bei Re-Renders/Remounts. */
export async function sevdeskListContacts(force = false): Promise<Customer[]> {
  if (!force && _contactCache && Date.now() - _contactCache.at < CONTACT_TTL) {
    return _contactCache.data;
  }
  const r = await sd<any>('Contact?limit=1000&depth=1&embed=communicationWays,addresses');
  const objs: any[] = r?.objects ?? [];
  const data = objs
    .map(mapSevContact)
    .filter((c): c is Customer => c !== null);
  _contactCache = { at: Date.now(), data };
  return data;
}

/** sevDesk-Contact-Objekt → Customer. Firma vs. Person anhand name/familyname,
 *  bestes EMAIL/PHONE aus den CommunicationWays (main bevorzugt). */
function mapSevContact(o: any): Customer | null {
  const id = String(o?.id ?? '');
  if (!id) return null;
  const company = String(o?.name ?? '').trim();
  const sur = String(o?.surename ?? '').trim();
  const fam = String(o?.familyname ?? '').trim();
  const isCompany = !!company && !fam && !sur;
  const display = isCompany ? company : [sur, fam].filter(Boolean).join(' ').trim() || company;
  if (!display) return null;

  let email: string | undefined;
  let phone: string | undefined;
  const cws: any[] = o?.communicationWays ?? [];
  for (const cw of cws) {
    const val = String(cw?.value ?? '').trim();
    if (!val) continue;
    const type = String(cw?.type ?? '').toUpperCase();
    const isMain = String(cw?.main ?? '') === '1';
    if (type === 'EMAIL') { if (!email || isMain) email = val; }
    else if (type === 'PHONE' || type === 'MOBILE' || type === 'LANDLINE') { if (!phone || isMain) phone = val; }
  }

  const addr: any = (o?.addresses ?? [])[0] ?? {};
  return {
    id: SEVDESK_ID_PREFIX + id,
    sevdeskContactId: id,
    customerNumber: o?.customerNumber ? String(o.customerNumber) : undefined,
    name: display,
    surename: sur || undefined,
    familyname: fam || undefined,
    isCompany,
    email: email ? email.toLowerCase() : undefined,
    phone: phone || undefined,
    street: addr?.street ? String(addr.street) : undefined,
    zip: addr?.zip ? String(addr.zip) : undefined,
    city: addr?.city ? String(addr.city) : undefined,
  };
}

/** Ermittelt die nächste freie AN-Nummer.
 *
 *  sevDesks eigenes `getNextOrderNumber` ist KAPUTT: Es liefert eine bereits
 *  vergebene Nummer zurück (Counter hängt der Realität hinterher) — am
 *  02.06.2026 belegt: lieferte "AN-1255", obwohl AN-1255 schon zweimal
 *  existierte. Verlässt man sich darauf (oder auf einen zu kleinen
 *  `limit=10`-Ausschnitt mit falscher orderBy-Syntax), entstehen Dubletten.
 *  In sevDesk hatten sich so 9 doppelte AN-Nummern angesammelt
 *  (1075, 1081, 1090, 1135, 1141, 1158, 1212, 1252, 1255).
 *
 *  Robuste Lösung: echtes Maximum über ALLE Aufträge bilden und den Kandidaten
 *  live gegen sevDesk prüfen — bei Kollision hochzählen, bis frei. So kann
 *  selbst bei zwischenzeitlich angelegten Aufträgen keine Nummer doppelt
 *  vergeben werden. */
export async function sevdeskNextOrderNumber(): Promise<string> {
  const r = await sd<any>('Order?limit=1000&depth=0');
  const nums: number[] = (r?.objects ?? [])
    .map((o: any) => String(o?.orderNumber ?? ''))
    .filter((n: string) => /^AN-\d+$/.test(n))
    .map((n: string) => parseInt(n.slice(3), 10));
  let next = (nums.length ? Math.max(...nums) : 1000) + 1;

  // Live-Kollisionsschutz: deckt auch Aufträge ab, die seit dem List-Call
  // angelegt wurden. Maximal 20 Versuche, dann geben wir auf (sehr defensiv).
  for (let i = 0; i < 20; i++) {
    const found = await sd<any>(`Order?orderNumber=${encodeURIComponent('AN-' + next)}&depth=0`);
    if (!((found?.objects ?? []).length)) break;
    next++;
  }
  return `AN-${next}`;
}

export interface SevOrderInput {
  contactId: string;
  orderNumber: string;
  header: string;
  headText?: string;
  positions: Array<{
    name: string;
    quantity: number;
    price: number;
    unityId?: string;   // sevDesk Unity-ID (1=Stk, 9=Std, 2=m², ...)
    text?: string;
  }>;
}

export async function sevdeskCreateOrder(input: SevOrderInput): Promise<{ id: string; orderNumber: string }> {
  // saveOrder erwartet das volle Dokument inkl. positions
  const positions = input.positions.map((p, i) => ({
    objectName: 'OrderPos',
    mapAll: 'true',
    name: p.name,
    quantity: p.quantity,
    price: p.price,
    priceNet: p.price,
    priceGross: p.price,
    taxRate: 0,
    text: p.text ?? '',
    unity: { id: p.unityId ?? '1', objectName: 'Unity' },
    positionNumber: i,
  }));
  const sumNet = input.positions.reduce((t, p) => t + p.quantity * p.price, 0);
  const order = {
    objectName: 'Order',
    mapAll: 'true',
    orderNumber: input.orderNumber,
    contact: { id: input.contactId, objectName: 'Contact' },
    header: input.header,
    headText: input.headText ?? '',
    status: 100,                              // Entwurf
    orderType: 'AN',
    orderDate: new Date().toISOString(),
    taxRate: 0, taxText: '0',
    currency: 'EUR',
    sumNet, sumGross: sumNet,
    sumNetAccounting: sumNet, sumGrossAccounting: sumNet,
    showNet: '1',
    smallSettlement: '0',
    taxRule: { id: '1', objectName: 'TaxRule' },
  };
  const r = await sd<any>('Order/Factory/saveOrder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order, orderPosSave: positions }),
  });
  const out = r?.objects?.order ?? r?.objects;
  return { id: String(out?.id ?? ''), orderNumber: String(out?.orderNumber ?? input.orderNumber) };
}

/**
 * Storniert eine sevDesk-Order: Status auf 500 = Abgelehnt setzen.
 * sevDesk hat keinen dedizierten „Storno"-Endpoint für Aufträge — die
 * konventionelle Lösung ist, den Auftrag aus dem aktiven Workflow zu nehmen
 * (status=500 „Abgelehnt"). Optional wird der Grund in den headText
 * eingearbeitet (Sicht für Rick im sevDesk-Belegtext).
 *
 * Wir versuchen erst die orderNumber als ID-Lookup (für „AN-…"), und nutzen
 * sie als Fallback, falls die intern gespeicherte sevDesk-ID nicht (mehr)
 * stimmt. Bei Fehler wirft die Funktion — die Karte wird trotzdem lokal
 * storniert (siehe pipeline.cancelCard).
 */
export async function sevdeskCancelOrder(orderRef: { id?: string; orderNumber?: string }, reason?: string): Promise<void> {
  let orderId = orderRef.id?.trim();
  // Fallback: per orderNumber suchen
  if (!orderId && orderRef.orderNumber) {
    const found = await sd<any>(`Order?orderNumber=${encodeURIComponent(orderRef.orderNumber)}&depth=0`);
    orderId = String(found?.objects?.[0]?.id ?? '');
  }
  if (!orderId) throw new Error('sevDesk-Order ohne ID/Nummer. Nichts zu stornieren.');

  // Aktuellen Belegtext lesen, um Storno-Vermerk nicht-destruktiv anzuhängen
  let prevHeadText = '';
  try {
    const cur = await sd<any>(`Order/${orderId}?depth=0`);
    prevHeadText = String(cur?.objects?.headText ?? '');
  } catch { /* irrelevant — wir können trotzdem stornieren */ }

  const stamp = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const stornoHinweis = `[STORNIERT am ${stamp}${reason ? `, Grund: ${reason}` : ''}]`;
  const headText = prevHeadText ? `${stornoHinweis}\n\n${prevHeadText}` : stornoHinweis;

  await sd(`Order/${orderId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 500, headText }),
  });
}

// ── Live-Beleg-Abgleich: liest den AKTUELLEN Stand einer sevDesk-Order
//    (Status, Summe, Positionen) als Schnappschuss. Rein lesend — verändert
//    in sevDesk NICHTS. Damit spiegelt die Pipeline-Karte den Beleg, der die
//    Quelle der Wahrheit ist (Positionen/Beträge/Status können in sevDesk
//    nachträglich geändert worden sein). ─────────────────────────────────────

/** sevDesk-Einheiten (translationCode) → kurzes deutsches Kürzel für die Anzeige. */
const UNITY_LABEL: Record<string, string> = {
  UNITY_PIECE: 'Stk',
  UNITY_HOUR: 'Std',
  UNITY_SQUARE_METER: 'm²',
  UNITY_CUBIC_METER: 'm³',
  UNITY_METER: 'm',
  UNITY_RUNNING_METER: 'lfm',
  UNITY_BLANKET: 'pausch.',
  UNITY_KILOGRAM: 'kg',
  UNITY_TON: 't',
  UNITY_DAY: 'Tag',
  UNITY_LITER: 'l',
  UNITY_PERCENT: '%',
};

/** sevDesk-Order-Status (AN) → menschenlesbar. */
const ORDER_STATUS_LABEL: Record<number, string> = {
  100: 'Entwurf',
  200: 'Offen / versendet',
  300: 'Teilweise berechnet',
  500: 'Abgelehnt / storniert',
  750: 'Angenommen',
  1000: 'Abgerechnet',
};

export interface SevOrderPos {
  positionNumber: number;
  name: string;
  quantity: number;
  price: number;       // Einzelpreis netto
  sumNet: number;      // Zeilensumme netto
  unityLabel: string;  // z. B. "Std", "m²", "Stk"
  text: string;
}

/** Kontaktdaten des Kunden hinter dem Beleg (für den Stammdaten-Abgleich). */
export interface SevContactData {
  sevdeskContactId: string;
  name: string;
  customerNumber?: string;
  phone?: string;
  email?: string;
  street?: string;
  zip?: string;
  city?: string;
}

export interface SevOrderSnapshot {
  id: string;
  orderNumber: string;
  status: number;
  statusLabel: string;
  sumNet: number;
  positions: SevOrderPos[];
  contact?: SevContactData;
}

/** Lädt Telefon/E-Mail/Adresse eines sevDesk-Kontakts (rein lesend). */
async function loadContactData(contactId: string): Promise<SevContactData | undefined> {
  if (!contactId) return undefined;
  try {
    const r = await sd<any>(`Contact/${contactId}?embed=communicationWays,addresses`);
    const c = Array.isArray(r?.objects) ? r.objects[0] : r?.objects;
    if (!c) return undefined;
    let phone: string | undefined;
    let email: string | undefined;
    for (const cw of (c.communicationWays ?? [])) {
      const val = String(cw?.value ?? '').trim();
      if (!val) continue;
      const type = String(cw?.type ?? '').toUpperCase();
      const isMain = String(cw?.main ?? '') === '1';
      if (type === 'EMAIL') { if (!email || isMain) email = val; }
      else if (type === 'PHONE' || type === 'MOBILE' || type === 'LANDLINE') { if (!phone || isMain) phone = val; }
    }
    const a = (c.addresses ?? [])[0] ?? {};
    const sur = String(c.surename ?? '').trim();
    const fam = String(c.familyname ?? '').trim();
    const company = String(c.name ?? '').trim();
    return {
      sevdeskContactId: String(contactId),
      name: [sur, fam].filter(Boolean).join(' ').trim() || company,
      customerNumber: c.customerNumber ? String(c.customerNumber) : undefined,
      phone, email,
      street: a.street ? String(a.street).trim() : undefined,
      zip: a.zip ? String(a.zip).trim() : undefined,
      city: a.city ? String(a.city).trim() : undefined,
    };
  } catch { return undefined; }
}

/** Liest Kopf + Positionen + Kontaktdaten einer Order als Schnappschuss (nur lesen). */
export async function sevdeskGetOrderSnapshot(ref: { id?: string; orderNumber?: string }): Promise<SevOrderSnapshot> {
  // Order-ID auflösen (wie beim Storno): erst direkte ID, sonst per Nummer.
  let orderId = ref.id?.trim();
  if (!orderId && ref.orderNumber) {
    const found = await sd<any>(`Order?orderNumber=${encodeURIComponent(ref.orderNumber)}&depth=0`);
    orderId = String(found?.objects?.[0]?.id ?? '');
  }
  if (!orderId) throw new Error('Kein sevDesk-Beleg verknüpft (keine Order-ID/Nummer).');

  // Kopf (mit Kontakt-Referenz für den Stammdaten-Abgleich)
  const head = await sd<any>(`Order/${orderId}?embed=contact`);
  const o = Array.isArray(head?.objects) ? head.objects[0] : head?.objects;
  if (!o) throw new Error(`sevDesk-Beleg ${orderId} nicht gefunden.`);
  const status = parseInt(String(o.status ?? '0'), 10) || 0;
  const contact = await loadContactData(String((o.contact ?? {}).id ?? ''));

  // Positionen (mit Einheit)
  const posR = await sd<any>(`Order/${orderId}/getPositions?embed=unity`);
  const positions: SevOrderPos[] = (posR?.objects ?? []).map((p: any) => {
    const u = p.unity || {};
    const code = String(u.translationCode ?? '');
    return {
      positionNumber: parseInt(String(p.positionNumber ?? '0'), 10) || 0,
      name: String(p.name ?? '').trim(),
      quantity: parseFloat(String(p.quantity ?? '0')) || 0,
      price: parseFloat(String(p.price ?? '0')) || 0,
      sumNet: parseFloat(String(p.sumNet ?? '0')) || 0,
      unityLabel: UNITY_LABEL[code] ?? (code ? code.replace(/^UNITY_/, '').toLowerCase() : ''),
      text: String(p.text ?? '').trim(),
    };
  }).sort((a: SevOrderPos, b: SevOrderPos) => a.positionNumber - b.positionNumber);

  return {
    id: String(orderId),
    orderNumber: String(o.orderNumber ?? ref.orderNumber ?? ''),
    status,
    statusLabel: ORDER_STATUS_LABEL[status] ?? `Status ${status}`,
    sumNet: parseFloat(String(o.sumNet ?? '0')) || 0,
    positions,
    contact,
  };
}

// ── Beleg-Suche für noch nicht verknüpfte Karten: findet den passenden
//    sevDesk-Beleg über den Kundennamen, damit eine „nackte" Pipeline-Karte
//    (ohne AN-Nummer) mit ihrem Beleg verbunden werden kann. ─────────────────

export interface SevOrderRef {
  id: string;
  orderNumber: string;
  status: number;
  statusLabel: string;
  sumNet: number;
  contactName: string;
  contactId: string;
}

let _orderCache: { at: number; data: SevOrderRef[] } | null = null;

/** Lädt ALLE Aufträge/Angebote (mit Kontaktnamen via embed=contact),
 *  paginiert. 5-Min-Cache. WICHTIG: embed=contact statt depth — sonst kommen
 *  die Kontakt-Namensfelder nicht mit und eine Namenssuche läuft ins Leere. */
export async function sevdeskListOrders(force = false): Promise<SevOrderRef[]> {
  if (!force && _orderCache && Date.now() - _orderCache.at < CONTACT_TTL) {
    return _orderCache.data;
  }
  const all: SevOrderRef[] = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) { // Sicherheits-Cap (50×100)
    const r = await sd<any>(`Order?embed=contact&limit=100&offset=${offset}`);
    const objs: any[] = r?.objects ?? [];
    if (!objs.length) break;
    for (const o of objs) {
      const c = o.contact || {};
      const name = [c.surename, c.familyname].filter(Boolean).join(' ').trim() || String(c.name ?? '').trim();
      const status = parseInt(String(o.status ?? '0'), 10) || 0;
      all.push({
        id: String(o.id ?? ''),
        orderNumber: String(o.orderNumber ?? ''),
        status,
        statusLabel: ORDER_STATUS_LABEL[status] ?? `Status ${status}`,
        sumNet: parseFloat(String(o.sumNet ?? '0')) || 0,
        contactName: name,
        contactId: String(c.id ?? ''),
      });
    }
    if (objs.length < 100) break;
    offset += 100;
  }
  _orderCache = { at: Date.now(), data: all };
  return all;
}

/** Normalisiert einen Namen für den Vergleich (Umlaute, Kleinschreibung). */
function normName(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Sucht sevDesk-Belege, deren Kontaktname zum Kundennamen der Karte passt.
 *  Bei mehrteiligen Namen müssen ALLE Namensteile vorkommen (verhindert, dass
 *  z. B. alle „Daniel" auftauchen). Sortiert: beste Übereinstimmung zuerst. */
export async function sevdeskFindOrdersForName(name: string, force = false): Promise<SevOrderRef[]> {
  const target = normName(name);
  const tokens = target.split(' ').filter((t) => t.length > 2);
  if (!tokens.length) return [];
  const orders = await sevdeskListOrders(force);
  const minScore = tokens.length > 1 ? 70 : 40;
  const scored = orders.map((o) => {
    const cn = normName(o.contactName);
    let score = 0;
    if (cn && cn === target) score = 100;
    else if (cn) {
      const matched = tokens.filter((t) => cn.includes(t)).length;
      score = matched === tokens.length ? 70 : matched * 40;
    }
    return { o, score };
  }).filter((x) => x.score >= minScore);
  scored.sort((a, b) => b.score - a.score || b.o.status - a.o.status);
  return scored.map((x) => x.o);
}
