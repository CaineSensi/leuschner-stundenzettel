// API-Layer: Brücke zwischen Frontend und Supabase.
// Setzt voraus, dass VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der
// Build-Umgebung gesetzt sind. Fehlt eines, wirft jeder Read/Write einen
// klaren Fehler — kein stiller Mock-Modus mehr (entfernt 26.05.2026).

import { supabase, isBackendConnected } from "./supabase";
import type { AbsenceEntry, Assignment, Discipline, Entry, Site, Worker, WorkEntry } from "./types";

function requireBackend(): NonNullable<typeof supabase> {
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlt).");
  }
  return supabase;
}

type EntryDraft =
  | Omit<WorkEntry, "id">
  | Omit<AbsenceEntry, "id">;

// ===== READ =====

export async function listWorkers(): Promise<Worker[]> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("workers")
    .select("id, initials, first_name, last_name, role, is_admin, phone, auth_user_id, daily_target_minutes, workdays")
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
    linked: !!w.auth_user_id,
    dailyTargetMinutes: w.daily_target_minutes ?? 480,
    workdays: Array.isArray(w.workdays) && w.workdays.length > 0 ? w.workdays : [1,2,3,4,5]
  }));
}

export async function unlinkWorker(workerId: string): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  // 1) auth_user_id zurücksetzen → Mitarbeiter kann mit neuem Gerät neu eingeladen werden
  const { error: e1 } = await sb
    .from("workers")
    .update({ auth_user_id: null })
    .eq("id", workerId);
  if (e1) throw e1;
  // 2) Offene Einladungs-Codes invalidieren
  const { error: e2 } = await sb
    .from("invitations")
    .update({ used_at: new Date().toISOString() })
    .eq("worker_id", workerId)
    .is("used_at", null);
  if (e2) throw e2;
}

export async function updateWorkerPhone(workerId: string, phone: string | null): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const { error } = await sb
    .from("workers")
    .update({ phone: phone || null })
    .eq("id", workerId);
  if (error) throw error;
}

export async function listSites(): Promise<Site[]> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("sites")
    .select("*")
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    projectNumber: s.project_number ?? undefined,
    street: s.street ?? "",
    city: s.city ?? "",
    disciplines: ["PFL", "GTN", "ZAU"],
    starred: s.starred,
    geo: s.geo_lat && s.geo_lng ? { lat: s.geo_lat, lng: s.geo_lng } : undefined
  }));
}

export async function listAllSites(includeArchived = false): Promise<(Site & { archived?: boolean })[]> {
  requireBackend();
  const sb: any = supabase;
  let q = sb.from("sites").select("*").order("starred", { ascending: false }).order("name");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    projectNumber: s.project_number ?? undefined,
    street: s.street ?? "",
    city: s.city ?? "",
    disciplines: ["PFL", "GTN", "ZAU"] as Discipline[],
    starred: s.starred,
    geo: s.geo_lat && s.geo_lng ? { lat: s.geo_lat, lng: s.geo_lng } : undefined,
    archived: !!s.archived_at
  }));
}

export interface SiteInput {
  name: string;
  projectNumber?: string;
  street?: string;
  city?: string;
  starred?: boolean;
  geoLat?: number;
  geoLng?: number;
}

export async function createSite(input: SiteInput): Promise<Site> {
  requireBackend();
  const sb: any = supabase;
  // company_id aus Admin holen
  const { data: w, error: wErr } = await sb
    .from("workers")
    .select("company_id")
    .eq("auth_user_id", (await sb.auth.getUser()).data.user.id)
    .single();
  if (wErr) throw wErr;
  const row = {
    company_id: w.company_id,
    name: input.name.trim(),
    project_number: input.projectNumber?.trim() || null,
    street: input.street?.trim() || null,
    city: input.city?.trim() || null,
    starred: input.starred ?? false,
    geo_lat: input.geoLat ?? null,
    geo_lng: input.geoLng ?? null
  };
  const { data, error } = await sb.from("sites").insert(row).select("*").single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    projectNumber: data.project_number ?? undefined,
    street: data.street ?? "",
    city: data.city ?? "",
    disciplines: ["PFL", "GTN", "ZAU"],
    starred: data.starred,
    geo: data.geo_lat && data.geo_lng ? { lat: data.geo_lat, lng: data.geo_lng } : undefined
  };
}

export async function updateSite(id: string, patch: Partial<SiteInput>): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const row: any = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.projectNumber !== undefined) row.project_number = patch.projectNumber?.trim() || null;
  if (patch.street !== undefined) row.street = patch.street?.trim() || null;
  if (patch.city !== undefined) row.city = patch.city?.trim() || null;
  if (patch.starred !== undefined) row.starred = patch.starred;
  if (patch.geoLat !== undefined) row.geo_lat = patch.geoLat;
  if (patch.geoLng !== undefined) row.geo_lng = patch.geoLng;
  const { error } = await sb.from("sites").update(row).eq("id", id);
  if (error) throw error;
}

export async function archiveSite(id: string): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const { error } = await sb
    .from("sites")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function unarchiveSite(id: string): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const { error } = await sb
    .from("sites")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function listAllEntries(dateFrom: string, dateTo: string): Promise<Entry[]> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("entries")
    .select("*")
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date");
  if (error) throw error;
  return (data ?? []).map(rowToEntry);
}

export async function listEntries(workerId: string, weekStart: string, weekEnd: string): Promise<Entry[]> {
  const sb = requireBackend();
  const { data, error } = await sb
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

export async function saveEntry(entry: EntryDraft, existingId?: string): Promise<string> {
  requireBackend();
  const row = entryToRow(entry);
  const sb: any = supabase;
  if (existingId) {
    const { error } = await sb.from("entries").update(row).eq("id", existingId);
    if (error) throw error;
    return existingId;
  }
  const { data, error } = await sb
    .from("entries")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function deleteEntry(id: string): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const { error } = await sb.from("entries").delete().eq("id", id);
  if (error) throw error;
}

export async function submitWeek(workerId: string, weekStart: string, weekEnd: string): Promise<void> {
  requireBackend();
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
  requireBackend();
  const sb: any = supabase;
  const { data, error } = await sb.rpc("create_invitation", { p_worker_id: workerId });
  if (error) throw error;
  return data as string;
}

export async function redeemInvitation(code: string): Promise<Worker> {
  requireBackend();
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

// ===== ASSIGNMENTS (Admin-Tagesplanung) =====

export async function listAssignments(workerId: string, dateFrom: string, dateTo: string): Promise<Assignment[]> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("assignments")
    .select("id, worker_id, date, site_id, discipline, planned_start_min, planned_end_min, planned_pause_min, note, published_at")
    .eq("worker_id", workerId)
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date");
  if (error) throw error;
  return (data ?? []).map(rowToAssignment);
}

export async function listAssignmentsForCompany(dateFrom: string, dateTo: string): Promise<Assignment[]> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("assignments")
    .select("id, worker_id, date, site_id, discipline, planned_start_min, planned_end_min, planned_pause_min, note, published_at")
    .gte("date", dateFrom)
    .lte("date", dateTo);
  if (error) throw error;
  return (data ?? []).map(rowToAssignment);
}

export async function getTodayAssignment(workerId: string, date: string): Promise<Assignment | null> {
  const sb = requireBackend();
  const { data, error } = await sb
    .from("assignments")
    .select("id, worker_id, date, site_id, discipline, planned_start_min, planned_end_min, planned_pause_min, note, published_at")
    .eq("worker_id", workerId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToAssignment(data) : null;
}

export async function upsertAssignment(input: {
  workerId: string;
  date: string;
  siteId: string;
  discipline: "PFL" | "GTN" | "ZAU";
  plannedStartMin?: number;
  plannedEndMin?: number;
  plannedPauseMin?: number;
  note?: string;
}): Promise<Assignment> {
  requireBackend();
  const sb: any = supabase;

  // Wir brauchen company_id für die RLS-check + INSERT — aus dem Worker holen
  const { data: w, error: wErr } = await sb
    .from("workers")
    .select("company_id")
    .eq("id", input.workerId)
    .single();
  if (wErr) throw wErr;

  const row = {
    company_id: w.company_id,
    worker_id: input.workerId,
    date: input.date,
    site_id: input.siteId,
    discipline: input.discipline,
    planned_start_min: input.plannedStartMin ?? null,
    planned_end_min: input.plannedEndMin ?? null,
    planned_pause_min: input.plannedPauseMin ?? null,
    note: input.note ?? null
  };

  const { data, error } = await sb
    .from("assignments")
    .upsert(row, { onConflict: "worker_id,date" })
    .select("id, worker_id, date, site_id, discipline, planned_start_min, planned_end_min, planned_pause_min, note, published_at")
    .single();
  if (error) throw error;
  return rowToAssignment(data);
}

export async function deleteAssignment(workerId: string, date: string): Promise<void> {
  requireBackend();
  const sb: any = supabase;
  const { error } = await sb
    .from("assignments")
    .delete()
    .eq("worker_id", workerId)
    .eq("date", date);
  if (error) throw error;
}

function rowToAssignment(r: any): Assignment {
  return {
    id: r.id,
    workerId: r.worker_id,
    date: r.date,
    siteId: r.site_id,
    discipline: r.discipline,
    plannedStartMin: r.planned_start_min ?? undefined,
    plannedEndMin: r.planned_end_min ?? undefined,
    plannedPauseMin: r.planned_pause_min ?? undefined,
    note: r.note ?? undefined,
    publishedAt: r.published_at ?? undefined
  };
}

export async function publishWeek(dateFrom: string, dateTo: string): Promise<number> {
  requireBackend();
  const sb: any = supabase;
  const { data, error } = await sb
    .from("assignments")
    .update({ published_at: new Date().toISOString() })
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .is("published_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function unpublishWeek(dateFrom: string, dateTo: string): Promise<number> {
  requireBackend();
  const sb: any = supabase;
  const { data, error } = await sb
    .from("assignments")
    .update({ published_at: null })
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .not("published_at", "is", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function listInvitations() {
  requireBackend();
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
