import type { Entry } from "./types";
import { reportTimeout } from "./diag";

/**
 * Begrenzt ein Promise hart auf `ms`. Schlägt der Timer zu, wird der Vorgang
 * abgebrochen UND zentral ins Diagnose-Log gemeldet (so taucht z.B. ein
 * Firefox-Hänger beim Senden automatisch auf, ohne dass man ihn nachstellen muss).
 *
 * Wichtig: Der Timer wird IMMER aufgeräumt (clearTimeout), sobald das echte
 * Promise zuerst fertig ist — sonst würde der Timeout-Callback später trotzdem
 * feuern und einen Fehl-Timeout melden, obwohl alles gut lief.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reportTimeout(label, ms);
      reject(new Error(`Zeitüberschreitung: ${label} (${ms}ms)`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtHours(min: number, fractionDigits = 1): string {
  return (min / 60).toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

/** Gilt der Eintrag an diesem ISO-Datum?
 *  - work-Einträge: nur am `entry.date` selbst.
 *  - Krank/Urlaub mit `endDate`: gesamter Bereich date..endDate inklusive.
 *  Wichtig für Wochensummen + Tagesansichten (sonst zeigt eine 5-Tage-
 *  Krankschreibung nur den ersten Tag und es fehlen 4 × 8 h = 32 h Lohnfortzahlung). */
export function isEntryActiveOn(entry: Entry, iso: string): boolean {
  if (entry.date === iso) return true;
  if ("endDate" in entry && entry.endDate) {
    return entry.date <= iso && iso <= entry.endDate;
  }
  return false;
}

/** Bezahlte Arbeitszeit eines Eintrags.
 *  Rick-Vorgabe 09.06.2026: Der Mitarbeiter trägt die produktive Zeit ein
 *  (z.B. 07:00–15:00 = 8 h). Die 30-min-Pause wird vom System automatisch
 *  außerhalb dieser Spanne ergänzt (Anwesenheit endet dann 15:30) und ist
 *  unbezahlt — sie kürzt also NICHT die Lohnzeit. */
export function workMinutes(entry: Entry): number {
  if (entry.type !== "work") return 0;
  return Math.max(0, entry.endMin - entry.startMin);
}

/** Gesetzlich nötiger Pause-Aufschlag nach §4 ArbZG.
 *  ≤ 6 h Arbeit: keine Pause vorgeschrieben → 0
 *  > 6 h bis ≤ 9 h: 30 min Pflicht
 *  > 9 h: 45 min Pflicht
 *  Wird für Anwesenheits-Anzeige verwendet (Stundenzettel/Tagesansicht). */
export function effectivePauseMin(entry: Entry & { type: "work" }): number {
  const work = Math.max(0, entry.endMin - entry.startMin);
  if (work > 9 * 60) return 45;
  if (work > 6 * 60) return 30;
  return 0;
}

/** Anwesenheits-Ende für Stundenzettel: Netto-Feierabend + gesetzlich
 *  vorgeschriebener Pause-Aufschlag (nicht der DB-Default, sondern §4 ArbZG-konform). */
export function attendanceEndMin(entry: Entry & { type: "work" }): number {
  return entry.endMin + effectivePauseMin(entry);
}

/** Bezahlungs-relevante Minuten: gearbeitete Zeit für work-Entries,
 *  Tagessoll für Feiertag/Urlaub/Krank (Lohnfortzahlung / Feiertagslohn). */
export function paidMinutes(entry: Entry, dailyTargetMinutes: number = 480): number {
  if (entry.type === "work") {
    return Math.max(0, entry.endMin - entry.startMin);
  }
  return dailyTargetMinutes;
}

/** ISO-Wochentag (1=Mo … 7=So) eines ISO-Datums. */
export function isoWeekday(iso: string): number {
  const wd = new Date(iso).getDay();
  return wd === 0 ? 7 : wd;
}

/** Ist der Tag ein regulärer Arbeitstag dieses Workers?
 *  workdays = ISO-Wochentage [1..7]. Default Mo–Fr. */
export function isWorkdayFor(workdays: number[] | undefined, iso: string): boolean {
  const days = workdays && workdays.length > 0 ? workdays : [1,2,3,4,5];
  return days.includes(isoWeekday(iso));
}

export function dayName(iso: string): string {
  const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return days[new Date(iso).getDay()];
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

export function todayIso(): string {
  // Lokales Datum (sonst Mitternacht-Bug bei Sommerzeit)
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function isoWeek(d: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
  return { year: d.getFullYear(), week };
}

/**
 * Liefert die Wochentage Mo–Fr für eine gegebene Kalenderwoche.
 * Samstag fällt nur an, wenn explizit gearbeitet — dann manueller Eintrag.
 * Sonntag ist immer frei.
 */
export function weekDays(year: number, week: number): string[] {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const day = simple.getDay();
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - ((day + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    // Lokales Datum als ISO-String (nicht toISOString — das wäre UTC und
    // würde wegen Zeitzone Mo→So verschieben)
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
}

// Distance in metres between two GPS points (Haversine)
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
