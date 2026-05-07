-- ============================================================
-- Leuschner · Stundenzettel · Seed-Daten für Erstinstallation
-- ============================================================
-- Anlegen NACH der Migration 20260508000000_init.sql.
-- Diese Daten ersetzen die Mock-Daten aus src/lib/mockData.ts.
-- ============================================================

-- 1) Firma anlegen
insert into companies (id, name, legal_name, address, vat_id) values
  ('00000000-0000-0000-0000-000000000001',
   'Rund um''s Haus Leuschner',
   'Rund um''s Haus Leuschner e.K.',
   'Industriestr. 4, 26826 Weener',
   null);

-- 2) Mitarbeiter (auth_user_id wird beim ersten Login via Einladungs-Code verknüpft)
insert into workers (id, company_id, initials, first_name, last_name, role, is_admin) values
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'RK', 'Rick', 'Kohlberg', 'Büro · Verwaltung', true),

  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'UL', 'Udo', 'Leuschner', 'Inhaber · Geschäftsführer', false),

  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   'WW', 'Wolfgang', 'Wilken', 'Inhaber · Geschäftsführer', false),

  ('00000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-000000000001',
   'MJ', 'Mathias', 'Jauken', 'Maschinist · Bagger', false);

-- 3) Stamm-Baustellen
insert into sites (company_id, name, street, city, geo_lat, geo_lng, starred) values
  ('00000000-0000-0000-0000-000000000001', 'Fam. Hoffmann',     'Wilhelmstr. 12',  '26789 Leer',         53.2306, 7.4577, true),
  ('00000000-0000-0000-0000-000000000001', 'Dr. Meents',        'Hauptstr. 84',    '26831 Bunde',        53.1810, 7.2630, true),
  ('00000000-0000-0000-0000-000000000001', 'Kita Stapelmoor',   'Schulstr. 5',     '26826 Stapelmoor',   53.1620, 7.3650, false),
  ('00000000-0000-0000-0000-000000000001', 'Nelkenweg 14',      'Nelkenweg 14',    '26826 Weener',       53.1640, 7.3500, false),
  ('00000000-0000-0000-0000-000000000001', 'Friedhof Weener',   'Hindenburgstr. 1','26826 Weener',       53.1665, 7.3580, false),
  ('00000000-0000-0000-0000-000000000001', 'Gewerbepark Bingum','Industriestr. 14','26789 Leer',         53.2410, 7.4400, false);
