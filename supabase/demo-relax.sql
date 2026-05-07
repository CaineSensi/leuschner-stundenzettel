-- ============================================================
-- DEMO-PHASE · Temporäre Lese-Lockerung  (idempotent)
-- ============================================================
-- Diese Datei kann beliebig oft ausgeführt werden — alte
-- Demo-Policies werden zuerst entfernt, dann neu angelegt.
-- ============================================================

drop policy if exists "demo_workers_read"   on workers;
drop policy if exists "demo_sites_read"     on sites;
drop policy if exists "demo_entries_read"   on entries;
drop policy if exists "demo_companies_read" on companies;

create policy "demo_workers_read"   on workers   for select using (true);
create policy "demo_sites_read"     on sites     for select using (true);
create policy "demo_entries_read"   on entries   for select using (true);
create policy "demo_companies_read" on companies for select using (true);
