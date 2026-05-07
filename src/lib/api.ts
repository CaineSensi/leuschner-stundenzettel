// API-Layer: Brücke zwischen Frontend und Supabase.
// Solange VITE_SUPABASE_URL nicht gesetzt ist, fallen alle Calls auf Mock-Daten zurück.
// Sobald die ENV-Variablen gesetzt sind, läuft alles gegen die echte Datenbank.

import { supabase, isBackendConnected } from "./supabase";
import type { AbsenceEntry, Entry, Site, Worker, WorkEntry } from "./types";
import * as mock from "./mockData";

type EntryDraft =
  | Omit<WorkEntry, "id">
  | Omit<AbsenceEntry, "id">;

// ===== READ =====

export async function listWorkers(): Promise<Worker[]> {
  if (!isBackendConnected() || !supabase) return mock.WORKERS;
  const { data, error } = await supabase
    .from("workers")
    .select("id, initials, first_name, last_name, role, is_admin, phone, auth_user_id")
    .order("is_admin", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((w: any) => ({
    id: w.id,
    initials: w.initials,
    firstName: w.first_name,
    lastName: w.last_name,
    role: w.role,
    isAdmin: w.is_admin,
    phone: w.phone ?? undefined,
    linked: !!w.auth_user_id
  }));
}

export async function updateWorkerPhone(workerId: string, phone: string | null): Promise<void> {
  if (!isBackendConnected() || !supabase) {
    console.log("[mock] updateWorkerPhone", { workerId, phone });
    return;
  }
  const sb: any = supabase;
  const { error } = await sb
    .from("workers")
    .update({ phone: phone || null })
    .eq("id", workerId);
  if (error) throw error;
}

export async function listSites(): Promise<Site[]> {
  if (!isBackendConnected() || !supabase) return mock.SITES;
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    street: s.street ?? "",
    city: s.city ?? "",
    disciplines: ["PFL", "GTN", "ZAU"],
    starred: s.starred,
    geo: s.geo_lat && s.geo_lng ? { lat: s.geo_lat, lng: s.geo_lng } : undefined
  }));
}

export async function listEntries(workerId: string, weekStart: string, weekEnd: string): Promise<Entry[]> {
  if (!isBackendConnected() || !supabase) {
    return mock.ENTRIES.filter(
      (e) => e.workerId === workerId && e.date >= weekStart && e.date <= weekEnd
    );
  }
  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .eq("worker_id", workerId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .order("date");
  if (error) throw error;
  return (data ?? []).map(rowToEntry);
}

// ===== WRITE =====

export async function saveEntry(entry: EntryDraft): Promise<string> {
  if (!isBackendConnected() || !supabase) {
    const fakeId = `local-${Date.now()}`;
    console.log("[mock] saveEntry", { ...entry, id: fakeId });
    return fakeId;
  }
  const row = entryToRow(entry);
  const { data, error } = await supabase
    .from("entries")
    .insert(row as any)
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function submitWeek(workerId: string, weekStart: string, weekEnd: string): Promise<void> {
  if (!isBackendConnected() || !supabase) {
    console.log("[mock] submitWeek", { workerId, weekStart, weekEnd });
    return;
  }
  const sb = supabase as any;
  const { error } = await sb
    .from("entries")
    .update({ submitted_at: new Date().toISOString() })
    .eq("worker_id", workerId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .is("submitted_at", null);
  if (error) throw error;
}

// ===== INVITATIONS =====

export async function createInvitation(workerId: string): Promise<string> {
  if (!isBackendConnected() || !supabase) {
    return "DEMOXX"; // Mock-Code
  }
  const sb: any = supabase;
  const { data, error } = await sb.rpc("create_invitation", { p_worker_id: workerId });
  if (error) throw error;
  return data as string;
}

export async function redeemInvitation(code: string): Promise<Worker> {
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden");
  }
  const sb: any = supabase;
  const { data, error } = await sb.rpc("redeem_invitation", { p_code: code });
  if (error) throw error;
  if (!data) throw new Error("Code konnte nicht eingelöst werden");
  return {
    id: data.id,
    initials: data.initials,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    isAdmin: data.is_admin
  };
}

export async function listInvitations() {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("invitations")
    .select("code, worker_id, invited_by, expires_at, used_at")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

// ===== ROW MAPPING =====

function rowToEntry(r: any): Entry {
  if (r.entry_type === "work") {
    return {
      id: r.id,
      type: "work",
      workerId: r.worker_id,
      date: r.date,
      siteId: r.site_id,
      discipline: r.discipline,
      startMin: r.start_min,
      endMin: r.end_min,
      pauseMin: r.pause_min,
      weather: r.weather ?? undefined,
      geoVerified: r.geo_verified,
      note: r.note ?? undefined
    };
  }
  return {
    id: r.id,
    type: r.entry_type,
    workerId: r.worker_id,
    date: r.date,
    endDate: r.end_date ?? undefined,
    note: r.note ?? undefined
  };
}

function entryToRow(e: EntryDraft) {
  if (e.type === "work") {
    return {
      worker_id: e.workerId,
      date: e.date,
      entry_type: "work",
      site_id: e.siteId,
      discipline: e.discipline,
      start_min: e.startMin,
      end_min: e.endMin,
      pause_min: e.pauseMin,
      weather: e.weather ?? null,
      geo_verified: e.geoVerified ?? false,
      note: e.note ?? null
    };
  }
  return {
    worker_id: e.workerId,
    date: e.date,
    entry_type: e.type,
    end_date: e.endDate ?? null,
    note: e.note ?? null
  };
}
