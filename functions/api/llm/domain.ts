// Domain-Glossar für den Strukturierungs-Parser (Sprint-3-M7, 26.05.2026)
//
// Kleine LLMs (auch 70B) machen Fehler bei ortsspezifischen Begriffen, die
// im allgemeinen Trainings-Korpus selten vorkommen — ostfriesische Dörfer,
// Hesse-Produktbezeichnungen, regionale Einheiten-Schreibweisen. Diese
// Hilfslisten geben dem Modell im Prompt einen kurzen Anker.
//
// Pflegeregel: liste lieber knapp und korrekt als lang und schwammig. Das
// LLM zieht sich aus der Liste die richtige Schreibweise — wir wollen keine
// Roman-Liste, sondern die ~30 wichtigsten Begriffe je Kategorie.

/** Ortsnamen aus dem Einzugsgebiet (Leer/Weener/Bunde/Papenburg-Umfeld).
 *  Hilft dem Modell beim Erkennen von Stadt-Strings und beim Auflösen von
 *  Tippfehlern („Bumde" → Bunde). */
export const ORTE_OSTFRIESLAND = [
  // Landkreis Leer
  'Leer', 'Weener', 'Bunde', 'Jemgum', 'Ihrhove', 'Westoverledingen', 'Rhauderfehn',
  'Hesel', 'Brinkum', 'Detern', 'Filsum', 'Holtland', 'Moormerland', 'Uplengen',
  'Ostrhauderfehn', 'Stickhausen',
  // Landkreis Aurich
  'Aurich', 'Norden', 'Norddeich', 'Hage', 'Dornum', 'Großefehn', 'Hinte',
  'Krummhörn', 'Pewsum', 'Wirdum', 'Wiesmoor', 'Marienhafe', 'Südbrookmerland',
  'Ihlow', 'Greetsiel',
  // Landkreis Wittmund
  'Wittmund', 'Esens', 'Friedeburg', 'Holtgast', 'Neuharlingersiel', 'Werdum',
  // Stadt Emden
  'Emden', 'Larrelt', 'Petkum', 'Borssum', 'Wolthusen',
  // Landkreis Friesland (angrenzend)
  'Jever', 'Schortens', 'Sande', 'Zetel',
  // Landkreis Emsland (Papenburg, Rhede)
  'Papenburg', 'Tunxdorf', 'Aschendorf', 'Rhede', 'Dörpen', 'Lathen', 'Heede',
];

/** Typische Leistungen im GaLaBau-Mix von Leuschner. Hilft dem Modell,
 *  Synonyme auf den Standard-Begriff zu mappen. */
export const LEISTUNGEN = [
  'Doppelstabmattenzaun', 'Doppelstabzaun', 'Stabgitterzaun', 'Sichtschutzzaun',
  'Maschendrahtzaun', 'Holzzaun', 'Drehflügeltor', 'Schiebetor', 'Gartentor',
  'Pflasterarbeiten', 'Hofeinfahrt', 'Terrasse', 'Wegebau', 'Plattenweg',
  'Erdarbeiten', 'Baggerarbeiten', 'Mutterboden-Abtrag', 'Mutterboden-Lieferung',
  'Drainage', 'Entwässerung', 'Regenwasserrinne',
  'Rasen anlegen', 'Rollrasen', 'Rasensaat',
  'Gartenmauer', 'Rasenbord', 'Palisaden', 'Mauerarbeiten',
  'Kies-/Splittflächen', 'Beetanlage',
];

/** Hesse-Produktnamen + Kürzel, die in Kunden-Anfragen vorkommen können. */
export const HESSE_PRODUKTE = [
  'Doppelstabmatte', 'DSM', '8/6/8', '6/5/6',
  'Pfosten 60×40', 'Pfosten 60×60', 'Pfosten 80×80',
  'anthrazit', 'RAL 7016', 'verzinkt', 'feuerverzinkt',
];

/** Mengen-Einheiten und ihre Standard-Form (Modell soll auf die rechte
 *  Seite normalisieren). */
export const EINHEITEN_ALIAS: Record<string, string> = {
  'qm': 'm²', 'm2': 'm²',
  'cbm': 'm³', 'm3': 'm³', 'kubik': 'm³', 'kubikmeter': 'm³',
  'lfm': 'lfm', 'laufender meter': 'lfm', 'laufende meter': 'lfm', 'lm': 'lfm',
  'stk': 'Stk', 'stück': 'Stk', 'stueck': 'Stk',
  'std': 'Std', 'stunde': 'Std', 'stunden': 'Std', 'h': 'Std',
};

/** Kompakter Glossar-Block fürs LLM. Nicht zu lang — Token-Budget knapp halten. */
export function buildDomainHint(): string {
  return `Domain-Glossar (zur Orientierung, NICHT zwingend zu erwähnen):
- Orte im Einzugsgebiet: ${ORTE_OSTFRIESLAND.slice(0, 30).join(', ')}, ... (weitere ostfriesische Dörfer möglich)
- Typische Leistungen: ${LEISTUNGEN.slice(0, 20).join(', ')}
- Hesse-Bezeichnungen: ${HESSE_PRODUKTE.join(', ')}
- Einheiten-Normalisierung: qm→m², cbm/kubik→m³, lfm/laufender Meter→lfm, Stk/Stück→Stk, Std/Stunde→Std

Hinweise:
- Bei mehrteiligen Anfragen (z.B. "Zaun + Pflaster + Drainage") führe ALLE Gewerke separat in leistungen[] auf.
- Bei Tippfehlern in Orten: korrigiere auf den nächstgelegenen aus der Liste (z.B. "Bumde" → "Bunde").
- Einheiten in der Ausgabe IMMER in der Standardform (m², m³, lfm, Stk, Std).`;
}
