-- ============================================================
-- Diagnose-Modul · zentrale Fehler-/Timeout-Erfassung
-- ============================================================
-- Stand 2026-06-16. Hintergrund: Fehler tauchen oft nur bei einem Nutzer
-- in einem bestimmten Browser auf (z.B. Firefox-Timeout beim Senden) und
-- sind für den Entwickler (Chrome) nicht reproduzierbar. Diese Tabelle
-- sammelt Fehler, Crashes und Timeouts samt Kontext (Browser, Nutzer,
-- Route), damit das Admin-Diagnose-Tab Muster erkennen kann.
--
-- Schreibpfad: NUR über die Cloudflare-Function /api/log mit Service-Role
-- (umgeht RLS). Clients schreiben NICHT direkt → keine Insert-Policy.
-- Lesepfad: nur Admin der eigenen Company.
-- Aufbewahrung: 30 Tage (Trigger prunt bei jedem Insert-Statement).
-- ============================================================

create table if not exists diag_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null default '00000000-0000-0000-0000-000000000001'
                   references companies(id) on delete cascade,
  ts             timestamptz not null default now(),
  level          text not null default 'error'
                   check (level in ('timeout','error','crash','warn','info')),
  label          text not null default '',     -- z.B. "Senden", "Worker-Sync"
  message        text not null default '',
  route          text,                          -- z.B. "/cheff-flow"
  browser        text,                          -- z.B. "Firefox 128"
  browser_family text,                          -- z.B. "Firefox" (für Gruppierung)
  os             text,                          -- z.B. "Windows 10/11"
  worker_id      uuid,                          -- nullable (Fehler vor Login)
  worker_name    text,
  app_version    text,                          -- Bundle-/Commit-Marker
  online         boolean,
  context        jsonb not null default '{}'::jsonb,  -- Stack, Quelle, Extras
  created_at     timestamptz not null default now()
);

create index if not exists diag_events_ts_idx       on diag_events (ts desc);
create index if not exists diag_events_level_idx     on diag_events (level);
create index if not exists diag_events_family_idx    on diag_events (browser_family);

alter table diag_events enable row level security;

-- Lesen: nur Admin der eigenen Company (analog inquiries/pipeline_cards).
drop policy if exists diag_events_select_admin on diag_events;
create policy diag_events_select_admin on diag_events
  for select using (is_admin() and company_id = current_company_id());

-- KEIN client-seitiges insert/update/delete — der /api/log-Endpoint
-- schreibt mit dem Service-Role-Key und umgeht RLS vollständig.

-- ── Aufbewahrung: alles älter als 30 Tage automatisch löschen ──────────
create or replace function prune_diag_events() returns trigger
  language plpgsql security definer as $$
begin
  delete from diag_events where ts < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists diag_events_prune on diag_events;
create trigger diag_events_prune
  after insert on diag_events
  for each statement execute function prune_diag_events();

-- ============================================================
-- Verifizierung nach dem Run:
--   - Anon-Key-Select muss [] liefern (RLS greift):
--     curl -s -H "apikey: <ANON_JWT>" \
--       "https://vejhsyrxpveunygyhqlo.supabase.co/rest/v1/diag_events?select=id&limit=1"
--   - Admin-App: /admin/diagnose zeigt Events nach dem ersten /api/log-POST
-- ============================================================
