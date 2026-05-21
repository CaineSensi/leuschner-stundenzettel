// Frontend-Wrapper für die Cloudflare-Pages-Function /api/sevdesk/*
// Token bleibt server-side. Pfade unten sind 1:1 sevDesk-Endpunkte.

import { llmStructure } from "./llm";
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
