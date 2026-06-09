// Online-Status für Mitarbeiter — Supabase Realtime Presence.
// Sobald ein Worker eingeloggt ist, registriert sich die App im Channel "presence:leuschner"
// und veröffentlicht { workerId, name, initials, role }. Alle anderen Clients sehen
// das live. Verlässt die Seite den Browser, geht die Presence automatisch raus.

import { useEffect, useState } from "react";
import { isBackendConnected, supabase } from "./supabase";
import type { Worker } from "./types";

export interface OnlineUser {
  workerId: string;
  initials: string;
  firstName: string;
  lastName: string;
  role: string;
  isAdmin: boolean;
  onlineAt: string;     // ISO timestamp wann zuletzt eingestempelt
}

let channel: any = null;
let myWorker: Worker | null = null;

function workerToPresence(w: Worker): OnlineUser {
  return {
    workerId: w.id,
    initials: w.initials,
    firstName: w.firstName,
    lastName: w.lastName,
    role: w.role,
    isAdmin: w.isAdmin === true,
    onlineAt: new Date().toISOString(),
  };
}

/** Startet Presence-Tracking für den eingeloggten Worker. Idempotent —
 *  zweiter Aufruf für denselben Worker macht nichts. */
export function startPresence(worker: Worker): void {
  if (!isBackendConnected() || !supabase) return;
  if (channel && myWorker?.id === worker.id) return;
  stopPresence();
  myWorker = worker;
  const sb: any = supabase;
  channel = sb.channel("presence:leuschner", {
    config: { presence: { key: worker.id } }
  });
  channel
    .on("presence", { event: "sync" }, () => {
      notifyListeners();
    })
    .on("presence", { event: "join" }, () => {
      notifyListeners();
    })
    .on("presence", { event: "leave" }, () => {
      notifyListeners();
    })
    .subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") {
        try { await channel.track(workerToPresence(worker)); }
        catch (err) { console.warn("[presence] track failed", err); }
      }
    });
}

export function stopPresence(): void {
  if (!channel) return;
  try { channel.untrack(); } catch { /* ignore */ }
  try { supabase?.removeChannel(channel); } catch { /* ignore */ }
  channel = null;
  myWorker = null;
  notifyListeners();
}

/** Aktueller Presence-State: alle online Workers (inkl. mich selbst). */
export function currentOnlineUsers(): OnlineUser[] {
  if (!channel) return [];
  try {
    const state = channel.presenceState();
    const out: OnlineUser[] = [];
    for (const key in state) {
      const entries = state[key];
      if (Array.isArray(entries) && entries[0]) {
        out.push(entries[0] as OnlineUser);
      }
    }
    return out;
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
function notifyListeners() { for (const fn of listeners) try { fn(); } catch { /* ignore */ } }

/** React-Hook: liefert die aktuelle Liste der online-Workers + lauscht auf Änderungen. */
export function useOnlineUsers(): OnlineUser[] {
  const [users, setUsers] = useState<OnlineUser[]>(currentOnlineUsers());
  useEffect(() => {
    const cb = () => setUsers(currentOnlineUsers());
    listeners.add(cb);
    cb();
    return () => { listeners.delete(cb); };
  }, []);
  return users;
}

export function isWorkerOnline(workerId: string): boolean {
  return currentOnlineUsers().some((u) => u.workerId === workerId);
}
