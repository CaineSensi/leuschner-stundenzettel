-- Testbaustelle · Leuschner-Firmensitz (Weener)
-- ──────────────────────────────────────────────────────────────────────────
-- Idempotente Insertion. Echte Adresse + GPS via Nominatim verifiziert.
-- Zweck: End-to-End-Test fuer Standortlogik, Karte, Routing, Geo-Verifikation.
--
-- Quelle Adresse: 11880.com, galabauleuschner.de
-- Quelle GPS:    Nominatim (OpenStreetMap), Industriestrasse im Industriegebiet Weener
--
-- Im Supabase-Dashboard: SQL Editor -> New query -> Inhalt einfuegen -> Run

insert into sites (
  id,
  company_id,
  name,
  project_number,
  street,
  city,
  starred,
  geo_lat,
  geo_lng,
  archived_at
)
values (
  -- feste UUID, damit Re-Run die selbe Zeile trifft
  '11111111-1111-1111-1111-111111111111'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'TEST · Leuschner Firmensitz',
  'TEST-001',
  'Industriestraße 4',
  '26826 Weener',
  false,
  53.1778,
  7.3581,
  null
)
on conflict (id) do update set
  name           = excluded.name,
  project_number = excluded.project_number,
  street         = excluded.street,
  city           = excluded.city,
  starred        = excluded.starred,
  geo_lat        = excluded.geo_lat,
  geo_lng        = excluded.geo_lng,
  archived_at    = excluded.archived_at;

-- Verifikation
select id, name, street, city, geo_lat, geo_lng
  from sites
 where id = '11111111-1111-1111-1111-111111111111'::uuid;
