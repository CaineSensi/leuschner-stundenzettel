-- ============================================================
-- RLS-Härtung · entfernt Demo-Policies, setzt echte auth-basierte
-- ============================================================
-- Stand: 2026-05-28. Hintergrund: in der Sprint-Phase wurden Tabellen mit
-- demo_all-Policies (using true / with check true) ausgestattet, damit
-- die App ohne fertigen Auth-Flow lokal nutzbar war. Jetzt:
--
--   - alle demo_*-Policies werden gedroppt
--   - Tabellen mit company_id → select-policy via current_company_id()
--   - Tabellen mit nur site_id → lookup über sites.company_id
--   - Schreibrechte nur für Admin (is_admin()) und nur in eigener Company
--   - parse_corrections: admin-only (Wizard läuft im Admin-Bereich)
--
-- Vorab-Checks (Stand 2026-05-28):
--   ✓ Cloudflare-Pages-Functions (/api/llm/*, /api/weather, /api/sevdesk)
--     greifen NICHT direkt auf die DB zu — keine Service-Role nötig.
--   ✓ Worker Rick (id 00000000-…-0010) hat auth_user_id gesetzt + is_admin=true
--   ✓ Helper-Functions is_admin/current_company_id/current_worker_id sind
--     `security definer` → ignorieren RLS, kein Bootstrap-Problem.
--
-- Rollback bei Bug: einzelne *_demo_all-Policies wieder anlegen
-- (Inhalte siehe Original-Migrations 20260512160000, 20260519120000 etc.)
-- ============================================================

-- ────────────────────────────────────────────────────────────────────
-- 1) DROP alle Demo-Policies
-- ────────────────────────────────────────────────────────────────────

-- Auf init-Tabellen (whatsapp-onboarding-Setup-Phase, nie in Code committed)
drop policy if exists demo_workers_read   on workers;
drop policy if exists demo_sites_read     on sites;
drop policy if exists demo_entries_read   on entries;
drop policy if exists demo_companies_read on companies;
drop policy if exists "demo_sites_write"  on sites;

-- Auf Sprint-Tabellen
drop policy if exists site_materials_demo_all on site_materials;
drop policy if exists site_invoices_demo_all  on site_invoices;
drop policy if exists pipeline_cards_demo_all on pipeline_cards;
drop policy if exists inquiries_demo_all      on inquiries;
drop policy if exists customers_demo_all      on customers;
drop policy if exists site_questions_demo_all on site_questions;

-- Auf parse_corrections (Anon-Read + Anon-Insert)
drop policy if exists parse_corrections_read_anon  on parse_corrections;
drop policy if exists parse_corrections_write_anon on parse_corrections;

-- ────────────────────────────────────────────────────────────────────
-- 2) ECHTE Policies — Tabellen MIT company_id
-- ────────────────────────────────────────────────────────────────────

-- ── pipeline_cards ──────────────────────────────────────────────────
create policy pipeline_cards_select_company on pipeline_cards
  for select using (company_id = current_company_id());

create policy pipeline_cards_write_admin on pipeline_cards
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());

-- ── customers ───────────────────────────────────────────────────────
create policy customers_select_company on customers
  for select using (company_id = current_company_id());

create policy customers_write_admin on customers
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());

-- ── inquiries ───────────────────────────────────────────────────────
create policy inquiries_select_company on inquiries
  for select using (company_id = current_company_id());

create policy inquiries_write_admin on inquiries
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());

-- ── site_questions ──────────────────────────────────────────────────
create policy site_questions_select_company on site_questions
  for select using (company_id = current_company_id());

create policy site_questions_write_admin on site_questions
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());

-- ────────────────────────────────────────────────────────────────────
-- 3) ECHTE Policies — Tabellen MIT NUR site_id (Lookup über sites)
-- ────────────────────────────────────────────────────────────────────

-- ── site_materials ──────────────────────────────────────────────────
create policy site_materials_select_company on site_materials
  for select using (
    site_id in (select id from sites where company_id = current_company_id())
  );

create policy site_materials_write_admin on site_materials
  for all using (
    is_admin() and site_id in (select id from sites where company_id = current_company_id())
  ) with check (
    is_admin() and site_id in (select id from sites where company_id = current_company_id())
  );

-- ── site_invoices ───────────────────────────────────────────────────
create policy site_invoices_select_company on site_invoices
  for select using (
    site_id in (select id from sites where company_id = current_company_id())
  );

create policy site_invoices_write_admin on site_invoices
  for all using (
    is_admin() and site_id in (select id from sites where company_id = current_company_id())
  ) with check (
    is_admin() and site_id in (select id from sites where company_id = current_company_id())
  );

-- ────────────────────────────────────────────────────────────────────
-- 4) parse_corrections — admin only
-- ────────────────────────────────────────────────────────────────────

create policy parse_corrections_admin on parse_corrections
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());

-- ============================================================
-- Verifizierung nach dem Run (Hand-Test mit Anon-Key):
--   curl -s -H "apikey: <ANON_JWT>" \
--     "https://vejhsyrxpveunygyhqlo.supabase.co/rest/v1/inquiries?select=id&limit=1"
--   → erwartet: [] (leeres Array, kein 200 mit Daten)
-- Plus: Admin-App im Browser muss noch funktionieren
-- (Sites, Stunden, Pipeline alle sichtbar).
-- ============================================================
