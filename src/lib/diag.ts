// ============================================================
// Diagnose-Client · zentrale Fehler-/Timeout-Erfassung
// ============================================================
// Sammelt Fehler, Crashes und Timeouts im Browser und schickt sie
// gebündelt an /api/log (Cloudflare-Function → Supabase). Designprinzip:
//
//   1. Darf die App NIEMALS blockieren oder verlangsamen — strikt
//      fire-and-forget, eigener Sende-Pfad ohne Supabase-Client, alle
//      Fehler im Sende-Pfad werden verschluckt (kein Endlos-Loop).
//   2. Sammelt Kontext, der Muster sichtbar macht: Browser-Familie
//      (Firefox/Chrome), Nutzer, Route, online/offline.
//   3. Batching + sendBeacon, damit auch ein Crash/Tab-Schließen noch
//      übermittelt wird.
//
// WICHTIG: Diese Datei importiert NICHT aus auth.ts oder utils.ts
// (utils.ts importiert diag.ts → das wäre ein Zyklus). Der Worker-Kontext
// wird direkt aus dem localStorage gelesen.
// ============================================================

import { supabase } from "./supabase";

export type DiagLevel = "timeout" | "error" | "crash" | "warn" | "info";

interface DiagPayload {
  ts: string;
  level: DiagLevel;
  label: string;
  message: string;
  route?: string;
  browser?: string;
  browser_family?: string;
  os?: string;
  worker_id?: string | null;
  worker_name?: string | null;
  app_version?: string;
  online?: boolean;
  context?: Record<string, unknown>;
}

// Build-Stempel: wird in vite.config.ts via `define` zur Buildzeit ersetzt
// (Datum+Commit). Fallback auf VITE_APP_VERSION bzw. leer für Dev/Tests.
declare const __APP_VERSION__: string | undefined;
const APP_VERSION =
  (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined) ??
  ((import.meta as any).env?.VITE_APP_VERSION as string | undefined) ??
  "";

// ── Browser/OS einmalig bestimmen ───────────────────────────────────────
let UA: { browser: string; family: string; os: string } | null = null;
function uaInfo() {
  if (UA) return UA;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let family = "unbekannt";
  let version = "";
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Firefox\/(\d+)/))) { family = "Firefox"; version = m[1]; }
  else if ((m = ua.match(/Edg\/(\d+)/))) { family = "Edge"; version = m[1]; }
  else if ((m = ua.match(/OPR\/(\d+)/))) { family = "Opera"; version = m[1]; }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { family = "Chrome"; version = m[1]; }
  else if (/Safari/.test(ua) && (m = ua.match(/Version\/(\d+)/))) { family = "Safari"; version = m[1]; }
  let os = "unbekannt";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  UA = { family, browser: version ? `${family} ${version}` : family, os };
  return UA;
}

// ── Worker aus localStorage (ohne auth.ts zu importieren) ───────────────
function workerCtx(): { id: string | null; name: string | null } {
  try {
    const raw = localStorage.getItem("leuschner.session");
    if (!raw) return { id: null, name: null };
    const w = JSON.parse(raw)?.worker;
    if (!w) return { id: null, name: null };
    const name = [w.firstName, w.lastName].filter(Boolean).join(" ").trim();
    return { id: w.id ?? null, name: name || null };
  } catch {
    return { id: null, name: null };
  }
}

// ── Sammel-Queue + Versand ──────────────────────────────────────────────
const queue: DiagPayload[] = [];
const MAX_QUEUE = 50;          // Storm-Schutz: nie mehr als 50 puffern
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastKey = "";              // einfache Dedupe gegen identische Bursts
let lastAt = 0;
let initialized = false;

export function reportEvent(
  level: DiagLevel,
  label: string,
  message: string,
  context?: Record<string, unknown>
) {
  try {
    const now = Date.now();
    const key = `${level}|${label}|${message}`;
    // identisches Ereignis innerhalb 2 s → als Duplikat verwerfen
    if (key === lastKey && now - lastAt < 2000) return;
    lastKey = key; lastAt = now;

    if (queue.length >= MAX_QUEUE) queue.shift();

    const ua = uaInfo();
    const w = workerCtx();
    queue.push({
      ts: new Date(now).toISOString(),
      level,
      label: String(label ?? "").slice(0, 200),
      message: String(message ?? "").slice(0, 2000),
      route: typeof location !== "undefined" ? location.pathname : undefined,
      browser: ua.browser,
      browser_family: ua.family,
      os: ua.os,
      worker_id: w.id,
      worker_name: w.name,
      app_version: APP_VERSION,
      online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      context: context && typeof context === "object" ? context : undefined,
    });
    scheduleFlush();
  } catch {
    /* Diagnose darf nie selbst Fehler werfen */
  }
}

/** Bequemer Helfer für Timeouts (wird von withTimeout aufgerufen). */
export function reportTimeout(label: string, ms: number) {
  reportEvent("timeout", label, `Zeitüberschreitung: ${label} (${ms}ms)`, { ms });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(false); }, 1500);
}

function flush(useBeacon: boolean) {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  const body = JSON.stringify({ events: batch });
  try {
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
      return;
    }
    // Normalfall: keepalive-fetch (läuft auch bei laufender Navigation weiter).
    // Fehler werden bewusst verschluckt — kein Re-Report (Loop-Schutz).
    fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

/**
 * Einmalig beim App-Start aufrufen. Registriert das Übertragen beim
 * Tab-Schließen / Wegschalten, damit die letzten Ereignisse nicht verloren gehen.
 */
export function initDiag() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  uaInfo();
  const sendNow = () => flush(true);
  window.addEventListener("pagehide", sendNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendNow();
  });
}

// ============================================================
// LESE-SEITE (nur Admin-Diagnose-Tab) — über den Supabase-Client + RLS
// ============================================================

export interface DiagEvent {
  id: string;
  ts: string;
  level: DiagLevel;
  label: string;
  message: string;
  route: string | null;
  browser: string | null;
  browserFamily: string | null;
  os: string | null;
  workerId: string | null;
  workerName: string | null;
  appVersion: string | null;
  online: boolean | null;
  context: Record<string, unknown> | null;
}

function mapRow(r: any): DiagEvent {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level,
    label: r.label ?? "",
    message: r.message ?? "",
    route: r.route ?? null,
    browser: r.browser ?? null,
    browserFamily: r.browser_family ?? null,
    os: r.os ?? null,
    workerId: r.worker_id ?? null,
    workerName: r.worker_name ?? null,
    appVersion: r.app_version ?? null,
    online: r.online ?? null,
    context: r.context ?? null,
  };
}

/** Lädt die jüngsten Diagnose-Ereignisse (Admin-only via RLS). */
export async function listDiagEvents(opts?: { sinceIso?: string; limit?: number }): Promise<DiagEvent[]> {
  if (!supabase) return [];
  const sb: any = supabase;
  let q = sb
    .from("diag_events")
    .select("*")
    .order("ts", { ascending: false })
    .limit(opts?.limit ?? 500);
  if (opts?.sinceIso) q = q.gte("ts", opts.sinceIso);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map(mapRow);
}

// ── Frühwarnung (Ebene 2): Alarme aus diag_alerts ───────────────────────
export interface DiagAlert {
  id: string;
  ts: string;
  level: DiagLevel;
  title: string;
  message: string;
  count: number;
  windowMinutes: number;
  acknowledged: boolean;
}

function mapAlert(r: any): DiagAlert {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level ?? "timeout",
    title: r.title ?? "Hinweis",
    message: r.message ?? "",
    count: r.count ?? 0,
    windowMinutes: r.window_minutes ?? 60,
    acknowledged: r.acknowledged ?? false,
  };
}

/** Offene (nicht quittierte) Alarme — Admin-only via RLS. */
export async function listOpenAlerts(): Promise<DiagAlert[]> {
  if (!supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("diag_alerts")
    .select("*")
    .eq("acknowledged", false)
    .order("ts", { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return data.map(mapAlert);
}

/** Quittiert einen Alarm (verschwindet bei allen Admins via Realtime). */
export async function acknowledgeAlert(id: string): Promise<void> {
  if (!supabase) return;
  const sb: any = supabase;
  await sb.from("diag_alerts")
    .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
    .eq("id", id);
}

/** Lauscht auf neue Alarme (INSERT). Callback bekommt den Alarm. */
export function subscribeToAlerts(onNew: (a: DiagAlert) => void): () => void {
  if (!supabase) return () => {};
  const sb: any = supabase;
  const ch = sb.channel("diag-alerts")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "diag_alerts" },
      (payload: any) => onNew(mapAlert(payload.new)))
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch { /* ignore */ } };
}

export interface DiagPattern {
  key: string;
  level: DiagLevel;
  label: string;
  browserFamily: string;
  workers: string[];
  count24h: number;
  total: number;
  lastTs: string;
  sampleMessage: string;
  routes: string[];
}

/**
 * Verdichtet Ereignisse zu Mustern: gruppiert nach Label + Browser-Familie,
 * zählt die letzten 24 h. Ein Muster gilt als „aktiv", wenn count24h >= 3.
 * (Schwelle wird im UI angewandt — hier liefern wir alle Gruppen, sortiert.)
 */
export function buildPatterns(events: DiagEvent[], nowMs: number): DiagPattern[] {
  const since24h = nowMs - 24 * 3600 * 1000;
  const groups = new Map<string, DiagPattern>();
  for (const e of events) {
    if (e.level === "info") continue;
    const fam = e.browserFamily ?? "unbekannt";
    const key = `${e.level}|${e.label}|${fam}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, level: e.level, label: e.label || "(ohne Label)",
        browserFamily: fam, workers: [], count24h: 0, total: 0,
        lastTs: e.ts, sampleMessage: e.message, routes: [],
      };
      groups.set(key, g);
    }
    g.total += 1;
    if (new Date(e.ts).getTime() >= since24h) g.count24h += 1;
    if (e.ts > g.lastTs) { g.lastTs = e.ts; g.sampleMessage = e.message; }
    if (e.workerName && !g.workers.includes(e.workerName)) g.workers.push(e.workerName);
    if (e.route && !g.routes.includes(e.route)) g.routes.push(e.route);
  }
  return [...groups.values()].sort((a, b) =>
    b.count24h - a.count24h || b.total - a.total || b.lastTs.localeCompare(a.lastTs)
  );
}
