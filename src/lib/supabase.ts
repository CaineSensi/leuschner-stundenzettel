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
          detectSessionInUrl: true
        }
      })
    : null;

export function isBackendConnected(): boolean {
  return supabase !== null;
}
