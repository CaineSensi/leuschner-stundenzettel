import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient<Database> | null =
  url && key
    ? createClient<Database>(url, key, {
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
