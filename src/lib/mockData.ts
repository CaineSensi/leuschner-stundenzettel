import type { Entry, Site, Worker } from "./types";

// IDs in sync mit supabase/seed.sql — gleiche UUIDs wie in der DB
export const WORKERS: Worker[] = [
  { id: "00000000-0000-0000-0000-000000000010", initials: "RK", firstName: "Rick",     lastName: "Kohlberg",  role: "Büro · Verwaltung",         isAdmin: true },
  { id: "00000000-0000-0000-0000-000000000011", initials: "UL", firstName: "Udo",      lastName: "Leuschner", role: "Inhaber · Geschäftsführer" },
  { id: "00000000-0000-0000-0000-000000000012", initials: "WW", firstName: "Wolfgang", lastName: "Wilken",    role: "Inhaber · Geschäftsführer" },
  { id: "00000000-0000-0000-0000-000000000013", initials: "MJ", firstName: "Mathias",  lastName: "Jauken",    role: "Maschinist · Bagger" }
];

export const CURRENT_WORKER: Worker = WORKERS.find((w) => w.id === "mj")!;
export const ADMIN_WORKER: Worker = WORKERS.find((w) => w.isAdmin)!;

export interface WeeklySummary {
  workerId: string;
  minutes: number;
  daysFilled: number;
  daysExpected: number;
  submitted: boolean;
  lastActivity: string;
  currentSite?: string;
}

export const WEEKLY_SUMMARY: WeeklySummary[] = [
  { workerId: "00000000-0000-0000-0000-000000000013", minutes: 38 * 60, daysFilled: 5, daysExpected: 5, submitted: true,  lastActivity: "2026-05-08T16:30:00", currentSite: "gewerbe-bingum" },
  { workerId: "00000000-0000-0000-0000-000000000012", minutes: 41 * 60, daysFilled: 5, daysExpected: 5, submitted: true,  lastActivity: "2026-05-08T13:42:00", currentSite: "hoffmann" }
];

export const SITES: Site[] = [
  {
    id: "hoffmann",
    name: "Fam. Hoffmann",
    street: "Wilhelmstr. 12",
    city: "26789 Leer",
    disciplines: ["PFL"],
    starred: true,
    geo: { lat: 53.2306, lng: 7.4577 }
  },
  {
    id: "meents",
    name: "Dr. Meents",
    street: "Hauptstr. 84",
    city: "26831 Bunde",
    disciplines: ["GTN"],
    starred: true,
    geo: { lat: 53.1810, lng: 7.2630 }
  },
  {
    id: "kita-stp",
    name: "Kita Stapelmoor",
    street: "Schulstr. 5",
    city: "26826 Stapelmoor",
    disciplines: ["ZAU"],
    geo: { lat: 53.1620, lng: 7.3650 }
  },
  {
    id: "nelken",
    name: "Nelkenweg 14",
    street: "Nelkenweg 14",
    city: "26826 Weener",
    disciplines: ["PFL"],
    geo: { lat: 53.1640, lng: 7.3500 }
  },
  {
    id: "friedhof-w",
    name: "Friedhof Weener",
    street: "Hindenburgstr. 1",
    city: "26826 Weener",
    disciplines: ["GTN", "PFL"],
    geo: { lat: 53.1665, lng: 7.3580 }
  },
  {
    id: "gewerbe-bingum",
    name: "Gewerbepark Bingum",
    street: "Industriestr. 14",
    city: "26789 Leer",
    disciplines: ["PFL", "ZAU"],
    geo: { lat: 53.2410, lng: 7.4400 }
  }
];

// KW 19 / 2026: 04.05. – 10.05. — Mathias Jaukens Einträge
export const ENTRIES: Entry[] = [
  { id: "e1", type: "work", workerId: "00000000-0000-0000-0000-000000000013", date: "2026-05-04", siteId: "hoffmann",       discipline: "PFL", startMin: 7*60, endMin: 15*60+30, pauseMin: 30, weather: "sun",   geoVerified: true },
  { id: "e2", type: "work", workerId: "00000000-0000-0000-0000-000000000013", date: "2026-05-05", siteId: "hoffmann",       discipline: "PFL", startMin: 7*60, endMin: 15*60+30, pauseMin: 30, weather: "sun",   geoVerified: true },
  { id: "e3", type: "work", workerId: "00000000-0000-0000-0000-000000000013", date: "2026-05-06", siteId: "gewerbe-bingum", discipline: "PFL", startMin: 7*60, endMin: 16*60,    pauseMin: 30, weather: "cloud", geoVerified: true },
  { id: "e4", type: "work", workerId: "00000000-0000-0000-0000-000000000013", date: "2026-05-07", siteId: "gewerbe-bingum", discipline: "PFL", startMin: 7*60, endMin: 16*60,    pauseMin: 30, weather: "cloud", geoVerified: true },
  { id: "e5", type: "work", workerId: "00000000-0000-0000-0000-000000000013", date: "2026-05-08", siteId: "nelken",         discipline: "PFL", startMin: 7*60, endMin: 12*60+30, pauseMin: 30, weather: "sun",   geoVerified: false },

  // Wolfgang Wilken — Vorarbeiter, volle Woche
  { id: "w1", type: "work", workerId: "00000000-0000-0000-0000-000000000012", date: "2026-05-04", siteId: "hoffmann",   discipline: "PFL", startMin: 7*60,    endMin: 16*60+30, pauseMin: 30, weather: "sun",   geoVerified: true },
  { id: "w2", type: "work", workerId: "00000000-0000-0000-0000-000000000012", date: "2026-05-05", siteId: "hoffmann",   discipline: "PFL", startMin: 7*60,    endMin: 16*60+30, pauseMin: 30, weather: "sun",   geoVerified: true },
  { id: "w3", type: "work", workerId: "00000000-0000-0000-0000-000000000012", date: "2026-05-06", siteId: "friedhof-w", discipline: "GTN", startMin: 7*60+30, endMin: 15*60+30, pauseMin: 30, weather: "cloud", geoVerified: true },
  { id: "w4", type: "work", workerId: "00000000-0000-0000-0000-000000000012", date: "2026-05-07", siteId: "hoffmann",   discipline: "PFL", startMin: 7*60,    endMin: 17*60,    pauseMin: 30, weather: "rain",  geoVerified: true, note: "Pflastersteine geliefert · 2 t" },
  { id: "w5", type: "work", workerId: "00000000-0000-0000-0000-000000000012", date: "2026-05-08", siteId: "hoffmann",   discipline: "PFL", startMin: 7*60,    endMin: 13*60+30, pauseMin: 30, weather: "sun",   geoVerified: true }
];

export interface ActivityEvent {
  id: string;
  workerId: string;
  type: "submit" | "checkin" | "entry" | "delay";
  timestamp: string;
  message: string;
  siteId?: string;
}

export const ACTIVITY: ActivityEvent[] = [
  { id: "a1", workerId: "00000000-0000-0000-0000-000000000013", type: "submit",  timestamp: "2026-05-08T16:30", message: "Hat KW 19 abgeschlossen · 38,0 h" },
  { id: "a2", workerId: "00000000-0000-0000-0000-000000000012", type: "submit",  timestamp: "2026-05-08T13:42", message: "Hat KW 19 abgeschlossen · 41,0 h" },
  { id: "a3", workerId: "00000000-0000-0000-0000-000000000012", type: "checkin", timestamp: "2026-05-08T06:58", message: "Bei Fam. Hoffmann angekommen · GPS verifiziert", siteId: "hoffmann" },
  { id: "a4", workerId: "00000000-0000-0000-0000-000000000013", type: "checkin", timestamp: "2026-05-08T07:01", message: "Bei Nelkenweg 14 angekommen · GPS verifiziert", siteId: "nelken" },
  { id: "a5", workerId: "00000000-0000-0000-0000-000000000012", type: "entry",   timestamp: "2026-05-07T17:08", message: "Donnerstag erfasst · Hoffmann · 9,5 h" },
  { id: "a6", workerId: "00000000-0000-0000-0000-000000000013", type: "entry",   timestamp: "2026-05-07T16:12", message: "Donnerstag erfasst · Gewerbepark Bingum · 8,5 h" }
];
