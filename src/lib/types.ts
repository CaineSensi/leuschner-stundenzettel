export type Discipline = "PFL" | "GTN" | "ZAU";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  PFL: "Pflaster",
  GTN: "Garten",
  ZAU: "Zaun"
};

export type EntryType = "work" | "sick" | "vacation" | "holiday";

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  work:     "Arbeit",
  sick:     "Krankheit",
  vacation: "Urlaub",
  holiday:  "Feiertag"
};

export interface Site {
  id: string;
  name: string;
  street: string;
  city: string;
  disciplines: Discipline[];
  starred?: boolean;
  geo?: { lat: number; lng: number };
}

export interface Worker {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  role: string;
  isAdmin?: boolean;
  phone?: string;
  linked?: boolean;   // true wenn workers.auth_user_id gesetzt ist
}

interface BaseEntry {
  id: string;
  workerId: string;
  date: string;        // ISO date YYYY-MM-DD
  note?: string;
}

export interface WorkEntry extends BaseEntry {
  type: "work";
  siteId: string;
  discipline: Discipline;
  startMin: number;    // minutes since 00:00
  endMin: number;
  pauseMin: number;
  weather?: "sun" | "cloud" | "rain" | "snow";
  geoVerified?: boolean;
}

export interface AbsenceEntry extends BaseEntry {
  type: "sick" | "vacation" | "holiday";
  endDate?: string;    // ISO date for multi-day absence
}

export type Entry = WorkEntry | AbsenceEntry;

export function isWorkEntry(e: Entry): e is WorkEntry {
  return e.type === "work";
}
