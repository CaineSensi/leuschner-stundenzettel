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

// ── Frühwarnung (Ebene 2) ───────────────────────────────────────────────
// Schlägt Alarm, wenn sich Timeouts häufen, statt dass es wochenlang
// unbemerkt im Log steht. Self-triggering: Timeouts erzeugen genau die
// Events, die diesen Check anstoßen — es braucht keinen Cron/Scheduler.
const SPIKE_THRESHOLD = 12;   // Timeouts im Fenster → Alarm
const SPIKE_WINDOW_MIN = 60;  // Beobachtungsfenster (Minuten)
const ALERT_DEDUP_HOURS = 6;  // nicht öfter als alle 6 h alarmieren

type Ctx = { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void };

async function maybeRaiseAlert(base: string, key: string): Promise<void> {
  try {
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    // 1) Timeouts im Fenster zählen (exakter Count via content-range)
    const since = new Date(Date.now() - SPIKE_WINDOW_MIN * 60_000).toISOString();
    const cntResp = await fetch(
      `${base}/rest/v1/diag_events?select=id&level=eq.timeout&ts=gte.${encodeURIComponent(since)}`,
      { headers: { ...h, Prefer: "count=exact", Range: "0-0" } }
    );
    const range = cntResp.headers.get("content-range") || "";   // z.B. "0-0/37"
    const count = Number(range.split("/")[1] || 0);
    if (!Number.isFinite(count) || count < SPIKE_THRESHOLD) return;

    // 2) Dedup: gab es kürzlich schon einen Alarm?
    const dedupSince = new Date(Date.now() - ALERT_DEDUP_HOURS * 3600_000).toISOString();
    const recent = await fetch(
      `${base}/rest/v1/diag_alerts?select=id&ts=gte.${encodeURIComponent(dedupSince)}&limit=1`,
      { headers: h }
    );
    const recentRows = recent.ok ? await recent.json() : [];
    if (Array.isArray(recentRows) && recentRows.length > 0) return;

    // 3) Alarm anlegen → die App zeigt ihn per Realtime als Banner
    await fetch(`${base}/rest/v1/diag_alerts`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        level: "timeout",
        title: "Häufung von Timeouts",
        message: `${count} Timeouts in den letzten ${SPIKE_WINDOW_MIN} Minuten — die App hängt vermutlich wieder beim Laden/Senden. Bitte Diagnose-Tab prüfen.`,
        count,
        window_minutes: SPIKE_WINDOW_MIN,
      }),
    });
  } catch (err: any) {
    console.warn("[/api/log] alert-check failed", String(err?.message ?? err).slice(0, 200));
  }
}

function clamp(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

export const onRequestPost = async ({ request, env, waitUntil }: Ctx) => {
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
    // Frühwarnung nur prüfen, wenn dieser Batch Timeouts enthält — dann im
    // Hintergrund (waitUntil), damit die /api/log-Antwort schnell bleibt.
    if (rows.some((r) => r.level === "timeout")) {
      const check = maybeRaiseAlert(base, key);
      if (waitUntil) waitUntil(check); else await check;
    }
    return new Response(null, { status: 204 });
  } catch (err: any) {
    console.warn("[/api/log] insert threw", String(err?.message ?? err).slice(0, 200));
    return new Response(JSON.stringify({ stored: false, reason: "exception" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
};
