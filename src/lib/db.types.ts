// TypeScript types matching the Supabase schema (migrations/20260508000000_init.sql)
// Hand-pflegen oder via `supabase gen types typescript` regenerieren.

export type Database = {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          legal_name: string;
          address: string | null;
          vat_id: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["companies"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
      };
      workers: {
        Row: {
          id: string;
          company_id: string;
          auth_user_id: string | null;
          initials: string;
          first_name: string;
          last_name: string;
          role: string;
          is_admin: boolean;
          starts_on: string | null;
          ends_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["workers"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["workers"]["Row"]>;
      };
      sites: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          street: string | null;
          city: string | null;
          geo_lat: number | null;
          geo_lng: number | null;
          geofence_radius_m: number | null;
          starred: boolean;
          archived_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["sites"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sites"]["Row"]>;
      };
      entries: {
        Row: {
          id: string;
          worker_id: string;
          date: string;
          entry_type: "work" | "sick" | "vacation" | "holiday";
          site_id: string | null;
          discipline: "PFL" | "GTN" | "ZAU" | null;
          start_min: number | null;
          end_min: number | null;
          pause_min: number | null;
          weather: "sun" | "cloud" | "rain" | "snow" | null;
          geo_verified: boolean;
          geo_distance_m: number | null;
          end_date: string | null;
          note: string | null;
          submitted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["entries"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["entries"]["Row"]>;
      };
      invitations: {
        Row: {
          code: string;
          worker_id: string;
          invited_by: string | null;
          expires_at: string;
          used_at: string | null;
          device_id: string | null;
        };
        Insert: Database["public"]["Tables"]["invitations"]["Row"];
        Update: Partial<Database["public"]["Tables"]["invitations"]["Row"]>;
      };
      push_subscriptions: {
        Row: {
          id: string;
          worker_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["push_subscriptions"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]>;
      };
    };
    Functions: {
      current_worker_id: { Args: Record<string, never>; Returns: string };
      current_company_id: { Args: Record<string, never>; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
  };
};
