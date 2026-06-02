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
  phone?: string;
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
  if (input.phone) {
    await sd('CommunicationWay', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: { id: contactId, objectName: 'Contact' },
        type: 'PHONE', value: input.phone, key: { id: '1', objectName: 'CommunicationWayKey' },
      }),
    }).catch(() => {});
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

/** Ermittelt die höchste vergebene AN-Nummer (workaround für Bug getNextOrderNumber). */
export async function sevdeskNextOrderNumber(): Promise<string> {
  // Wir holen die letzten ~5 Aufträge nach createDate desc, filtern auf AN-Format
  const r = await sd<any>('Order?limit=10&orderBy=create:desc&depth=0');
  const nums = (r?.objects ?? [])
    .map((o: any) => String(o?.orderNumber ?? ''))
    .filter((n: string) => /^AN-\d+$/.test(n))
    .map((n: string) => parseInt(n.slice(3), 10))
    .sort((a: number, b: number) => b - a);
  const next = (nums[0] ?? 1000) + 1;
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
  if (!orderId) throw new Error('sevDesk-Order ohne ID/Nummer — nichts zu stornieren');

  // Aktuellen Belegtext lesen, um Storno-Vermerk nicht-destruktiv anzuhängen
  let prevHeadText = '';
  try {
    const cur = await sd<any>(`Order/${orderId}?depth=0`);
    prevHeadText = String(cur?.objects?.headText ?? '');
  } catch { /* irrelevant — wir können trotzdem stornieren */ }

  const stamp = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const stornoHinweis = `[STORNIERT am ${stamp}${reason ? ` — Grund: ${reason}` : ''}]`;
  const headText = prevHeadText ? `${stornoHinweis}\n\n${prevHeadText}` : stornoHinweis;

  await sd(`Order/${orderId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 500, headText }),
  });
}
