// READ-ONLY-Abruf aller sevDesk-Rechnungen + Positionen über den eigenen
// Pages-Proxy (Token bleibt server-seitig). Speichert nach _tmp_sevdesk_data.json.
import { writeFileSync } from 'node:fs';

const BASE = 'https://leuschner-stundenzettel.pages.dev/api/sevdesk';
const HEAD = { 'x-dd-analyse': 'LX-9f2e7c41-analyse', Accept: 'application/json' };

async function get(path) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(BASE + '/' + path, { headers: HEAD });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (a === 4) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
  }
}

// 1) Alle Rechnungen
const invoices = [];
let offset = 0;
while (true) {
  const d = await get(`Invoice?limit=200&offset=${offset}&embed=contact`);
  const objs = d.objects || [];
  invoices.push(...objs);
  console.log(`invoices: ${invoices.length} (total ${d.total ?? '?'})`);
  if (objs.length < 200) break;
  offset += 200;
}

// 2) Kontaktnamen nachladen (Invoice.contact hat nur id)
const contactIds = [...new Set(invoices.map((i) => i.contact?.id).filter(Boolean))];
const contactNames = {};
for (const cid of contactIds) {
  try {
    const d = await get(`Contact/${cid}`);
    const c = Array.isArray(d.objects) ? d.objects[0] : d.objects;
    contactNames[cid] = c?.name || [c?.surename, c?.familyname].filter(Boolean).join(' ') || null;
  } catch { contactNames[cid] = null; }
}
console.log(`contacts: ${Object.keys(contactNames).length}`);

// 3) Positionen je Rechnung
const positions = {};
for (let i = 0; i < invoices.length; i++) {
  const id = invoices[i].id;
  const d = await get(`InvoicePos?invoice[id]=${id}&invoice[objectName]=Invoice&limit=1000&embed=unity`);
  positions[id] = d.objects || [];
  if ((i + 1) % 25 === 0) console.log(`positions: ${i + 1}/${invoices.length}`);
}

const out = {
  fetched_at: new Date().toISOString(),
  contactNames,
  invoices,
  positions,
};
writeFileSync('_tmp_sevdesk_data.json', JSON.stringify(out));
const posCount = Object.values(positions).reduce((s, v) => s + v.length, 0);
console.log(`DONE ${invoices.length} invoices, ${posCount} positions`);
