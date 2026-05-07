import { get, set, del, keys } from "idb-keyval";
import type { AbsenceEntry, Entry, WorkEntry } from "./types";

type EntryDraft = Omit<WorkEntry, "id"> | Omit<AbsenceEntry, "id">;

interface PendingEntry {
  localId: string;
  draft: EntryDraft;
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

const KEY_PREFIX = "pending:";

export async function queueEntry(draft: EntryDraft): Promise<string> {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pending: PendingEntry = { localId, draft, queuedAt: Date.now(), attempts: 0 };
  await set(KEY_PREFIX + localId, pending);
  return localId;
}

export async function listPending(): Promise<PendingEntry[]> {
  const allKeys = await keys();
  const pending: PendingEntry[] = [];
  for (const k of allKeys) {
    if (typeof k !== "string" || !k.startsWith(KEY_PREFIX)) continue;
    const v = await get<PendingEntry>(k);
    if (v) pending.push(v);
  }
  return pending.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function pendingCount(): Promise<number> {
  const list = await listPending();
  return list.length;
}

export async function removePending(localId: string): Promise<void> {
  await del(KEY_PREFIX + localId);
}

export async function markFailed(localId: string, error: string): Promise<void> {
  const v = await get<PendingEntry>(KEY_PREFIX + localId);
  if (!v) return;
  v.attempts += 1;
  v.lastError = error;
  await set(KEY_PREFIX + localId, v);
}

/** Konvertiert pending entries zurück in echte Entry-Objekte (für UI-Anzeige) */
export function pendingToEntry(p: PendingEntry): Entry {
  return {
    id: p.localId,
    ...p.draft
  } as Entry;
}
