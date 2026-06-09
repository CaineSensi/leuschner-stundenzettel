import type { Entry, Worker } from "./types";
import { isEntryActiveOn } from "./utils";

const ENABLED_KEY = "leuschner.notifications.enabled";
const REMIND_AT_KEY = "leuschner.notifications.remindAt"; // HH:MM

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  return Notification.permission === "granted" && localStorage.getItem(ENABLED_KEY) === "1";
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "denied") return false;
  const perm: NotificationPermission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (perm === "granted") {
    localStorage.setItem(ENABLED_KEY, "1");
    return true;
  }
  return false;
}

export function disableNotifications() {
  localStorage.removeItem(ENABLED_KEY);
}

export function setReminderTime(hhmm: string) {
  localStorage.setItem(REMIND_AT_KEY, hhmm);
}

export function getReminderTime(): string {
  return localStorage.getItem(REMIND_AT_KEY) ?? "17:00";
}

export function notify(title: string, body: string, opts: NotificationOptions = {}) {
  if (!notificationsEnabled()) return;
  const n = new Notification(title, {
    body,
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    tag: opts.tag ?? "leuschner-default",
    ...opts
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

/** Liefert Worker-IDs ohne Eintrag (Arbeit oder Abwesenheit) für `date`. */
export function workersWithoutEntry(
  date: string,
  entries: Entry[],
  team: Worker[]
): Worker[] {
  return team.filter((w) =>
    !entries.some((e) => e.workerId === w.id && isEntryActiveOn(e, date))
  );
}

/** Browser-Reminder: Mitarbeiter, dass heute noch nichts erfasst wurde. */
export function remindWorkerIfNeeded(workerId: string, entries: Entry[]) {
  const today = todayIso();
  const has = entries.some((e) => e.workerId === workerId && isEntryActiveOn(e, today));
  if (!has) {
    notify(
      "Heute noch nichts erfasst",
      "Plus-Knopf öffnen und Stunden eintragen — dauert keine zwei Minuten.",
      { tag: "daily-worker-reminder" }
    );
  }
}

/** Browser-Reminder für Admin: wer fehlt heute? */
export function remindAdmin(missing: Worker[]) {
  if (missing.length === 0) return;
  const names = missing.map((w) => `${w.firstName} ${w.lastName.charAt(0)}.`).join(", ");
  notify(
    `${missing.length} ${missing.length === 1 ? "Mitarbeiter" : "Mitarbeiter"} fehlt`,
    `Heute noch offen: ${names}`,
    { tag: "daily-admin-reminder" }
  );
}

/** Sendet eine Erinnerung an alle, die heute noch nicht erfasst haben (Mock). */
export function sendReminderToAll(missing: Worker[]) {
  notify(
    "Erinnerung versendet",
    `${missing.length} ${missing.length === 1 ? "Mitarbeiter" : "Mitarbeiter"} bekommen einen Push.`,
    { tag: "admin-action" }
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
