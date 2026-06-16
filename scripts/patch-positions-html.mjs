// Einmaliger Patch: isArbeit-Feld + Ansicht-Toggle in Leuschner_Rechnungspositionen.html
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'L:\\Leuschner APP\\Leuschner_Rechnungspositionen.html';
let html = readFileSync(FILE, 'utf8');

// ---------- foldKey (identisch zum Generator) ----------
function foldKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?"'()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- ARBEIT_ROOTS ----------
const ARBEIT_ROOTS = [
  'arbeit','einbau','gebaut','aufbau','aufstell','legen','verteilen','verteilt',
  'verdichten','verdichtet','planieren','planiert','setzen','gesetzt',
  'herstell','hergestellt','montage','montier','entfern','zuruckbau','demontage',
  'entsorgung','entsorgen','ausheben','aushub','auskoffern','ausgekoffert',
  'auffullen','anfullen','einebnen','ausbagger','gebaggert',
  'ansahen','einsahen','saht','hark','frasen','schneid','schnitt',
  'fallen','gefallt','abwalzen','pflastern',
  'aufnehmen','aufgenommen','ausbauen','freilegen','freigelegt','freigestammt',
  'sanier','instandgesetzt','ausbess','repar','anpassen','angepasst',
  'angleich','angeglichen','ausgerichtet','abander','geflext','gestammt',
  'abpumpen','eingedeckt','befestig','anbringen','einfadeln','eingefadelt',
  'abbruch','abgebrochen','kabelverleg','suchschachtung','rutteln',
  'einschlammem','einschlammarbeit','betonier','erstell','anlegen',
  'angeschloss','reinig','geraumt','gefliest','verfugen','gepflastert',
  'verkleben','verschlies','absanden','abfall','abfahren','aufgeladen',
  'frachtkosten','frachtpauschale','umzug','wartezeit','pumparbeit',
  'einrichten','schachten','rohrgraben','lokalis','handwerk',
];
function isArbeitsposition(cat, key) {
  if (cat === 'VWG') return true;
  return ARBEIT_ROOTS.some(r => key.includes(r));
}

// ---------- POSITIONEN aus HTML extrahieren, isArbeit ergänzen ----------
const POS_MARKER = 'const POSITIONEN = ';
const posStart = html.indexOf(POS_MARKER) + POS_MARKER.length;
// Ende: erstes ";\n" nach dem Array-Ende
let depth = 0, posEnd = posStart;
for (let i = posStart; i < html.length; i++) {
  const c = html[i];
  if (c === '[' || c === '{') depth++;
  else if (c === ']' || c === '}') { depth--; if (depth === 0) { posEnd = i + 1; break; } }
}

const positions = JSON.parse(html.slice(posStart, posEnd));
let nArbeit = 0, nMaterial = 0;
for (const p of positions) {
  p.isArbeit = isArbeitsposition(p.cat, foldKey(p.label));
  p.isArbeit ? nArbeit++ : nMaterial++;
}
console.log(`isArbeit: ${nArbeit} Arbeit, ${nMaterial} Material`);

html = html.slice(0, posStart) + JSON.stringify(positions) + html.slice(posEnd);

// ---------- viewtoggle div einfügen ----------
const DIV_SEARCH = '  <div class="controls">\n    <input type="search" id="q"';
if (!html.includes('id="viewtoggle"')) {
  html = html.replace(
    DIV_SEARCH,
    '  <div class="controls" style="margin-bottom:6px">\n    <div class="chips" id="viewtoggle"></div>\n  </div>\n' + DIV_SEARCH
  );
  console.log('viewtoggle div eingefuegt');
} else {
  console.log('viewtoggle div bereits vorhanden');
}

// ---------- viewMode JS einfügen (vor Kategorie-Filter) ----------
const JS_SEARCH = '// ---- Kategorie-Filter ----\nlet activeCat';
if (!html.includes('viewMode')) {
  const TOGGLE_JS = [
    "// ---- Ansicht-Toggle (Arbeit / Alle / Material) ----",
    "let viewMode = 'arbeit';",
    "const VIEW_MODES = [['arbeit','Nur Arbeit'],['all','Alle'],['mat','Nur Material']];",
    "document.getElementById('viewtoggle').innerHTML = VIEW_MODES.map(([v,l])=>",
    "  '<span class=\"chip'+(v===' + \"'arbeit'\" + '?' + \"' on'\" + ':' + \"''\" + ')+' + '\"' + ' data-v=\"'+v+'\">'+l+'</span>'",
    ").join('');",
    "document.getElementById('viewtoggle').addEventListener('click', e=>{",
    "  const ch = e.target.closest('.chip'); if(!ch) return;",
    "  viewMode = ch.dataset.v;",
    "  [...document.querySelectorAll('#viewtoggle .chip')].forEach(x=>x.classList.toggle('on', x.dataset.v===viewMode));",
    "  renderPos();",
    "});",
    "",
    JS_SEARCH.split('\n')[1],  // "let activeCat"
  ].join('\n');

  // simpler approach: build the JS string carefully
  const toggleBlock = `// ---- Ansicht-Toggle (Arbeit / Alle / Material) ----
let viewMode = 'arbeit';
const VIEW_MODES = [['arbeit','Nur Arbeit'],['all','Alle'],['mat','Nur Material']];
document.getElementById('viewtoggle').innerHTML = VIEW_MODES.map(function([v,l]){
  return '<span class="chip'+(v==='arbeit'?' on':'')+'" data-v="'+v+'">'+l+'</span>';
}).join('');
document.getElementById('viewtoggle').addEventListener('click', function(e){
  const ch = e.target.closest('.chip'); if(!ch) return;
  viewMode = ch.dataset.v;
  document.querySelectorAll('#viewtoggle .chip').forEach(function(x){x.classList.toggle('on', x.dataset.v===viewMode);});
  renderPos();
});

// ---- Kategorie-Filter ----
let activeCat`;

  html = html.replace(JS_SEARCH, toggleBlock);
  console.log('viewMode JS eingefuegt');
} else {
  console.log('viewMode JS bereits vorhanden');
}

// ---------- renderPos Filter anpassen ----------
const RENDER_SEARCH = "  filtered = POSITIONEN.filter(p=>{\n    if(activeCat!=='ALL' && p.cat!==activeCat)";
const RENDER_NEW = `  filtered = POSITIONEN.filter(p=>{
    if(viewMode==='arbeit' && !p.isArbeit) return false;
    if(viewMode==='mat'    &&  p.isArbeit) return false;
    if(activeCat!=='ALL' && p.cat!==activeCat)`;

if (html.includes(RENDER_SEARCH)) {
  html = html.replace(RENDER_SEARCH, RENDER_NEW);
  console.log('renderPos Filter eingebaut');
} else {
  console.log('WARNUNG: renderPos Marker nicht gefunden');
}

// ---------- poscount Text anpassen ----------
const COUNT_SEARCH = "document.getElementById('poscount').textContent = filtered.length+' von '+POSITIONEN.length+' Gruppen';";
const COUNT_NEW = `var _tot=viewMode==='all'?POSITIONEN.length:viewMode==='arbeit'?POSITIONEN.filter(function(p){return p.isArbeit;}).length:POSITIONEN.filter(function(p){return !p.isArbeit;}).length;
  document.getElementById('poscount').textContent = filtered.length+' von '+_tot+' Gruppen';`;

if (html.includes(COUNT_SEARCH)) {
  html = html.replace(COUNT_SEARCH, COUNT_NEW);
  console.log('poscount aktualisiert');
} else {
  console.log('WARNUNG: poscount Marker nicht gefunden');
}

writeFileSync(FILE, html, 'utf8');
console.log('Fertig:', (html.length / 1024).toFixed(0), 'KB');
