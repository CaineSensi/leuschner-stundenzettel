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

/** KANONISCHE Gewerke — der Modell-`name` jeder Leistung MUSS exakt einer
 *  dieser Bezeichnungen sein. Das hält die Aufschlüsselung über alle Anfragen
 *  hinweg konsistent (kein Mal "Terrasse anlegen", mal "Pflasterarbeiten" fürs
 *  selbe Gewerk). Jede Zeile: kanonischer Name → was alles darunter fällt. */
export const GEWERKE: { name: string; faellt_darunter: string }[] = [
  { name: 'Pflasterarbeiten', faellt_darunter: 'Hofeinfahrt/Auffahrt/Wege/Flächen pflastern, Pflaster ausbessern, Randsteine' },
  { name: 'Terrassenbau',     faellt_darunter: 'Terrasse aus Naturstein/Platten/Pflaster, Terrassenunterbau' },
  { name: 'Zaunbau',          faellt_darunter: 'Zäune aller Art INKL. Tore, Pfosten, Sichtschutz montieren' },
  { name: 'Erdarbeiten',      faellt_darunter: 'Aushub, Bagger-/Fräsarbeiten, Planieren, Boden abtragen/auffüllen' },
  { name: 'Drainage',         faellt_darunter: 'Drainage, Entwässerung, Regenwasserrinne, Versickerung' },
  { name: 'Rasen anlegen',    faellt_darunter: 'Rollrasen, Rasensaat, Rasenfläche neu' },
  { name: 'Mauerarbeiten',    faellt_darunter: 'Gartenmauer, Palisaden, Rasenbord, Natursteinmauer' },
  { name: 'Baumfällung',      faellt_darunter: 'Bäume fällen, Stubben/Wurzeln fräsen, Baumstumpf entfernen' },
  { name: 'Heckenschnitt',    faellt_darunter: 'Hecke schneiden/roden, Gehölz/Sträucher zurückschneiden' },
  { name: 'Gartenpflege',     faellt_darunter: 'Unkraut entfernen, Beete pflegen, Aufräumen, Grünabfall' },
  { name: 'Bepflanzung',      faellt_darunter: 'Beete anlegen, Pflanzen/Hecke/Bäume setzen' },
  { name: 'Materiallieferung',faellt_darunter: 'Mutterboden/Kies/Splitt/Sand liefern OHNE Verbau' },
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
  const gewerkeListe = GEWERKE.map((g) => `  • ${g.name} — ${g.faellt_darunter}`).join('\n');
  return `Domain-Glossar:
- Orte im Einzugsgebiet: ${ORTE_OSTFRIESLAND.slice(0, 30).join(', ')}, ... (weitere ostfriesische Dörfer möglich)
- Hesse-Bezeichnungen: ${HESSE_PRODUKTE.join(', ')}
- Einheiten-Normalisierung: qm→m², cbm/kubik→m³, lfm/laufender Meter→lfm, Stk/Stück→Stk, Std/Stunde→Std

KANONISCHE GEWERKE — leistungen[].name MUSS EXAKT einer dieser Namen aus der linken Spalte sein:
${gewerkeListe}
  • Sonstiges: <knapper eigener Name> — NUR wenn wirklich kein Gewerk oben passt

Regeln zur Aufschlüsselung (sehr wichtig, hier liegen die meisten Fehler):
- name IMMER wörtlich aus der kanonischen Liste übernehmen — niemals frei umformulieren (also "Terrassenbau", NICHT "Terrasse anlegen" oder "Pflasterarbeiten" für eine Terrasse).
- Jedes echte Gewerk genau EINMAL. Mehrere Teilaufgaben desselben Gewerks (z.B. "Zaun aufstellen" + "Sichtschutz einfädeln", oder "alten Zaun raus" + "neuen Zaun setzen") gehören in EINEN Zaunbau-Eintrag, nicht in mehrere.
- Klar verschiedene Gewerke (z.B. Pflaster + Zaun + Baumfällung) bekommen je einen eigenen Eintrag.
- Terrasse → IMMER "Terrassenbau" (auch wenn gepflastert wird). Auffahrt/Hof/Wege → "Pflasterarbeiten". Baum/Stubben/Wurzel → "Baumfällung". Unkraut → "Gartenpflege".
- Bei Tippfehlern in Orten: korrigiere auf den nächstgelegenen aus der Liste (z.B. "Bumde" → "Bunde").
- Einheiten in der Ausgabe IMMER in der Standardform (m², m³, lfm, Stk, Std).`;
}
