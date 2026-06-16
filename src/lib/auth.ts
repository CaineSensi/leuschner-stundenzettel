import type { Worker } from "./types";
import { supabase } from "./supabase";
import { withTimeout } from "./utils";

const KEY = "leuschner.session";
const CODE_KEY = "leuschner.code";

interface Session {
  worker: Worker;
  loggedInAt: number;
}

function storeCode(code: string) {
  // Code im localStorage ablegen, damit die App bei abgelaufenem Refresh-Token
  // automatisch neu authentifizieren kann (Rick-Vorgabe 09.06.: „Code nur einmal
  // eingeben"). Klartext ist akzeptabel — gleiche Vertraulichkeitsstufe wie der
  // Supabase-Auth-Token, der eh hier liegt; bei Handyverlust sperrt das Büro den
  // Code, dann schlägt der Auto-Reauth fehl und führt zu /login.
  try { localStorage.setItem(CODE_KEY, code.toUpperCase()); } catch { /* ignore */ }
}
function getStoredCode(): string | null {
  try { return localStorage.getItem(CODE_KEY); } catch { return null; }
}
function clearStoredCode() {
  try { localStorage.removeItem(CODE_KEY); } catch { /* ignore */ }
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
  clearStoredCode();
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
  try {
    console.log("[auth] signIn start", email);
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      10000,
      "Auth-Server"
    );
    if (error) {
      console.warn("[auth] signIn error", error.message);
      return { error: error.message };
    }
    console.log("[auth] signIn ok, syncing worker …");
    const worker = await withTimeout(syncWorkerFromSession(), 8000, "Worker-Sync");
    if (!worker) return { error: "Account nicht in Mitarbeiter-Liste gefunden" };
    console.log("[auth] worker", worker.firstName, worker.lastName, "isAdmin=", worker.isAdmin);
    return {};
  } catch (err: any) {
    console.error("[auth] signIn caught", err);
    return { error: err?.message ?? "Unbekannter Fehler beim Login" };
  }
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

  try {
    console.log("[auth] code login start", code);
    // Anonymous Auth — mit Timeout falls Auth-Server hängt
    const { error: anonError } = await withTimeout(
      supabase.auth.signInAnonymously(),
      8000,
      "Anonymous-Auth"
    );
    if (anonError) {
      console.warn("[auth] anonymous signin failed", anonError.message);
      return { error: anonError.message };
    }
    console.log("[auth] anonymous signin ok, redeeming code …");

    // Code einlösen
    const sb: any = supabase;
    const { data, error } = await withTimeout<{ data: any; error: any }>(
      sb.rpc("redeem_invitation", { p_code: code }),
      8000,
      "Code-Einlösung"
    );
    if (error) {
      console.warn("[auth] redeem failed", error.message);
      return { error: error.message };
    }
    if (!data) return { error: "Code konnte nicht eingelöst werden" };

    const worker: Worker = {
      id: data.id,
      companyId: data.company_id,
      initials: data.initials,
      firstName: data.first_name,
      lastName: data.last_name,
      role: data.role,
      isAdmin: data.is_admin
    };
    login(worker);
    storeCode(code);
    console.log("[auth] code login ok", worker.firstName, worker.lastName);
    return { worker };
  } catch (err: any) {
    console.error("[auth] code login caught", err);
    return { error: err?.message ?? "Unbekannter Fehler" };
  }
}

/**
 * Stellt sicher, dass die lokale „eingeloggt"-Markierung NUR bestehen bleibt,
 * wenn es auch eine gültige Server-Anmeldung gibt. Verhindert den „Zombie-Login":
 * lokale Session lebt, Supabase-Anmeldung ist abgelaufen → Daten würden anonym
 * geladen (leere Listen) und Speichern scheitert an den Schutzregeln.
 *
 * - getSession() erneuert ein abgelaufenes Token automatisch, solange ein gültiger
 *   Refresh-Token vorliegt — nur wenn das endgültig fehlschlägt, gilt die Anmeldung
 *   als ungültig.
 * - OFFLINE-SICHER: Ohne Netz wird NICHT ausgeloggt (die App muss offline nutzbar
 *   bleiben, z.B. Stundenerfassung auf der Baustelle).
 *
 * Rückgabe: null = alles gut (gültig, offline, oder gar nicht eingeloggt).
 *           String = lokale Zombie-Session wurde verworfen, dorthin umleiten.
 */
export async function enforceValidSession(): Promise<string | null> {
  if (!supabase) return null;
  // getSession() kann in seltenen Fällen hängen (Web-Locks-/Token-Refresh-Hänger,
  // u.a. in Firefox) — dann dreht der "Anmeldung prüfen"-Schritt beim Speichern
  // endlos. Hart timeboxen wie alle anderen Auth-Calls: bei Timeout/Fehler die
  // lokale Anmeldung behalten und das Speichern fortsetzen (ein Hänger ist fast
  // nie eine echte Abmeldung — und schlägt die Session wirklich fehl, wirft der
  // eigentliche Speicher-Schritt einen klaren, sichtbaren Fehler statt ewig zu drehen).
  try {
    const { data: { session } } = await withTimeout(
      supabase.auth.getSession(), 8000, "Anmeldung prüfen"
    );
    if (session?.user) return null;       // gültige (ggf. frisch erneuerte) Anmeldung
  } catch {
    return null;                           // Timeout/Hänger → lokale Session behalten
  }
  if (!navigator.onLine) return null;     // offline → kein Urteil, lokale Session behalten
  const u = currentUser();
  if (!u) return null;                    // gar nicht „eingeloggt" → nichts zu tun
  // online + lokal eingeloggt, aber keine Server-Anmeldung → Auto-Reauth probieren,
  // wenn wir noch den ursprünglichen Code haben (Rick-Vorgabe: einmal eingeben reicht).
  const stored = getStoredCode();
  if (stored) {
    try {
      console.log("[auth] zombie session — auto-redeeming stored code");
      const res = await signInWithCode(stored);
      if (res.worker) {
        console.log("[auth] auto-reauth ok");
        return null;
      }
      console.warn("[auth] auto-reauth failed:", res.error);
    } catch (err) {
      console.warn("[auth] auto-reauth threw", err);
    }
  }
  // Auto-Reauth nicht möglich oder fehlgeschlagen → echte Abmeldung
  const dest = u.isAdmin ? "/buero" : "/login";
  logout();
  return dest;
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
    .select("id, company_id, initials, first_name, last_name, role, is_admin")
    .eq("auth_user_id", session.user.id)
    .single();

  if (error || !data) {
    // User authenticated, aber kein worker-Mapping
    return null;
  }

  const worker: Worker = {
    id: data.id,
    companyId: data.company_id,
    initials: data.initials,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    isAdmin: data.is_admin
  };
  login(worker);
  return worker;
}
