import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * fetch mit hartem Abbruch (AbortController).
 *
 * WURZEL des „Timeout beim Senden / Nachrichten laden hängt"-Problems:
 * supabase-js bricht einen hängenden Request NIE selbst ab. Bleibt EIN fetch
 * hängen (typisch: der interne Token-Refresh auf /auth/v1/token, seltener ein
 * PostgREST-Call), blockiert er den Auth-Layer — und ALLE gleichzeitig laufenden
 * DB-Requests hängen mit. Genau das zeigte das Diagnose-Log: bis zu 5 „Nachrichten"-
 * Timeouts pro Minute, obwohl der Poll nur alle 30 s läuft, und ~190/Tag auch bei
 * nur einem Nutzer. Das app-seitige withTimeout meldete den Hänger nur — der echte
 * fetch lief im Hintergrund ewig weiter und vergiftete den Zustand für die nächsten
 * Polls.
 *
 * Mit diesem Abbruch wird ein hängender Request nach `ms` REAL gekillt: das SDK
 * rejected sauber, der Auth-Zustand wird frei, der nächste Versuch startet frisch.
 * Storage-Uploads (Bilder) bekommen großzügig Zeit; alles andere ein knappes Limit.
 * Ein bereits vorhandenes Abort-Signal (z.B. aus der App) wird respektiert.
 */
function abortableFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const reqUrl =
    typeof input === "string" ? input :
    input instanceof URL ? input.href :
    input instanceof Request ? input.url : String(input);
  const isStorage = reqUrl.includes("/storage/v1/");
  const ms = isStorage ? 60_000 : 12_000;

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException(`fetch-Abbruch nach ${ms}ms (${reqUrl})`, "TimeoutError")),
    ms
  );

  // Upstream-Signal (falls die App selbst eines mitgibt) mit unserem verketten
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) ctrl.abort(upstream.reason);
    else upstream.addEventListener("abort", () => ctrl.abort(upstream.reason), { once: true });
  }

  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export const supabase: SupabaseClient<Database> | null =
  url && key
    ? createClient<Database>(url, key, {
        global: {
          // Harter fetch-Abbruch — heilt die hängenden Requests an der Wurzel.
          fetch: abortableFetch
        },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Web-Locks-Bug umgehen: SDK hängt sonst beim Token-Refresh,
          // wenn ein anderer Tab die Lock hält oder eine alte Lock noch offen ist.
          lock: async (_name, _acquireTimeout, fn) => fn()
        }
      })
    : null;

export function isBackendConnected(): boolean {
  return supabase !== null;
}
