// Server-seitiger Endpoint für das Diagnose-Modul. Nimmt Fehler-/Timeout-
// Ereignisse vom Browser entgegen (auch per navigator.sendBeacon beim
// Tab-Schließen) und schreibt sie mit dem Service-Role-Key in die Tabelle
// diag_events (umgeht RLS — Clients dürfen NICHT direkt schreiben).
//
// Robust by design: antwortet immer schnell und wirft nie 500 in einer Weise,
// die den Client zu Retries verleitet (der Client ist ohnehin fire-and-forget).

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

const FALLBACK_URL = "https://vejhsyrxpveunygyhqlo.supabase.co";
const ALLOWED_LEVELS = new Set(["timeout", "error", "crash", "warn", "info"]);
const MAX_EVENTS = 100;

type Ctx = { request: Request; env: Env };

function clamp(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

export const onRequestPost = async ({ request, env }: Ctx) => {
  // Body defensiv lesen — kaputtes JSON darf keinen 500 erzeugen.
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const rawEvents: any[] = Array.isArray(payload?.events)
    ? payload.events
    : payload && typeof payload === "object"
      ? [payload]
      : [];
  if (rawEvents.length === 0) return new Response(null, { status: 204 });

  const rows = rawEvents.slice(0, MAX_EVENTS).map((e) => {
    const level = ALLOWED_LEVELS.has(e?.level) ? e.level : "error";
    return {
      ts: clamp(e?.ts, 40) ?? new Date().toISOString(),
      level,
      label: clamp(e?.label, 200) ?? "",
      message: clamp(e?.message, 2000) ?? "",
      route: clamp(e?.route, 300),
      browser: clamp(e?.browser, 120),
      browser_family: clamp(e?.browser_family, 60),
      os: clamp(e?.os, 60),
      worker_id: typeof e?.worker_id === "string" ? e.worker_id : null,
      worker_name: clamp(e?.worker_name, 120),
      app_version: clamp(e?.app_version, 120),
      online: typeof e?.online === "boolean" ? e.online : null,
      context: e?.context && typeof e.context === "object" ? e.context : {},
    };
  });

  const key = env.SUPABASE_SERVICE_KEY;
  if (!key) {
    // Kein Schlüssel gesetzt → wir können nicht speichern, aber der Client
    // soll nicht hängen/wiederholen. Sichtbar im Function-Log.
    console.warn("[/api/log] SUPABASE_SERVICE_KEY fehlt — Ereignisse verworfen:", rows.length);
    return new Response(JSON.stringify({ stored: false, reason: "no-service-key" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const base = (env.SUPABASE_URL || FALLBACK_URL).replace(/\/$/, "");
  try {
    const resp = await fetch(`${base}/rest/v1/diag_events`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      console.warn("[/api/log] insert failed", resp.status, detail);
      return new Response(JSON.stringify({ stored: false, status: resp.status }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  } catch (err: any) {
    console.warn("[/api/log] insert threw", String(err?.message ?? err).slice(0, 200));
    return new Response(JSON.stringify({ stored: false, reason: "exception" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
};
