/**
 * build-lv-seed.mjs  v2
 * Liest POSITIONEN aus Leuschner_Rechnungspositionen.html,
 * clustert und erzeugt lv-seed.sql + lv-seed-report.txt
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..', '..');
const HTML   = join(ROOT, 'Leuschner_Rechnungspositionen.html');
const SQL    = join(__dir, 'lv-seed.sql');
const REP    = join(__dir, 'lv-seed-report.txt');

// ── foldKey ─────────────────────────────────────────────────────────────────
function foldKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?"'()\[\]\/\\+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Mengen + Zusatz-Präfixe entfernen ────────────────────────────────────────
// Bugfix v2: (?=\W|$) statt \b am Ende (m² / m³ enden nicht auf \w)
function stripQty(s) {
  return s
    .replace(/\bca\.?\s*\d+[\.,]?\d*\s*(m²|m³|lfm|lm|Stk\.?|stk|qm)(?=\W|$)/gi, '')
    .replace(/\b\d+[\.,]?\d*\s*(m²|m³|lfm|lm|Stk\.?|stk|qm)(?=\W|$)/gi, '')
    .replace(/\bca\.?\s*\d+\s*m\b/gi, '')
    .replace(/\b\d+\s*m\b(?!\s*[0-9])/gi, '')
    .replace(/\b\d+\s*x\b/gi, '')
    .replace(/^(Zusatzarbeiten?:?\s*|Zus\.\s*)/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.()+/]+|[\s,;:.()+/]+$/g, '')
    .trim();
}

// ── SON → richtige LV-Kategorie ──────────────────────────────────────────────
const SON_RULES = [
  ['UMZ', ['umzug', 'umzugshelfer', 'auf- abbau', 'abbau auf', 'auf und ab']],
  ['ERD', [
    'rohr', 'schacht', 'fundament', 'beton', 'stemm', 'drainage', 'noppenbahn',
    'schalungsstein', 'abwasser', 'verrohrung', 'fallrohr', 'kellerschacht',
    'suchschacht', 'rohrverstopf', 'hofablauf', 'einspulen', 'rohrgraben',
    'pumparbeit', 'l steine', 'l borte', 'punktfundament', 'regenwasser',
    'abwasserschacht', 'stufe', 'hochbeet', 'auskoffern', 'auskoffert',
    'parkplatz herstellen', 'flache einebnen',
  ]],
  ['GTN', [
    'mah', 'dachrinnen', 'wildkraut', 'rasen', 'einsah', 'bepflanzung',
    'efeu', 'grunflach', 'aufraum', 'borte setzen', 'borte setzen und richten',
  ]],
  ['ZAU', [
    'carport', 'uberdach', 'pavillon', 'windfeder', 'blechdach',
    'holzunterkonstruktion', 'pfosten ab', 'dach eingedeckt',
  ]],
  ['VWG', [
    'mehrarbeit', 'planung erstell', 'handwerkerkosten', 'montagekosten',
    'wartezeit', 'arbeitszeit', 'arbeitzeit', 'abgesprochene',
    'verbrauchsmaterial', 'arbeitsbuhne', 'nassschneider', 'lkw',
    'baustelle einrichten',
  ]],
];

function remapSON(label) {
  const key = foldKey(label);
  for (const [cat, kws] of SON_RULES) {
    if (kws.some(kw => key.includes(kw))) return cat;
  }
  return 'SON';
}

// ── Ausschlussliste: keine echten Positionen ─────────────────────────────────
const EXCLUDE_KEYS = new Set([
  // sevDesk-Memo ("Die Rechnung ist wie folgt aufzuteilen...")
  'vwg|die rechnung ist wie folgt aufzuteilen',
]);
function shouldExclude(cat, label) {
  const k = `${cat.toLowerCase()}|${foldKey(label).slice(0, 40)}`;
  for (const ex of EXCLUDE_KEYS) {
    if (k.startsWith(ex)) return true;
  }
  if (label.length > 250) return true; // Memos
  return false;
}

// ── ALIAS-MAP (FROM → TO, beide in foldKey-Normalform) ──────────────────────
// Format: [from-key, to-key]  (cat|normalized-label)
const ALIASES = [
  // ── PFL: Pflastern-Varianten ────────────────────────────────────────────
  ['pfl|pflasterarbeiten',          'pfl|pflastern'],
  ['pfl|pflasterung herstellen',    'pfl|pflastern'],
  ['pfl|pflasterung erstellen',     'pfl|pflastern'],
  ['pfl|pflastern neu',             'pfl|pflastern'],
  ['pfl|platten legen',             'pfl|pflastern'],
  ['pfl|platten pflastern',         'pfl|pflastern'],
  ['pfl|plattenpflasterung erstellen','pfl|pflastern'],
  ['pfl|plattenpflasterung herstellen','pfl|pflastern'],
  ['pfl|pflasterarbeiten auffahrt', 'pfl|pflastern'],
  ['pfl|pflasterarbeiten garten',   'pfl|pflastern'],
  ['pfl|pflasterarbeiten auffahrt', 'pfl|pflastern'],
  ['pfl|auffahrt anpflastern schneiden rutteln','pfl|pflastern'],
  ['pfl|pflasterung aufnehmen und ruckbau','pfl|pflastersteine aufnehmen'],
  ['pfl|pflasterung aufnehmen',     'pfl|pflastersteine aufnehmen'],
  ['pfl|terrasse zuruckgebaut',     'pfl|pflastersteine aufnehmen'],
  ['pfl|zuwegung aufgenommen und neu gepflastert','pfl|pflastern'],
  ['pfl|pflasterung wiederherstellen','pfl|pflastern'],
  ['pfl|pflaster aufnehmen und subern','pfl|pflastersteine aufnehmen'],
  ['pfl|weg hinter garage und neben grunflache neu gepflastert neu gepflastert','pfl|pflastern'],
  ['pfl|neu pflastern hinterm haus','pfl|pflastern'],
  ['pfl|pflasterarbeiten ca',       'pfl|pflastern'],
  ['pfl|pflaster und schneidarbeiten','pfl|pflastern'],
  ['pfl|pflaster schneidarbeiten',  'pfl|pflastern'],
  // PFL: Borde/Randsteine
  ['pfl|randsteine setzen in beton','pfl|borde setzen in beton'],
  ['pfl|randsteine setzen',         'pfl|borde setzen in beton'],
  ['pfl|bord setzen',               'pfl|borde setzen in beton'],
  ['pfl|bordsteine setzen in beton','pfl|borde setzen in beton'],
  ['pfl|rasenbord setzen',          'pfl|borde setzen in beton'],
  ['pfl|rasenbord in beton gesetzt','pfl|borde setzen in beton'],
  ['pfl|borte setzen in beton',     'pfl|borde setzen in beton'],
  ['pfl|rasenbort setzen in beton', 'pfl|borde setzen in beton'],
  ['pfl|rasenbord setzen ca',       'pfl|borde setzen in beton'],
  ['pfl|randsteine ausbauen',       'pfl|bordsteine entfernen'],
  // PFL: Rütteln-Varianten
  ['pfl|schneiden rutteln und einschlammen','pfl|rutteln schneiden und einschlammen'],
  ['pfl|rutteln schneiden und einschlammen','pfl|rutteln schneiden und einschlammen'],
  ['pfl|abrutteln schneiden und einschlammen','pfl|rutteln schneiden und einschlammen'],
  ['pfl|rutteln und einschlammen',  'pfl|rutteln schneiden und einschlammen'],
  ['pfl|rutteln und einschlammarbeiten','pfl|rutteln schneiden und einschlammen'],
  // PFL: Terrasse
  ['pfl|terrassenplatten verlegen', 'pfl|terrassenplatten einbauen'],
  ['pfl|terrassenplatten aufnehmen','pfl|demontage terrasse'],

  // ── ERD: Bagger ─────────────────────────────────────────────────────────
  ['erd|baggerarbeiten',            'erd|bagger und radladerarbeiten'],
  ['erd|auffahrt ausbaggern',       'erd|bagger und radladerarbeiten'],
  ['erd|zusatzarbeiten baggerarbeit','erd|bagger und radladerarbeiten'],
  ['erd|betonplatten ausbaggern',   'erd|bagger und radladerarbeiten'],
  ['erd|beet ausbaggern und fur pflasterflache vorbereiten','erd|bagger und radladerarbeiten'],
  ['erd|heckenwurzeln ausbaggarn',  'erd|bagger und radladerarbeiten'],
  // ERD: Brechsand/Schotter
  ['erd|brechsand einbauen und verdichten','erd|brechsand verteilen und verdichten'],
  ['erd|brechsand verteilen verdichten und planieren','erd|brechsand verteilen und verdichten'],
  ['erd|rc brechsand verteilen und verdichten','erd|brechsand verteilen und verdichten'],
  ['erd|granitbrechsand einbauen und verdichten','erd|brechsand verteilen und verdichten'],
  ['erd|grobschotter verteilen verdichten und planieren','erd|brechsand verteilen und verdichten'],
  ['erd|brechsand einbauen',        'erd|brechsand verteilen und verdichten'],
  ['erd|brechsand einbauen u planieren','erd|brechsand verteilen und verdichten'],
  ['erd|rc schotter verteilen und verdichten','erd|schotter verteilen und verdichten'],
  ['erd|rc schotter einbauen und verdichten','erd|schotter verteilen und verdichten'],
  ['erd|schotter einbauen und verdichten','erd|schotter verteilen und verdichten'],
  ['erd|grobschotter einbauen',     'erd|schotter verteilen und verdichten'],
  ['erd|reinkies eingebaut',        'erd|schotter verteilen und verdichten'],
  // ERD: Füllsand/Mutterboden
  ['erd|fullsand einbauen und verdichten','erd|fullsand verteilen und verdichten'],
  ['erd|fullsand einbauen',         'erd|fullsand verteilen und verdichten'],
  ['erd|fullmaterial einbauen verdichten und nivillieren','erd|fullsand verteilen und verdichten'],
  ['erd|mutterboden verteilen',     'erd|mutterboden einbauen'],
  ['erd|mutterboden planiert',      'erd|mutterboden einbauen'],
  ['erd|mutterboden und schotter verteilt','erd|mutterboden einbauen'],
  ['erd|mutterboden anfüllen',      'erd|mutterboden einbauen'],
  ['erd|mutterboden auffullen',     'erd|mutterboden einbauen'],
  // ERD: Verdichten
  ['erd|verdichten und planieren',  'erd|verdichten'],
  ['erd|weg verdichtet und wiederhergestellt','erd|verdichten'],
  ['erd|rohrgraben verdichtet',     'erd|verdichten'],
  // ERD: Entsorgung
  ['erd|entsorgung bodenaushub',    'erd|entsorgung'],
  ['erd|entsorgungskosten',         'erd|entsorgung'],
  ['erd|entsorgung boden',          'erd|entsorgung'],
  ['erd|zus sand entsorgen',        'erd|entsorgung'],
  ['erd|entsorgung von defekten rohren','erd|entsorgung'],
  ['erd|entsorgung altsteine',      'erd|entsorgung'],
  ['erd|bauschutt entsorgung',      'erd|entsorgung bauschutt'],
  ['erd|entsorgung bauschutt aus container','erd|entsorgung bauschutt'],
  ['erd|entsorgung holz und ubrige materialien','erd|entsorgung bauschutt'],
  ['erd|entsorgung holz und mull',  'erd|entsorgung bauschutt'],
  ['erd|entsorgungskosten betonfundamente mit stahleinlage','erd|entsorgung betonfundamente'],
  // ERD: Drainage / Aco Drain
  ['erd|drainage erstellen',        'erd|drainage herstellen'],
  ['erd|drainage erstellt',         'erd|drainage herstellen'],
  ['erd|entwasserung herstellen in kg rohr ablauf','erd|drainage herstellen'],
  ['erd|hofentwasserung eingebaut', 'erd|drainage herstellen'],
  ['erd|drainage herstellen',       'erd|drainage herstellen'],
  ['erd|aco drain rinne in beton setzen und anschliessen','erd|aco drain rinne einbauen'],
  ['erd|aco drain rinne anlegen',   'erd|aco drain rinne einbauen'],
  ['erd|aco drain rinne setzen in beton','erd|aco drain rinne einbauen'],
  ['erd|anschluss fur aco drain erstellen','erd|aco drain rinne einbauen'],
  // ERD: Suchschachtung
  ['erd|suchschachtung fur rohre',  'erd|suchschachtung'],
  ['erd|rohrverstopfung lokalisiert','erd|suchschachtung'],
  // ERD: Grabaushub zusammenführen
  ['erd|grabaushub mitarbeiter 2',  'erd|grabaushub'],
  ['erd|grabaushub 2mitarbeiter',   'erd|grabaushub'],
  ['erd|grabaushub  mitarbeiter',   'erd|grabaushub'],
  // ERD: Rohre
  ['erd|rohre verlegen',            'erd|rohre einbauen'],
  ['erd|rohre eingebaut incl spultest','erd|rohre einbauen'],
  ['erd|rohre eingebaut',           'erd|rohre einbauen'],
  ['erd|rohre ausgebaut',           'erd|rohre einbauen'],
  ['erd|rohre umgelegt',            'erd|rohre einbauen'],
  ['erd|rohre verlegen f aco drain und dachrinne','erd|rohre einbauen'],
  ['erd|verrohrung einbauen und ablaufe setzen','erd|rohre einbauen'],
  ['erd|rohre ausgerichtet und angeschlossen','erd|rohre einbauen'],
  // ERD: Kabel
  ['erd|kabelverlegungsarbeiten',   'erd|kabelverlegearbeiten'],
  // ERD: Fundamente
  ['erd|fundament herstellen',      'erd|fundamente herstellen'],
  ['erd|fundamente fur pavillon erstellen','erd|fundamente herstellen'],
  ['erd|punktfundamente setzen',    'erd|fundamente herstellen'],
  ['erd|schalungssteine setzen',    'erd|fundamente herstellen'],
  ['erd|einbauen von beton und bewahhrungsstahl','erd|fundamente herstellen'],
  // ERD: Betonfundamente entfernen
  ['erd|betonfundamente entfernen', 'erd|beton entfernen'],
  ['erd|beton entfernen grenzuberbauung','erd|beton entfernen'],
  ['erd|abbruch der rollschicht',   'erd|beton entfernen'],
  // ERD: Frachtkosten
  ['erd|frachtkosten fremd lkw',    'erd|frachtkosten'],
  ['erd|frachtkosten fremd-lkw',    'erd|frachtkosten'],
  // ERD: Vlies
  ['erd|vlies eingebaut',           'erd|vlies verlegen'],

  // ── GTN ─────────────────────────────────────────────────────────────────
  ['gtn|entsorgung grunabfall',     'gtn|grunabfall entsorgung'],
  ['gtn|grunabfall',                'gtn|grunabfall entsorgung'],
  ['gtn|grunabfallentsorgung',      'gtn|grunabfall entsorgung'],
  ['gtn|entsorgung schnitt und sand','gtn|grunabfall entsorgung'],
  // GTN: Jahresrückschnitt
  ['gtn|jahresruckschnitt hecken busche kl baume','gtn|gartenruckschnitt'],
  ['gtn|gartenjahresruckschnitt',   'gtn|gartenruckschnitt'],
  ['gtn|ruckschnitt und gartenpflege','gtn|gartenruckschnitt'],
  ['gtn|gartenruckschnitt fallarbeiten incl entsorgung','gtn|gartenruckschnitt'],
  ['gtn|jahrlicher gartenruckschnitt incl entsorgung','gtn|gartenruckschnitt'],
  ['gtn|gartenpflegearbeiten incl grunabfallentsorgung baggerarbeiten und baumwurzelfrasen','gtn|gartenruckschnitt'],
  ['gtn|bepflanzung zuruckschneiden','gtn|gartenruckschnitt'],
  // GTN: Rasen
  ['gtn|rasenflache angleichen',    'gtn|rasenflache einebnen und ansahen'],
  ['gtn|rasensamen einsahen',       'gtn|rasenflache einebnen und ansahen'],
  ['gtn|rasenflache durchpflugen und einebnen','gtn|rasenflache einebnen und ansahen'],
  ['gtn|abgeharkt rasen angesaht',  'gtn|rasenflache einebnen und ansahen'],
  ['gtn|rasen absahen einharken und ggf abwalzen','gtn|rasenflache einebnen und ansahen'],
  ['gtn|ansahen',                   'gtn|rasenflache einebnen und ansahen'],
  ['gtn|befüllen und ansahen',      'gtn|rasenflache einebnen und ansahen'],
  ['gtn|einspulen und ansahen',     'gtn|rasenflache einebnen und ansahen'],
  // GTN: Bäume
  ['gtn|baumfallarbeiten',          'gtn|baumschnitt und fallarbeiten'],
  ['gtn|baumschnitt',               'gtn|baumschnitt und fallarbeiten'],
  ['gtn|baumschneidearbeiten',      'gtn|baumschnitt und fallarbeiten'],
  ['gtn|baumfall und frasarbeiten', 'gtn|baumschnitt und fallarbeiten'],
  ['gtn|baum hinter garage gefällt','gtn|baumschnitt und fallarbeiten'],
  ['gtn|baume gefällt',             'gtn|baumschnitt und fallarbeiten'],
  // GTN: Wurzeln
  ['gtn|baumwurzelfrasen',          'gtn|baumwurzeln entfernen'],
  ['gtn|baumwurzel ausgebaggert',   'gtn|baumwurzeln entfernen'],
  ['gtn|wurzelentsorgung',          'gtn|baumwurzeln entfernen'],
  ['gtn|baumwurzel entsorgung',     'gtn|baumwurzeln entfernen'],
  ['gtn|wurzeln entsorgen',         'gtn|baumwurzeln entfernen'],
  ['gtn|heckenwurzeln ausbaggern',  'gtn|baumwurzeln entfernen'],
  // GTN: Hecke
  ['gtn|zusatz arbeiten hecke entfernen','gtn|hecke entfernen'],
  ['gtn|hecken entfernung',         'gtn|hecke entfernen'],
  ['gtn|hecke entfernen inkl entsorgung','gtn|hecke entfernen'],
  // GTN: Dachrinne
  ['gtn|dachrinnenreinigung 2 mitarbeiter','gtn|dachrinnenreinigung'],
  ['gtn|dachrinnen geraumt und repariert','gtn|dachrinnenreinigung'],
  // GTN: Gartenarbeiten allg.
  ['gtn|gartenarbeiten bestehend aus pflanzen umgepflanzt und telweise entfernt unkraut entfernt bauschutt und grunabfall aufgeladen und abgefahren','gtn|gartenarbeiten'],
  // GTN: Rindenmulch
  ['gtn|verteilen von rindenmulch', 'gtn|rindenmulch verteilen'],
  ['gtn|rindenmulch verteilen blatter entfernen und vlies auslegen','gtn|rindenmulch verteilen'],
  ['gtn|graben befestigt und rindenmulch verteilt','gtn|rindenmulch verteilen'],

  // ── ZAU ─────────────────────────────────────────────────────────────────
  ['zau|doppelstabmattenzaun aufstellen','zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaunmontage',               'zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaun aufbauen',             'zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaun aufstellen',           'zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaunelemente aufsetzen',    'zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaunelemente eingebaut',    'zau|doppelstabmattenzaun aufbauen'],
  ['zau|montage neuer zaun',        'zau|doppelstabmattenzaun aufbauen'],
  ['zau|zaun aufbauen und ausrichten','zau|doppelstabmattenzaun aufbauen'],
  // ZAU: Pfosten
  ['zau|pfosten betonieren',        'zau|zaunpfosten betonieren'],
  ['zau|h pfostentrager betonieren','zau|zaunpfosten betonieren'],
  ['zau|zaunfundamente setzen',     'zau|zaunpfosten betonieren'],
  ['zau|zaunfundamente herstellen', 'zau|zaunpfosten betonieren'],
  ['zau|boden verdichten und locher bohren fur zaun','zau|zaunpfosten betonieren'],
  ['zau|boden verdichten und locher fur pfosten erstellen','zau|zaunpfosten betonieren'],
  ['zau|zaunpfosten in beton setzen','zau|zaunpfosten betonieren'],
  ['zau|pfosten betonieren zaun aufstellen','zau|zaunpfosten betonieren'],
  ['zau|fundamente erstellen und nivillieren fur zaunpfosten inclusive verschrauben','zau|zaunpfosten betonieren'],
  // ZAU: Rückbau
  ['zau|doppelstabmattenzaun zuruckbauen','zau|zaun zuruckgebaut'],
  ['zau|zaun demontage',            'zau|zaun zuruckgebaut'],
  // ZAU: Sichtschutz
  ['zau|sichtschutzstreifen einfadeln','zau|einfadeln von sichtschutzstreifen'],
  ['zau|sichtschutz eingefadelt',   'zau|einfadeln von sichtschutzstreifen'],
  ['zau|sichtschutz streifen einfadeln','zau|einfadeln von sichtschutzstreifen'],
  ['zau|sichtschutz einfadeln',     'zau|einfadeln von sichtschutzstreifen'],

  // ── VWG ─────────────────────────────────────────────────────────────────
  ['vwg|anfahrpauschale',           'vwg|anfahrtspauschale'],
  ['vwg|anfahrtspauschale 50',      'vwg|anfahrtspauschale'],
  ['vwg|anfahrtpauschale',          'vwg|anfahrtspauschale'],
  ['vwg|anfahrtspauschale bunde',   'vwg|anfahrtspauschale'],
  ['vwg|anfahrtspauschale  50km',   'vwg|anfahrtspauschale'],
  ['vwg|transportpauschale f fertigbeton','vwg|transportpauschale fertigbeton'],
  ['vwg|transportpauschale fur beton','vwg|transportpauschale fertigbeton'],
  ['vwg|transportpauschale f transportbeton','vwg|transportpauschale fertigbeton'],
  ['vwg|transportpauschale f fertigbeton und sand','vwg|transportpauschale fertigbeton'],
  ['vwg|lieferpauschale f fertigbeton','vwg|transportpauschale fertigbeton'],
  ['vwg|logistikpauschale',         'vwg|transportpauschale fertigbeton'],
  ['vwg|logistikpauschale hesse',   'vwg|transportpauschale fertigbeton'],
  ['vwg|transportpauschale beton',  'vwg|transportpauschale fertigbeton'],
  ['vwg|transportpauschale fur sand','vwg|transportpauschale brechsand sand'],
  ['vwg|transportpauschale fur brechsand','vwg|transportpauschale brechsand sand'],
  ['vwg|baggergeratenutzung',       'vwg|leihgebühr microbagger'],
  ['vwg|leihgebühr radlader',       'vwg|leihgebühr microbagger'],
  ['vwg|leihgebühr microbagger',    'vwg|leihgebühr microbagger'],
  ['vwg|erdbohrer einsatz',         'vwg|einsatz motorerdbohrer'],
  ['vwg|arbeitslohn fur mehraufwand umplanung','vwg|arbeitslohn'],
  ['vwg|arbeitslohn fur stemm nivillier und bodenverlegearbeiten','vwg|arbeitslohn'],
  ['vwg|arbeitzeit',                'vwg|arbeitslohn'],
  ['vwg|mehrarbeit durch kartons abspr a dressman','vwg|mehrarbeit'],
  ['vwg|mehrarbeiten durch kartons abspr andy dressman','vwg|mehrarbeit'],
  ['vwg|abgesprochene mehrarbeit',  'vwg|mehrarbeit'],
  ['vwg|mehrarbeit gehweg richten und wiederherstellen','vwg|mehrarbeit'],
  ['vwg|mehrarbeit boden auskoffern','vwg|mehrarbeit'],
  ['vwg|leihgebühr radlader',       'vwg|leihgebühr microbagger'],
  // VWG: Transport
  ['vwg|frachtpauschale ab werk',   'vwg|frachtpauschale'],
  ['vwg|kijlstra frachtpauschale ab werk','vwg|frachtpauschale'],
  ['vwg|transportpauschale',        'vwg|frachtpauschale'],
  ['vwg|transportpauschale wertstoffhof','vwg|frachtpauschale'],
  ['vwg|augustin gestellungspauschale abrollfahrzeug','vwg|frachtpauschale'],

  // ── UMZ ─────────────────────────────────────────────────────────────────
  ['umz|umzug von nach',            'umz|umzug'],
  ['umz|umzug bochum umzugshelfer auf abbau','umz|umzug'],
  ['umz|umzug 5pers incl umzugshelfer lkw diesel maut','umz|umzug'],
  ['umz|umzug incl lkw fahrer und umzugshelfer','umz|umzug'],
  ['umz|umzug incl umzugshelfer auf und ab bau','umz|umzug'],
  ['umz|umzug 2 fahrer lkw inkl diesel','umz|umzug'],
  ['umz|umzug 3 umzugshelfer lkw inkusiv diesel','umz|umzug'],
  ['umz|umzug 3 umzugshelfer',      'umz|umzug'],
  ['umz|umzug 2 umzugshelfer',      'umz|umzug'],
  ['umz|lkw inkl diesel und fahrer umzugshelfer','umz|umzug'],

  // ── SON ─────────────────────────────────────────────────────────────────
  ['son|borte setzen',              'son|borte setzen und richten'],
  ['son|borte setzen ca',           'son|borte setzen und richten'],
  ['son|borte setzen und richten',  'son|borte setzen und richten'],
  ['son|ausbesserungsarbeiten',     'son|ausbesserungsarbeiten innenhof'],
  ['son|stufe entfernen',           'son|stufe arbeiten'],
  ['son|stufe entfernt',            'son|stufe arbeiten'],
  ['son|stufe herstellen mauern od kleben','son|stufe arbeiten'],
  ['son|stufe erstellen in beton',  'son|stufe arbeiten'],
  ['son|stufe abbrechen und neu verkleben','son|stufe arbeiten'],
  ['son|stufe neu verfugen',        'son|stufe arbeiten'],
];

const ALIAS_LOOKUP = new Map(ALIASES.map(([f, t]) => [f, t]));

function resolveAlias(key) {
  // Mehrfach auflösen (transitive Alias-Ketten)
  let resolved = key;
  for (let i = 0; i < 5; i++) {
    const next = ALIAS_LOOKUP.get(resolved);
    if (!next || next === resolved) break;
    resolved = next;
  }
  return resolved;
}

// ── POSITIONEN aus HTML ──────────────────────────────────────────────────────
const html  = readFileSync(HTML, 'utf8');
const m     = 'const POSITIONEN = ';
const start = html.indexOf(m) + m.length;
let depth = 0, end = start;
for (let i = start; i < html.length; i++) {
  const c = html[i];
  if (c === '[' || c === '{') depth++;
  else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const all    = JSON.parse(html.slice(start, end));
const arbeit = all.filter(p => p.isArbeit);
console.log(`Arbeit-Positionen: ${arbeit.length}`);

// ── Clustering ───────────────────────────────────────────────────────────────
const clusters = new Map();

for (const p of arbeit) {
  const cat = (p.cat === 'SON') ? remapSON(p.label) : p.cat;
  if (shouldExclude(cat, p.label)) continue;

  const stripped = stripQty(p.label);
  const rawKey   = resolveAlias(`${cat.toLowerCase()}|${foldKey(stripped)}`);

  if (!clusters.has(rawKey)) {
    clusters.set(rawKey, { key: rawKey, cat: rawKey.split('|')[0].toUpperCase(),
      names: [], prices: [], units: [], totalN: 0 });
  }
  const cl = clusters.get(rawKey);
  cl.names.push({ label: p.label, n: p.anzahlRechnungen });
  if (p.preisZuletzt && p.preisZuletzt > 0 && p.preisZuletzt < 5000) {
    cl.prices.push(p.preisZuletzt);
  }
  if (p.einheitHaeufig) cl.units.push(p.einheitHaeufig);
  cl.totalN += p.anzahlRechnungen;
}

// Statistiken berechnen
for (const cl of clusters.values()) {
  cl.names.sort((a, b) => b.n - a.n);
  // Kanonischer Name = häufigstes Label, Qty und Zusatz-Prefix entfernt
  cl.canonical = stripQty(cl.names[0].label);

  const prices = cl.prices;
  if (prices.length > 0) {
    cl.priceMin  = Math.round(Math.min(...prices) * 100) / 100;
    cl.priceMax  = Math.round(Math.max(...prices) * 100) / 100;
    cl.price     = prices[prices.length - 1];
  } else {
    cl.priceMin = null; cl.priceMax = null; cl.price = null;
  }

  const uc = {};
  for (const u of cl.units) uc[u] = (uc[u] || 0) + 1;
  const tu = Object.entries(uc).sort((a, b) => b[1] - a[1])[0];
  cl.unit = tu ? tu[0] : null;
}

// ── Sortieren + IDs vergeben ─────────────────────────────────────────────────
// ERR wird NICHT importiert (bestehende ERR-001…ERR-011 bleiben unberührt)
// Neue Positionen starten bei 100 (Slots 001–099 = manuell kuratiert)
// UMZ / SON sind neue Kategorien, starten bei 001
const CAT_ORDER   = ['ERD', 'PFL', 'GTN', 'ZAU', 'VWG', 'UMZ', 'SON', 'ERR'];
const CAT_OFFSET  = { ERD: 99, PFL: 99, GTN: 99, ZAU: 99, VWG: 99, UMZ: 0, SON: 0 };
const SKIP_CAT    = new Set(['ERR']);

const sorted = [...clusters.values()]
  .filter(cl => !SKIP_CAT.has(cl.cat))
  .sort((a, b) => {
    const ci = CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat);
    return ci !== 0 ? ci : b.totalN - a.totalN;
  });

const cc = {};
for (const cl of sorted) {
  if (!cc[cl.cat]) cc[cl.cat] = CAT_OFFSET[cl.cat] ?? 0;
  cc[cl.cat]++;
  cl.id = `${cl.cat}-${String(cc[cl.cat]).padStart(3, '0')}`;
}

// ── Bericht ──────────────────────────────────────────────────────────────────
const CAT_LABELS = {
  ERD:'Erdarbeiten', PFL:'Pflasterarbeiten', GTN:'Gartenarbeiten',
  ZAU:'Zaunarbeiten', VWG:'Verwaltung', UMZ:'Umzug', SON:'Sonstige', ERR:'Zulagen',
};

let report = `LV-Seed-Report v2  ${new Date().toLocaleDateString('de-DE')}\n${'='.repeat(70)}\n`;
report += `Arbeit-Positionen gesamt:  ${arbeit.length}\n`;
report += `LV-Einträge (Cluster):     ${sorted.length}\n\n`;

const byCat = {};
for (const cl of sorted) { (byCat[cl.cat] ??= []).push(cl); }

for (const cat of CAT_ORDER) {
  const list = byCat[cat];
  if (!list) continue;
  report += `\n── ${cat} · ${CAT_LABELS[cat]} (${list.length}) ${'─'.repeat(35)}\n`;
  for (const cl of list) {
    const pr = cl.priceMin === null ? '–' :
      cl.priceMin === cl.priceMax ? `${cl.priceMin} €` : `${cl.priceMin}–${cl.priceMax} €`;
    report += `  ${cl.id.padEnd(8)} ${String(cl.totalN).padStart(3)}x  ${(pr + (cl.unit ? '/'+cl.unit : '')).padEnd(18)}  ${cl.canonical}\n`;
    if (cl.names.length > 1) {
      const rest = cl.names.slice(1, 4).map(x => `${x.n}x "${x.label}"`).join(' · ');
      const extra = cl.names.length > 4 ? ` … +${cl.names.length - 4}` : '';
      report += `           └ ${rest}${extra}\n`;
    }
  }
}

writeFileSync(REP, report, 'utf8');

// ── SQL ───────────────────────────────────────────────────────────────────────
const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const num = v => v == null ? 'NULL' : String(v);

let sql = `-- LV-Seed v2  Leuschner · ${new Date().toLocaleDateString('de-DE')}
-- ${arbeit.length} Arbeitspositionen → ${sorted.length} Cluster
-- Neue Spalten price_min / price_max + Kategorien UMZ / SON
--
ALTER TABLE lv_positions
  ADD COLUMN IF NOT EXISTS price_min NUMERIC,
  ADD COLUMN IF NOT EXISTS price_max NUMERIC;

DO $$
DECLARE cid UUID;
BEGIN
  SELECT id INTO cid FROM companies ORDER BY created_at LIMIT 1;
  INSERT INTO lv_positions
    (id, company_id, cat, name, price, price_min, price_max, unit, short_text, long_text, zulagen)
  VALUES\n`;

sql += sorted.map(cl =>
  `    (${esc(cl.id)}, cid, ${esc(cl.cat)}, ${esc(cl.canonical)}, ` +
  `${num(cl.price)}, ${num(cl.priceMin)}, ${num(cl.priceMax)}, ` +
  `${esc(cl.unit)}, NULL, NULL, '{}')`
).join(',\n');

sql += `\n  ON CONFLICT (id) DO NOTHING;\nEND $$;\n\nSELECT cat, count(*) FROM lv_positions WHERE archived_at IS NULL GROUP BY cat ORDER BY cat;\n`;

writeFileSync(SQL, sql, 'utf8');

// Konsolen-Zusammenfassung
console.log('\n' + '═'.repeat(55));
for (const cat of CAT_ORDER) {
  const list = byCat[cat];
  if (!list) continue;
  console.log(`  ${cat.padEnd(4)} ${CAT_LABELS[cat].padEnd(20)} ${list.length}`);
}
console.log('─'.repeat(55));
console.log(`  GESAMT                       ${sorted.length} Einträge`);
console.log(`\n  Report: scripts/lv-seed-report.txt`);
console.log(`  SQL:    scripts/lv-seed.sql`);
