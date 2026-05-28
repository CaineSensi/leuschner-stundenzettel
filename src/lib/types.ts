export type Discipline = "PFL" | "GTN" | "ZAU" | "VWG";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  PFL: "Pflaster",
  GTN: "Garten",
  VWG: "Verwaltung",
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
  projectNumber?: string;   // Auftragsnummer / Job-Number
  street: string;
  city: string;
  disciplines: Discipline[];
  starred?: boolean;
  geo?: { lat: number; lng: number };
}

export interface Worker {
  id: string;
  companyId?: string;
  initials: string;
  firstName: string;
  lastName: string;
  role: string;
  isAdmin?: boolean;
  phone?: string;
  linked?: boolean;   // true wenn workers.auth_user_id gesetzt ist
  /** Tagessoll in Minuten. Default 480 (8h). Wird für Feiertag/Urlaub/Krank
   *  als Bezahlungsbasis genutzt (Feiertagslohn = übliche Stunden, nicht 8h). */
  dailyTargetMinutes?: number;
  /** Regelmäßige Arbeitstage als ISO-Wochentage (1=Mo … 7=So). Default
   *  [1,2,3,4,5] (Mo–Fr). Rick z.B. [2,4] (Di+Do, Teilzeit Büro). */
  workdays?: number[];
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

export interface Assignment {
  id: string;
  workerId: string;
  date: string;            // ISO YYYY-MM-DD
  siteId: string;
  discipline: Discipline;
  plannedStartMin?: number;
  plannedEndMin?: number;
  plannedPauseMin?: number;
  note?: string;
  publishedAt?: string;    // null = Draft, gefüllt = veröffentlicht
}

export const DEFAULT_PLAN = {
  startMin: 7 * 60,        // 07:00
  endMin: 16 * 60 + 30,    // 16:30
  pauseMin: 30
} as const;

export interface EntryPhoto {
  id: string;
  entryId: string;
  workerId: string;
  rawPath: string;
  stampedPath?: string;
  takenAt?: string;
  geo?: { lat: number; lng: number };
  width?: number;
  height?: number;
  bytesRaw?: number;
  bytesStamped?: number;
  position: number;
  createdAt: string;
}

// Foto mit aufgelösten Eintrag-Metadaten (Baustelle, Datum, Mitarbeiter).
// Wird im Admin-Site-Detail genutzt.
export interface PhotoWithContext extends EntryPhoto {
  date: string;
  siteId: string;
}
