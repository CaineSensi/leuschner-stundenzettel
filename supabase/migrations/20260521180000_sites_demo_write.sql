-- ============================================================
-- Sites · Demo-Write-Policy (temporär, bis Auth scharfgeschaltet wird)
-- ============================================================
-- Hintergrund: `sites_write_admin` aus 20260508000000_init.sql erlaubt
-- UPDATE/INSERT/DELETE nur wenn die Session is_admin() ist UND
-- company_id = current_company_id(). Im Anon-REST-Zugriff (so wie das
-- Frontend aktuell läuft) sind beide Bedingungen falsch → silent denial.
--
-- Folgen, die damit gefixt werden:
--   1. Auto-Geocoding in SiteDetail kann gespeicherte Koordinaten setzen
--   2. Marker-Drag persistiert die korrigierte Position
--   3. SiteEditor speichert Bearbeitungen
--
-- Beim RLS-Cleanup (TODO Phase 2 — demo-relax-Policies entfernen) muss
-- diese Policy mit weggehen.

drop policy if exists "demo_sites_write" on sites;
create policy "demo_sites_write" on sites
  for all using (true) with check (true);
