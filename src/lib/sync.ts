import { saveEntry as apiSave } from "./api";
import { listPending, removePending, markFailed, queueEntry, pendingCount } from "./offline";
import { isBackendConnected } from "./supabase";
import type { AbsenceEntry, WorkEntry } from "./types";

type EntryDraft = Omit<WorkEntry, "id"> | Omit<AbsenceEntry, "id">;

let syncing = false;
let listeners: Array<() => void> = [];

export function onSyncChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function emit() {
  listeners.forEach((l) => l());
}

/**
 * Speichert einen Eintrag — direkt zur DB wenn online, sonst lokal.
 * Returnt die ID (echte UUID oder local-ID).
 */
export async function saveEntryWithSync(draft: EntryDraft, existingId?: string): Promise<string> {
  if (navigator.onLine && isBackendConnected()) {
    try {
      const id = await apiSave(draft, existingId);
      emit();
      return id;
    } catch (err) {
      console.warn("[sync] direct save failed, queueing", err);
    }
  }
  // Offline-Update wird aktuell nicht unterstützt — neuer Eintrag in Queue
  const localId = await queueEntry(draft);
  emit();
  return localId;
}

/**
 * Versucht alle wartenden Einträge hochzuladen.
 * Wird aufgerufen beim App-Start und beim Online-Werden.
 */
export async function syncPending(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  if (!navigator.onLine || !isBackendConnected()) return { synced: 0, failed: 0 };

  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const pending = await listPending();
    for (const p of pending) {
      try {
        await apiSave(p.draft);
        await removePending(p.localId);
        synced += 1;
      } catch (err: any) {
        await markFailed(p.localId, err?.message ?? "Sync fehlgeschlagen");
        failed += 1;
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  return { synced, failed };
}

export async function getPendingCount(): Promise<number> {
  return pendingCount();
}
