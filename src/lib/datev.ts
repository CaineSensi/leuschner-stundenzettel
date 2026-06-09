// DATEV-Stundenexport · LODAS/Lohn+Gehalt-tauglicher CSV-Aufbau.
// Der EXTF-Lohnimport selbst ist sehr eng spezifiziert (Personalnummern in
// DATEV-LODAS, Lohnarten aus dem Mandanten-Stamm). Bis die Lohnart-Mapping-
// Tabelle vom Steuerberater geliefert ist, erzeugen wir hier eine klar
// dokumentierte „Vorab-CSV" — Spalten so genannt, dass der StB sie 1:1 nach
// DATEV LODAS oder Lohn+Gehalt übernehmen kann.

import type { Entry, Worker, Site, Discipline } from "./types";
import { isWorkEntry, DISCIPLINE_LABEL } from "./types";
import { workMinutes, fmtHours } from "./utils";
import { getHoliday } from "./holidays";

/** Aktuelles Mapping Discipline → Lohnart (DATEV).
 *  Default 010 (Grundlohn) bis Steuerberater eigene Aufschlüsselung gibt. */
export const LOHNART_MAPPING: Record<Discipline, string> = {
  PFL: "010",
  GTN: "010",
  ZAU: "010",
  VWG: "020",   // Gehalt/Verwaltung — bis StB eigene Lohnart liefert
  KUN: "010",   // Kunststoff-Vermahlung (2. Standbein) — vorerst Grundlohn, ggf. später separieren
};

/** Lohnart für Abwesenheiten. DATEV-übliche Codes:
 *  030 = Urlaubslohn, 040 = Lohnfortzahlung bei Krankheit, 050 = Feiertagslohn. */
export const LOHNART_ABSENCE: Record<"vacation" | "sick" | "holiday", string> = {
  vacation: "030",
  sick: "040",
  holiday: "050",
};

export interface ExportRow {
  workerId: string;
  personalNumber: string;   // Initialen als Platzhalter — StB pflegt echte Nr.
  workerName: string;
  date: string;             // YYYY-MM-DD
  lohnart: string;          // "010", "030", …
  hours: number;            // dezimal, z. B. 7.75
  kostenstelle: string;     // Auftragsnummer der Baustelle (oder Leer)
  bemerkung: string;        // Discipline + Site-Name
}

/** Baut alle Export-Zeilen für die übergebene Woche. */
export function buildExportRows(
  days: string[],
  workers: Worker[],
  entries: Entry[],
  sites: Site[],
): ExportRow[] {
  const rows: ExportRow[] = [];
  const teamWorkers = workers.filter((w) => !w.isAdmin);
  const siteById = new Map(sites.map((s) => [s.id, s]));

  for (const w of teamWorkers) {
    for (const d of days) {
      const dayEntries = entries.filter((e) => e.workerId === w.id && e.date === d);
      const work = dayEntries.find(isWorkEntry);
      const absence = dayEntries.find((e) => !isWorkEntry(e));
      const holiday = getHoliday(d);

      if (work) {
        const min = workMinutes(work);
        if (min > 0) {
          const site = siteById.get(work.siteId);
          rows.push({
            workerId: w.id,
            personalNumber: w.initials,
            workerName: `${w.firstName} ${w.lastName}`,
            date: d,
            lohnart: LOHNART_MAPPING[work.discipline],
            hours: round2(min / 60),
            kostenstelle: site?.projectNumber ?? "",
            bemerkung: `${DISCIPLINE_LABEL[work.discipline]} · ${site?.name ?? "Baustelle"}`,
          });
        }
      } else if (absence && (absence.type === "vacation" || absence.type === "sick" || absence.type === "holiday")) {
        rows.push({
          workerId: w.id,
          personalNumber: w.initials,
          workerName: `${w.firstName} ${w.lastName}`,
          date: d,
          lohnart: LOHNART_ABSENCE[absence.type],
          hours: 8,
          kostenstelle: "",
          bemerkung: absence.type === "vacation" ? "Urlaub" : absence.type === "sick" ? "Krankheit" : "Feiertag",
        });
      } else if (holiday) {
        // Gesetzlicher Feiertag ohne expliziten Eintrag — Soll automatisch 8 h
        rows.push({
          workerId: w.id,
          personalNumber: w.initials,
          workerName: `${w.firstName} ${w.lastName}`,
          date: d,
          lohnart: LOHNART_ABSENCE.holiday,
          hours: 8,
          kostenstelle: "",
          bemerkung: `Feiertag · ${holiday.name}`,
        });
      }
    }
  }
  // Sortierung: Personalnummer, Datum, Lohnart
  rows.sort((a, b) => a.personalNumber.localeCompare(b.personalNumber) || a.date.localeCompare(b.date) || a.lohnart.localeCompare(b.lohnart));
  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** CSV (Semikolon-getrennt, Komma als Dezimaltrenner — DATEV-Standard).
 *  UTF-8 mit BOM, damit Excel beim Öffnen Umlaute korrekt anzeigt. */
export function buildCSV(rows: ExportRow[]): string {
  const head = [
    "Personalnummer",
    "Name",
    "Datum",
    "Lohnart",
    "Stunden",
    "Kostenstelle",
    "Bemerkung",
  ].join(";");
  const body = rows.map((r) => [
    csvCell(r.personalNumber),
    csvCell(r.workerName),
    r.date,
    csvCell(r.lohnart),
    r.hours.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    csvCell(r.kostenstelle),
    csvCell(r.bemerkung),
  ].join(";")).join("\r\n");
  return "﻿" + head + "\r\n" + body + "\r\n";
}

function csvCell(s: string): string {
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Anstößt einen Download im Browser. */
export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function csvFilename(year: number, week: number): string {
  return `leuschner_stunden_${year}-KW${String(week).padStart(2, "0")}.csv`;
}

/** Hilfs-Aggregat: Σ Stunden pro Mitarbeiter, Σ Stunden pro Lohnart. */
export function aggregate(rows: ExportRow[]) {
  const perWorker = new Map<string, { name: string; personalNumber: string; hours: number }>();
  const perLohnart = new Map<string, number>();
  for (const r of rows) {
    const w = perWorker.get(r.workerId) ?? { name: r.workerName, personalNumber: r.personalNumber, hours: 0 };
    w.hours += r.hours;
    perWorker.set(r.workerId, w);
    perLohnart.set(r.lohnart, (perLohnart.get(r.lohnart) ?? 0) + r.hours);
  }
  return { perWorker: Array.from(perWorker.values()), perLohnart: Array.from(perLohnart.entries()) };
}

export const LOHNART_LABEL: Record<string, string> = {
  "010": "Grundlohn",
  "030": "Urlaubslohn",
  "040": "Lohnfortzahlung Krankheit",
  "050": "Feiertagslohn",
};

export { fmtHours };
