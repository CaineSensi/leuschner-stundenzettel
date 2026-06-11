// Baut die lebende HTML-Doku der Rechnungspositionen aus _tmp_sevdesk_data.json.
// READ-ONLY-Auswertung; schreibt L:\Leuschner APP\Leuschner_Rechnungspositionen.html
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('_tmp_sevdesk_data.json', 'utf8'));
const OUT = 'L:\\Leuschner APP\\Leuschner_Rechnungspositionen.html';

// ---------- Helfer ----------
const num = (v) => (v == null || v === '' ? 0 : parseFloat(String(v).replace(',', '.')) || 0);
const isoDate = (s) => (s ? String(s).slice(0, 10) : null);
const foldKey = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?"'()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------- Kategorisierung (best guess) ----------
// Geordnete Scan-Liste: erstes passendes Stichwort bestimmt die Kategorie.
const CAT_RULES = [
  ['ZAU', ['zaun', 'doppelstab', 'pfosten', 'gabion', 'sichtschutz', 'palisade', ' tor ', 'gartentor', 'maschendraht', 'spanndraht']],
  ['VWG', ['anfahrt', 'arbeitslohn', 'arbeitsstunde', 'stundenlohn', 'regie', 'transportpauschale', 'leihgebuhr', 'europaletten', 'geratenutzung', 'pauschale', 'einsatz ', 'miete', 'entsorgungspauschale']],
  ['PFL', ['pflaster', 'verbund', 'bord', 'randstein', 'rasenkante', 'rasenbord', 'einfassung', 'naturstein', 'platten', 'terrasse', 'klinker', 'rechteckpflaster', 'haco', 'ruttel', 'kopfstein', 'fugensand', 'einkehr']],
  ['GTN', ['baum', 'hecke', 'rasen', 'pflanz', ' beet', 'gehol', 'rinde', 'mulch', 'strauch', 'busch', 'fallen', 'rodung', 'wurzel', 'vertikut', 'grunabfall', 'grunschnitt', 'bepflanz', 'rollrasen', 'schnitt', 'bewasser']],
  ['ERD', ['bagger', 'radlader', 'aushub', 'erdarbeit', 'mutterboden', 'schotter', 'brechsand', 'fullsand', ' sand', 'mineralgemisch', ' rc ', 'planum', 'frostschutz', 'verfull', 'verdicht', 'entsorgung', 'bodenaushub', 'transport', 'fracht', 'deponie', 'mahlgut', 'motorerdbohr', 'drainage', 'filtervlies', 'vlies', 'kg rohr', 'kg bogen', 'kg muffe', 'kg doppelmuffe', 'kg abzweig', 'kg stopfen', 'kg reduzierung', 'ht rohr', 'ht bogen', 'ht muffe', 'ht doppelmuffe', 'kanal', 'aco drain', 'aco ', 'drain', 'hofablauf', 'hofsinkkasten', 'sinkkasten', 'marley', 'pvc', 'dn 1', 'big bag', 'grube', 'beton', 'estrich', 'schnellbeton', 'mortel', 'putz', 'betonstahl', 'fliesenkleber', 'gleitmittel', 'kies', 'splitt', 'tragschicht', 'abfuhr', 'abtrag', 'modellier', 'kabelverlege', 'rohre umgelegt', 'wasser abpumpen']],
];
function categorize(key) {
  const k = ' ' + key + ' ';
  for (const [cat, words] of CAT_RULES) {
    for (const w of words) if (k.includes(w)) return cat;
  }
  return 'SON';
}

// ---------- Rechnungen aufbereiten ----------
const STATUS = { '100': 'Entwurf', '200': 'offen', '1000': 'bezahlt' };
const TYPE = { RE: 'Rechnung', SR: 'Storno', AR: 'Abschlag', ER: 'Endrechnung', TR: 'Teilrechnung' };

const RECHNUNGEN = data.invoices.map((i) => {
  const posArr = data.positions[i.id] || [];
  return {
    id: i.id,
    nr: i.invoiceNumber,
    datum: isoDate(i.invoiceDate),
    kunde: data.contactNames[i.contact?.id] || i.addressName || '—',
    netto: num(i.sumNet),
    brutto: num(i.sumGross),
    status: i.status,
    statusText: STATUS[i.status] || i.status,
    typ: i.invoiceType,
    typText: TYPE[i.invoiceType] || i.invoiceType,
    posCount: posArr.length,
  };
}).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

const invByNr = Object.fromEntries(RECHNUNGEN.map((r) => [r.id, r]));

// ---------- Positionen clustern ----------
const groups = new Map();
for (const [invId, arr] of Object.entries(data.positions)) {
  const inv = invByNr[invId];
  if (!inv) continue;
  for (const p of arr) {
    const rawLabel = (p.name || p.text || '(ohne Bezeichnung)').replace(/\s+/g, ' ').trim();
    const key = foldKey(rawLabel) || '(leer)';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: rawLabel, // Anzeige-Label (häufigste Schreibweise, später bestimmt)
        spellings: new Map(),
        cat: categorize(key),
        invoiceIds: new Set(),
        rows: [],
      });
    }
    const g = groups.get(key);
    g.spellings.set(rawLabel, (g.spellings.get(rawLabel) || 0) + 1);
    g.invoiceIds.add(invId);
    g.rows.push({
      invId,
      nr: inv.nr,
      datum: inv.datum,
      kunde: inv.kunde,
      qty: num(p.quantity),
      unit: p.unity?.name || '—',
      priceNet: num(p.priceNet ?? p.price),
      sumNet: num(p.sumNet),
    });
  }
}

const POSITIONEN = [...groups.values()].map((g) => {
  // häufigste Schreibweise als Label
  const spellSorted = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]);
  const label = spellSorted[0][0];
  // Mengen je Einheit
  const perUnit = {};
  for (const r of g.rows) perUnit[r.unit] = (perUnit[r.unit] || 0) + r.qty;
  const prices = g.rows.map((r) => r.priceNet).filter((x) => x > 0);
  const rowsByDate = [...g.rows].sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  const last = rowsByDate[0];
  const beispiele = rowsByDate.slice(0, 6).map((r) => ({
    nr: r.nr, datum: r.datum, kunde: r.kunde, qty: r.qty, unit: r.unit, priceNet: r.priceNet, sumNet: r.sumNet,
  }));
  return {
    label,
    cat: g.cat,
    anzahlRechnungen: g.invoiceIds.size,
    anzahlPositionen: g.rows.length,
    mengeProEinheit: perUnit,
    einheiten: [...new Set(g.rows.map((r) => r.unit))],
    preisMin: prices.length ? Math.min(...prices) : 0,
    preisMax: prices.length ? Math.max(...prices) : 0,
    preisZuletzt: last.priceNet,
    umsatzNetto: g.rows.reduce((s, r) => s + r.sumNet, 0),
    letzteNr: last.nr,
    letztesDatum: last.datum,
    schreibweisen: [...g.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ text: t, count: c })),
    beispiele,
  };
}).sort((a, b) => b.anzahlRechnungen - a.anzahlRechnungen || b.anzahlPositionen - a.anzahlPositionen);

// ---------- Kunststoff-Sparte ausfiltern (Rick 11.06.2026) ----------
// PP Mahlgut ist Polypropylen-Recycling (eigene Plastik-Sparte), kein GaLaBau.
// Bewusst NUR das exakte Label — PP-Sichtschutzstreifen (Zaun), Big Bags etc.
// sind echtes GaLaBau-Material und bleiben drin.
const PLASTIK_LABELS = ['pp mahlgut'];
const plastikGruppen = POSITIONEN.filter((p) => PLASTIK_LABELS.includes(p.label.trim().toLowerCase()));
const POSITIONEN_GEFILTERT = POSITIONEN.filter((p) => !PLASTIK_LABELS.includes(p.label.trim().toLowerCase()));
const plastikUmsatz = plastikGruppen.reduce((s, p) => s + p.umsatzNetto, 0);
const plastikZeilen = plastikGruppen.reduce((s, p) => s + p.anzahlPositionen, 0);
POSITIONEN.length = 0;
POSITIONEN.push(...POSITIONEN_GEFILTERT);

// ---------- KPIs ----------
const dates = RECHNUNGEN.map((r) => r.datum).filter(Boolean).sort();
// GaLaBau-Umsatz = Rechnungsumsatz minus ausgefilterte Kunststoff-Zeilen
const umsatzNetto = RECHNUNGEN.filter((r) => r.typ !== 'SR').reduce((s, r) => s + r.netto, 0) - plastikUmsatz;
const stornoCount = RECHNUNGEN.filter((r) => r.typ === 'SR').length;
const catCount = {};
for (const p of POSITIONEN) catCount[p.cat] = (catCount[p.cat] || 0) + 1;

const META = {
  stand: new Date().toISOString().slice(0, 10),
  abrufZeit: data.fetched_at,
  anzahlRechnungen: RECHNUNGEN.length,
  zeitraumVon: dates[0],
  zeitraumBis: dates[dates.length - 1],
  anzahlPositionsGruppen: POSITIONEN.length,
  anzahlPositionsZeilen: POSITIONEN.reduce((s, p) => s + p.anzahlPositionen, 0),
  umsatzNetto,
  stornoCount,
  catCount,
  plastikFilter: plastikGruppen.length ? {
    label: plastikGruppen.map((p) => p.label).join(', '),
    grund: 'Kunststoff-Sparte, kein GaLaBau (Rick 11.06.2026)',
    anzahlRechnungen: plastikGruppen.reduce((s, p) => s + p.anzahlRechnungen, 0),
    anzahlPositionen: plastikZeilen,
    umsatzNetto: Math.round(plastikUmsatz * 100) / 100,
  } : undefined,
};

console.log('META', JSON.stringify(META, null, 1));
console.log('TOP10:');
for (const p of POSITIONEN.slice(0, 10)) console.log(String(p.anzahlRechnungen).padStart(3), p.cat, p.label);

// ---------- HTML schreiben ----------
const html = buildHtml(META, POSITIONEN, RECHNUNGEN);
writeFileSync(OUT, html, 'utf8');
console.log('\nGeschrieben:', OUT, '(' + (html.length / 1024).toFixed(0) + ' KB)');

function buildHtml(META, POSITIONEN, RECHNUNGEN) {
  const json = (o) => JSON.stringify(o);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leuschner · Rechnungspositionen-Analyse</title>
<!--
  ============================================================================
  LEBENDE DOKU · Leuschner Rechnungspositionen (Quelle: sevDesk API, read-only)
  ============================================================================
  PFLEGE-ANLEITUNG FÜR KÜNFTIGE CLAUDE-SESSIONS
  ----------------------------------------------------------------------------
  Diese Datei wird NICHT von Hand editiert. Sie wird komplett neu erzeugt vom
  Generator:  L:\\Leuschner APP\\app\\scripts\\build-positions.mjs
  Ablauf zum Fortschreiben:
    1) Daten frisch ziehen (über den eigenen Pages-Proxy, Token bleibt server-
       seitig):   cd "L:\\Leuschner APP\\app" && npm run fetch-invoices
       -> schreibt app/_tmp_sevdesk_data.json
       (Der Proxy /api/sevdesk/Invoice ist nur mit Header
        x-dd-analyse: LX-9f2e7c41-analyse + GET erreichbar; rein lesend.)
    2) HTML neu bauen:  npm run build-positions
       -> überschreibt diese Datei mit aktuellen Arrays.
  Die eigentlichen Daten liegen unten als JS-Konstanten (META / POSITIONEN /
  RECHNUNGEN). Das Rendering passiert per Vanilla-JS im Browser.
  WICHTIG: sevDesk wird ausschließlich GELESEN (kein POST/PUT/DELETE).
  Kategorien sind eine automatische Schätzung (Stichwort-Heuristik) und können
  pro Position daneben liegen -> bei Bedarf CAT_RULES im Generator schärfen.
  ============================================================================
-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#191B1E;--bg2:#1A1C1E;--panel:#212427;--panel2:#262A2E;--line:#33383D;
    --ink:#ECEEF0;--mut:#9AA1A8;--mut2:#6B7178;--cu:#DC6E2D;--cu2:#F08A4B;
    --good:#4FB477;--warn:#E0A23B;--bad:#D9544D;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Archivo',system-ui,sans-serif;--text:'Atkinson Hyperlegible',system-ui,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font-family:var(--text);line-height:1.5;font-size:14.5px;
    background-image:linear-gradient(180deg,#15171A 0%,#191B1E 380px);min-height:100vh}
  .wrap{max-width:1240px;margin:0 auto;padding:30px 22px 80px}
  header.top{border-bottom:2px solid var(--line);padding-bottom:20px;margin-bottom:24px}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--cu);font-weight:700}
  h1{font-family:var(--disp);font-weight:800;font-size:33px;letter-spacing:.3px;text-transform:uppercase;margin-top:6px}
  h1 b{color:var(--cu)}
  .sub{color:var(--mut);font-size:13.5px;margin-top:6px}
  .bar{height:5px;width:84px;background:var(--cu);border-radius:3px;margin:14px 0 0}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0 6px}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 15px;position:relative;overflow:hidden}
  .kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--cu)}
  .kpi .v{font-family:var(--mono);font-weight:700;font-size:23px;color:#fff}
  .kpi .l{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;margin-top:3px}
  h2{font-family:var(--disp);font-weight:700;font-size:19px;text-transform:uppercase;letter-spacing:.5px;
    margin:36px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
  h2 .n{font-family:var(--mono);font-size:12px;color:var(--cu);font-weight:500}
  .controls{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:6px 0 14px}
  input[type=search]{flex:1;min-width:220px;background:var(--panel);border:1px solid var(--line);color:var(--ink);
    font-family:var(--text);font-size:14px;padding:10px 13px;border-radius:8px;outline:none}
  input[type=search]:focus{border-color:var(--cu)}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-family:var(--mono);font-size:11px;font-weight:500;padding:6px 11px;border-radius:999px;cursor:pointer;
    background:var(--panel);border:1px solid var(--line);color:var(--mut);user-select:none;transition:.12s}
  .chip:hover{color:var(--ink);border-color:var(--mut2)}
  .chip.on{background:var(--cu);border-color:var(--cu);color:#1a1209;font-weight:700}
  .cat{font-family:var(--mono);font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;letter-spacing:.04em;white-space:nowrap}
  .c-ERD{background:#4a3522;color:#f0b27a} .c-PFL{background:#2d3a4a;color:#85b4e0}
  .c-GTN{background:#26402c;color:#7fd197} .c-ZAU{background:#3d2c44;color:#c79bd6}
  .c-VWG{background:#43402a;color:#dcc878} .c-SON{background:#2f3338;color:#9aa1a8}
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead th{position:sticky;top:0;background:#16181B;color:var(--mut);font-family:var(--mono);font-weight:500;
    font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:10px 11px;border-bottom:2px solid var(--line);z-index:2}
  thead th.r{text-align:right}
  tbody tr.row{border-bottom:1px solid var(--line);cursor:pointer;transition:.1s}
  tbody tr.row:hover{background:var(--panel)}
  tbody tr.row.open{background:var(--panel2)}
  td{padding:9px 11px;vertical-align:top}
  td.r{text-align:right;font-family:var(--mono)}
  td.num{font-family:var(--mono)}
  .lbl{font-weight:700}
  .badge{display:inline-block;font-family:var(--mono);font-size:11px;background:var(--panel2);border:1px solid var(--line);
    border-radius:6px;padding:2px 8px;min-width:34px;text-align:center}
  .badge.hot{background:var(--cu);color:#1a1209;border-color:var(--cu);font-weight:700}
  .det{background:#15171A}
  .det td{padding:0}
  .detin{padding:16px 18px;border-left:3px solid var(--cu);margin:2px 0}
  .detgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:760px){.detgrid{grid-template-columns:1fr}}
  .dh{font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--cu);margin-bottom:7px}
  .spell{display:flex;flex-wrap:wrap;gap:6px}
  .spell span{font-size:12px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:3px 9px}
  .spell span b{font-family:var(--mono);color:var(--cu);margin-left:6px}
  table.mini{font-size:12px;margin-top:2px}
  table.mini th{position:static;background:transparent;border-bottom:1px solid var(--line);padding:5px 8px}
  table.mini td{padding:5px 8px;border-bottom:1px solid #23262a}
  .re{font-family:var(--mono);color:var(--cu2)}
  .st{font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:5px;white-space:nowrap}
  .st-1000{background:#1f3a2a;color:#6fd197}.st-200{background:#43402a;color:#e0c87a}.st-100{background:#2f3338;color:#9aa1a8}
  .ty{font-family:var(--mono);font-size:10px;color:var(--mut)}
  .ty-SR{color:var(--bad);font-weight:700}
  .muted{color:var(--mut)}
  .note{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--cu);border-radius:0 8px 8px 0;
    padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0}
  .note b{color:var(--ink)}
  footer{margin-top:42px;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mut2);font-family:var(--mono);line-height:1.7}
  .count{font-family:var(--mono);font-size:12px;color:var(--mut);margin-left:auto}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="kicker">Rund um's Haus Leuschner e.K. · sevDesk-Auswertung</div>
    <h1>Rechnungs<b>positionen</b></h1>
    <div class="sub" id="subline"></div>
    <div class="bar"></div>
    <div class="kpis" id="kpis"></div>
  </header>

  <h2><span class="n">01</span> Arbeitspositionen <span class="count" id="poscount"></span></h2>
  <div class="note">Sortiert nach Häufigkeit (in wie vielen Rechnungen die Position vorkommt). Klick auf eine Zeile öffnet
    Details: alle Original-Schreibweisen der Gruppe und Beispiel-Rechnungen. Die <b>Kategorie</b> ist eine automatische
    Schätzung anhand von Stichwörtern und kann im Einzelfall abweichen.</div>
  <div class="controls">
    <input type="search" id="q" placeholder="Position suchen … (z. B. Pflaster, Bagger, Zaun)">
    <div class="chips" id="cats"></div>
  </div>
  <div class="scroll">
    <table id="postable">
      <thead><tr>
        <th>Position</th><th>Kat.</th><th class="r">Rechn.</th><th class="r">Pos.</th>
        <th class="r">Gesamtmenge</th><th class="r">Preis netto (min / max / zuletzt)</th><th>Zuletzt</th>
      </tr></thead>
      <tbody id="posbody"></tbody>
    </table>
  </div>

  <h2><span class="n">02</span> Rechnungs-Register <span class="count" id="recount"></span></h2>
  <div class="note">Alle erfassten Ausgangsrechnungen, neueste zuerst. <b>Storno</b>-Rechnungen (Typ SR) sind rot markiert;
    sie sind nicht im Gesamtumsatz enthalten.</div>
  <div class="controls">
    <input type="search" id="rq" placeholder="Rechnung suchen … (RE-Nummer oder Kunde)">
  </div>
  <div class="scroll">
    <table id="retable">
      <thead><tr>
        <th>RE-Nr.</th><th>Datum</th><th>Kunde</th><th class="r">Netto</th><th class="r">Brutto</th>
        <th class="r">Pos.</th><th>Status</th><th>Typ</th>
      </tr></thead>
      <tbody id="rebody"></tbody>
    </table>
  </div>

  <footer id="foot"></footer>
</div>

<script>
const META = ${json(META)};
const POSITIONEN = ${json(POSITIONEN)};
const RECHNUNGEN = ${json(RECHNUNGEN)};

const CAT_LABEL = {ERD:'Erdarbeiten',PFL:'Pflasterarbeiten',GTN:'Gartenarbeiten',ZAU:'Zaunarbeiten',VWG:'Verwaltung',SON:'Sonstiges'};
const fmtN = (n,d=2)=> n.toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtEUR = n => fmtN(n,2)+' €';
const fmtQty = n => Number.isInteger(n)? n.toLocaleString('de-DE') : fmtN(n,2);
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- Kopf ----
document.getElementById('subline').innerHTML =
  'Stand <b>'+META.stand+'</b> · '+META.anzahlRechnungen+' Rechnungen · Zeitraum '+
  (META.zeitraumVon||'?')+' bis '+(META.zeitraumBis||'?')+
  (META.plastikFilter ? ' · <span style="color:var(--warn)">ohne Kunststoff-Sparte ('+
    META.plastikFilter.label+': '+META.plastikFilter.anzahlRechnungen+' Rechnungen, '+
    fmtEUR(META.plastikFilter.umsatzNetto)+' separat)</span>' : '');
const kpis = [
  ['Rechnungen', META.anzahlRechnungen],
  ['Zeitraum', (META.zeitraumVon||'').slice(0,7)+' – '+(META.zeitraumBis||'').slice(0,7)],
  ['Positions-Gruppen', META.anzahlPositionsGruppen],
  ['Positions-Zeilen', META.anzahlPositionsZeilen],
  ['Umsatz netto', fmtEUR(META.umsatzNetto)],
  ['Storno-Rechnungen', META.stornoCount],
];
document.getElementById('kpis').innerHTML = kpis.map(([l,v])=>
  '<div class="kpi"><div class="v">'+(typeof v==='number'?v.toLocaleString('de-DE'):esc(v))+'</div><div class="l">'+l+'</div></div>'
).join('');

// ---- Kategorie-Filter ----
let activeCat = 'ALL';
const cats = ['ALL','ERD','PFL','GTN','ZAU','VWG','SON'];
document.getElementById('cats').innerHTML = cats.map(c=>{
  const n = c==='ALL'? POSITIONEN.length : (META.catCount[c]||0);
  const lbl = c==='ALL'?'Alle':c+' · '+CAT_LABEL[c];
  return '<span class="chip'+(c==='ALL'?' on':'')+'" data-c="'+c+'">'+lbl+' ('+n+')</span>';
}).join('');
document.getElementById('cats').addEventListener('click', e=>{
  const ch = e.target.closest('.chip'); if(!ch) return;
  activeCat = ch.dataset.c;
  [...document.querySelectorAll('#cats .chip')].forEach(x=>x.classList.toggle('on', x.dataset.c===activeCat));
  renderPos();
});

// ---- Positions-Tabelle ----
const maxRech = Math.max(...POSITIONEN.map(p=>p.anzahlRechnungen));
function posRow(p, idx){
  const menge = Object.entries(p.mengeProEinheit)
    .map(([u,q])=>fmtQty(q)+' '+u).join(' · ');
  const preis = p.preisMin? (fmtN(p.preisMin)+' / '+fmtN(p.preisMax)+' / '+fmtN(p.preisZuletzt)) : '—';
  const hot = p.anzahlRechnungen >= Math.max(8, maxRech*0.4);
  let h = '<tr class="row" data-i="'+idx+'">'+
    '<td><span class="lbl">'+esc(p.label)+'</span></td>'+
    '<td><span class="cat c-'+p.cat+'">'+p.cat+'</span></td>'+
    '<td class="r"><span class="badge'+(hot?' hot':'')+'">'+p.anzahlRechnungen+'</span></td>'+
    '<td class="r num">'+p.anzahlPositionen+'</td>'+
    '<td class="r num">'+esc(menge)+'</td>'+
    '<td class="r num">'+preis+'</td>'+
    '<td class="num"><span class="re">'+esc(p.letzteNr)+'</span><br><span class="muted">'+(p.letztesDatum||'')+'</span></td>'+
  '</tr>';
  return h;
}
function detRow(p, idx){
  const spells = p.schreibweisen.map(s=>'<span>'+esc(s.text)+'<b>'+s.count+'×</b></span>').join('');
  const bsp = p.beispiele.map(b=>
    '<tr><td><span class="re">'+esc(b.nr)+'</span></td><td class="muted">'+(b.datum||'')+'</td>'+
    '<td>'+esc(b.kunde)+'</td><td class="num" style="text-align:right">'+fmtQty(b.qty)+' '+esc(b.unit)+'</td>'+
    '<td class="num" style="text-align:right">'+fmtEUR(b.priceNet)+'</td>'+
    '<td class="num" style="text-align:right">'+fmtEUR(b.sumNet)+'</td></tr>'
  ).join('');
  return '<tr class="det" data-det="'+idx+'" hidden><td colspan="7"><div class="detin">'+
    '<div class="detgrid">'+
      '<div><div class="dh">Original-Schreibweisen ('+p.schreibweisen.length+')</div><div class="spell">'+spells+'</div>'+
        '<div class="dh" style="margin-top:14px">Eckdaten</div>'+
        '<div class="muted" style="font-size:12.5px;line-height:1.8">'+
          'Kategorie: <b style="color:var(--ink)">'+p.cat+' · '+CAT_LABEL[p.cat]+'</b><br>'+
          'In '+p.anzahlRechnungen+' Rechnungen · '+p.anzahlPositionen+' Positionszeilen<br>'+
          'Umsatz netto gesamt: <b style="color:var(--ink)">'+fmtEUR(p.umsatzNetto)+'</b><br>'+
          'Einheiten: '+esc(p.einheiten.join(', '))+'</div>'+
      '</div>'+
      '<div><div class="dh">Beispiel-Rechnungen (neueste zuerst)</div>'+
        '<table class="mini"><thead><tr><th>RE-Nr.</th><th>Datum</th><th>Kunde</th>'+
        '<th style="text-align:right">Menge</th><th style="text-align:right">Einzel netto</th><th style="text-align:right">Summe netto</th></tr></thead>'+
        '<tbody>'+bsp+'</tbody></table></div>'+
    '</div></div></td></tr>';
}
let filtered = POSITIONEN;
function renderPos(){
  const q = document.getElementById('q').value.trim().toLowerCase();
  filtered = POSITIONEN.filter(p=>{
    if(activeCat!=='ALL' && p.cat!==activeCat) return false;
    if(q){
      const hay = (p.label+' '+p.schreibweisen.map(s=>s.text).join(' ')).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  const body = document.getElementById('posbody');
  body.innerHTML = filtered.map((p,i)=>posRow(p,i)+detRow(p,i)).join('');
  document.getElementById('poscount').textContent = filtered.length+' von '+POSITIONEN.length+' Gruppen';
}
document.getElementById('q').addEventListener('input', renderPos);
document.getElementById('posbody').addEventListener('click', e=>{
  const row = e.target.closest('tr.row'); if(!row) return;
  const i = row.dataset.i;
  const det = document.querySelector('tr.det[data-det="'+i+'"]');
  const open = det.hasAttribute('hidden');
  if(open){ det.removeAttribute('hidden'); row.classList.add('open'); }
  else { det.setAttribute('hidden',''); row.classList.remove('open'); }
});

// ---- Rechnungs-Register ----
function renderRe(){
  const q = document.getElementById('rq').value.trim().toLowerCase();
  const list = RECHNUNGEN.filter(r=> !q || (r.nr+' '+r.kunde).toLowerCase().includes(q));
  document.getElementById('rebody').innerHTML = list.map(r=>
    '<tr style="border-bottom:1px solid var(--line)">'+
    '<td><span class="re">'+esc(r.nr)+'</span></td>'+
    '<td class="num muted">'+(r.datum||'')+'</td>'+
    '<td>'+esc(r.kunde)+'</td>'+
    '<td class="r">'+fmtEUR(r.netto)+'</td>'+
    '<td class="r muted">'+fmtEUR(r.brutto)+'</td>'+
    '<td class="r num">'+r.posCount+'</td>'+
    '<td><span class="st st-'+r.status+'">'+esc(r.statusText)+'</span></td>'+
    '<td><span class="ty ty-'+r.typ+'">'+esc(r.typText)+'</span></td>'+
    '</tr>'
  ).join('');
  document.getElementById('recount').textContent = list.length+' von '+RECHNUNGEN.length+' Rechnungen';
}
document.getElementById('rq').addEventListener('input', renderRe);

// ---- Footer ----
document.getElementById('foot').innerHTML =
  'Datenquelle: sevDesk API (my.sevdesk.de) · ausschließlich lesend (GET) · Abruf über eigenen Cloudflare-Pages-Proxy<br>'+
  'API-Abruf-Zeitpunkt: '+esc(META.abrufZeit)+' · HTML-Stand: '+META.stand+'<br>'+
  'Lebende Datei – Fortschreibung über npm run fetch-invoices + npm run build-positions (siehe HTML-Kommentar oben).';

renderPos(); renderRe();
</script>
</body>
</html>`;
}
