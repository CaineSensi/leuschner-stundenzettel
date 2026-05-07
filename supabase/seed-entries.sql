-- ============================================================
-- Seed-Einträge für KW 19 / 2026 (Demo-Daten)
-- Idempotent: vorhandene Einträge dieser Woche werden zuerst gelöscht.
-- ============================================================

delete from entries
  where date >= '2026-05-04' and date <= '2026-05-10';

-- Mathias Jauken — komplette Woche (38,0 h)
insert into entries (worker_id, date, entry_type, site_id, discipline, start_min, end_min, pause_min, weather, geo_verified, submitted_at)
values
  ('00000000-0000-0000-0000-000000000013', '2026-05-04', 'work', (select id from sites where name = 'Fam. Hoffmann'      limit 1), 'PFL', 420, 930, 30, 'sun',   true,  now()),
  ('00000000-0000-0000-0000-000000000013', '2026-05-05', 'work', (select id from sites where name = 'Fam. Hoffmann'      limit 1), 'PFL', 420, 930, 30, 'sun',   true,  now()),
  ('00000000-0000-0000-0000-000000000013', '2026-05-06', 'work', (select id from sites where name = 'Gewerbepark Bingum' limit 1), 'PFL', 420, 960, 30, 'cloud', true,  now()),
  ('00000000-0000-0000-0000-000000000013', '2026-05-07', 'work', (select id from sites where name = 'Gewerbepark Bingum' limit 1), 'PFL', 420, 960, 30, 'cloud', true,  now()),
  ('00000000-0000-0000-0000-000000000013', '2026-05-08', 'work', (select id from sites where name = 'Nelkenweg 14'       limit 1), 'PFL', 420, 750, 30, 'sun',   false, now());

-- Wolfgang Wilken — Vorarbeiter, volle Woche (41,0 h)
insert into entries (worker_id, date, entry_type, site_id, discipline, start_min, end_min, pause_min, weather, geo_verified, note, submitted_at)
values
  ('00000000-0000-0000-0000-000000000012', '2026-05-04', 'work', (select id from sites where name = 'Fam. Hoffmann'   limit 1), 'PFL', 420,  990, 30, 'sun',   true,  null,                           now()),
  ('00000000-0000-0000-0000-000000000012', '2026-05-05', 'work', (select id from sites where name = 'Fam. Hoffmann'   limit 1), 'PFL', 420,  990, 30, 'sun',   true,  null,                           now()),
  ('00000000-0000-0000-0000-000000000012', '2026-05-06', 'work', (select id from sites where name = 'Friedhof Weener' limit 1), 'GTN', 450,  930, 30, 'cloud', true,  null,                           now()),
  ('00000000-0000-0000-0000-000000000012', '2026-05-07', 'work', (select id from sites where name = 'Fam. Hoffmann'   limit 1), 'PFL', 420, 1020, 30, 'rain',  true,  'Pflastersteine geliefert · 2 t', now()),
  ('00000000-0000-0000-0000-000000000012', '2026-05-08', 'work', (select id from sites where name = 'Fam. Hoffmann'   limit 1), 'PFL', 420,  810, 30, 'sun',   true,  null,                           now());
