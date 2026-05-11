// Gesetzliche Feiertage Niedersachsen.
// Quelle: § 1 NFeiertagsG (Stand 2026).
// Bei Erweiterung um 2028+ einfach ergänzen.

export interface Holiday {
  date: string;   // YYYY-MM-DD
  name: string;
}

export const HOLIDAYS_NI: Holiday[] = [
  // 2026
  { date: "2026-01-01", name: "Neujahr" },
  { date: "2026-04-03", name: "Karfreitag" },
  { date: "2026-04-06", name: "Ostermontag" },
  { date: "2026-05-01", name: "Tag der Arbeit" },
  { date: "2026-05-14", name: "Christi Himmelfahrt" },
  { date: "2026-05-25", name: "Pfingstmontag" },
  { date: "2026-10-03", name: "Tag der Deutschen Einheit" },
  { date: "2026-10-31", name: "Reformationstag" },
  { date: "2026-12-25", name: "1. Weihnachtstag" },
  { date: "2026-12-26", name: "2. Weihnachtstag" },
  // 2027
  { date: "2027-01-01", name: "Neujahr" },
  { date: "2027-03-26", name: "Karfreitag" },
  { date: "2027-03-29", name: "Ostermontag" },
  { date: "2027-05-01", name: "Tag der Arbeit" },
  { date: "2027-05-06", name: "Christi Himmelfahrt" },
  { date: "2027-05-17", name: "Pfingstmontag" },
  { date: "2027-10-03", name: "Tag der Deutschen Einheit" },
  { date: "2027-10-31", name: "Reformationstag" },
  { date: "2027-12-25", name: "1. Weihnachtstag" },
  { date: "2027-12-26", name: "2. Weihnachtstag" },
  // 2028
  { date: "2028-01-01", name: "Neujahr" },
  { date: "2028-04-14", name: "Karfreitag" },
  { date: "2028-04-17", name: "Ostermontag" },
  { date: "2028-05-01", name: "Tag der Arbeit" },
  { date: "2028-05-25", name: "Christi Himmelfahrt" },
  { date: "2028-06-05", name: "Pfingstmontag" },
  { date: "2028-10-03", name: "Tag der Deutschen Einheit" },
  { date: "2028-10-31", name: "Reformationstag" },
  { date: "2028-12-25", name: "1. Weihnachtstag" },
  { date: "2028-12-26", name: "2. Weihnachtstag" }
];

const MAP = new Map(HOLIDAYS_NI.map((h) => [h.date, h]));

export function getHoliday(isoDate: string): Holiday | null {
  return MAP.get(isoDate) ?? null;
}

export function isHoliday(isoDate: string): boolean {
  return MAP.has(isoDate);
}
