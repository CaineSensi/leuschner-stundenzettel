import type { Worker } from "./types";
import { supabase } from "./supabase";

const KEY = "leuschner.session";

interface Session {
  worker: Worker;
  loggedInAt: number;
}

// === Synchroner localStorage-Zugriff (für Routes) ===

export function currentUser(): Worker | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as Session).worker;
  } catch {
    return null;
  }
}

export function login(worker: Worker) {
  const session: Session = { worker, loggedInAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(session));
  localStorage.setItem("leuschner.onboarded", "1");
}

export function logout() {
  localStorage.removeItem(KEY);
}

export function isOnboarded(): boolean {
  return localStorage.getItem("leuschner.onboarded") === "1";
}

export function completeOnboarding() {
  localStorage.setItem("leuschner.onboarded", "1");
}

export function isAdmin(): boolean {
  return currentUser()?.isAdmin === true;
}

// === Supabase-Auth ===

export async function signInWithEmail(email: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Backend nicht verfügbar" };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + "/auth/callback"
    }
  });
  return error ? { error: error.message } : {};
}

export async function signInWithPassword(email: string, password: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Backend nicht verfügbar" };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  // Worker aus DB laden und in localStorage speichern
  const worker = await syncWorkerFromSession();
  if (!worker) return { error: "Account nicht in Mitarbeiter-Liste gefunden" };
  return {};
}

export async function signOutFully() {
  if (supabase) {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
  }
  logout();
  completeOnboarding(); // bleibt durch — kein Re-Onboarding nötig
}

/**
 * WhatsApp-Code-Login: Anonymous Auth + Code einlösen.
 * Schritt 1: signInAnonymously() — temporäre Auth-Identität
 * Schritt 2: redeem_invitation(code) — verknüpft Worker mit dieser Identität
 */
export async function signInWithCode(code: string): Promise<{ worker?: Worker; error?: string }> {
  if (!supabase) return { error: "Backend nicht verfügbar" };

  // Anonymous Auth
  const { error: anonError } = await supabase.auth.signInAnonymously();
  if (anonError) return { error: anonError.message };

  // Code einlösen
  try {
    const sb: any = supabase;
    const { data, error } = await sb.rpc("redeem_invitation", { p_code: code });
    if (error) return { error: error.message };
    if (!data) return { error: "Code konnte nicht eingelöst werden" };

    const worker: Worker = {
      id: data.id,
      initials: data.initials,
      firstName: data.first_name,
      lastName: data.last_name,
      role: data.role,
      isAdmin: data.is_admin
    };
    login(worker);
    return { worker };
  } catch (err: any) {
    return { error: err?.message ?? "Unbekannter Fehler" };
  }
}

/**
 * Wird aufgerufen nach erfolgreicher Magic-Link-Anmeldung
 * oder bei App-Start mit bestehender Session.
 * Lädt den verknüpften Worker und speichert ihn im localStorage.
 */
export async function syncWorkerFromSession(): Promise<Worker | null> {
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const sb: any = supabase;
  const { data, error } = await sb
    .from("workers")
    .select("id, initials, first_name, last_name, role, is_admin")
    .eq("auth_user_id", session.user.id)
    .single();

  if (error || !data) {
    // User authenticated, aber kein worker-Mapping
    return null;
  }

  const worker: Worker = {
    id: data.id,
    initials: data.initials,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    isAdmin: data.is_admin
  };
  login(worker);
  return worker;
}
