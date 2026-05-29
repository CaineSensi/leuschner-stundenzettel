-- ============================================================
-- Stunden-Import Mai 2026 · Ewald  (Aushilfe)
-- ============================================================
-- Ausfuehren im Supabase SQL-Editor (service_role umgeht RLS).
--
-- Vorgabe (Rick 2026-05-29): 3 Wochen je 3 h + 4. Woche 2 h = 11 h gesamt,
-- jeweils auf EINEN Tag pro Woche gebucht (Tag egal). Baustelle GaLa Bau,
-- Gewerk GTN, 0 Min Pause.
--
-- !!! ACHTUNG VOR DEM AUSFUEHREN !!!
--   Nachname + Initialen von "Ewald" sind unbekannt -> unten die beiden
--   Platzhalter  last_name='NACHNAME_TODO'  und  initials='EW'  ersetzen.
-- ============================================================

begin;

-- 1) Sammel-Baustelle "GaLa Bau" (idempotent, falls noch nicht vorhanden)
insert into sites (id, company_id, name, city, starred)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000001',
  'GaLa Bau',
  '26826 Weener',
  false
)
on conflict (id) do nothing;

-- 2) Mitarbeiter Ewald neu anlegen (idempotent)
insert into workers (id, company_id, initials, first_name, last_name, role, is_admin, starts_on)
values (
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000001',
  'EW', 'Ewald', 'NACHNAME_TODO', 'Aushilfe', false, '2026-05-01'
)
on conflict (id) do nothing;

-- 3) Bestehende Mai-2026-Eintraege von Ewald loeschen (macht Import wiederholbar)
delete from entries
where worker_id = '00000000-0000-0000-0000-000000000015'
  and date between '2026-05-01' and '2026-05-31';

-- 4) Arbeitstage Ewald  (GaLa Bau / GTN / 0 Pause) -- 1 Tag je Woche, Summe 11 h
insert into entries (worker_id, date, entry_type, site_id, discipline, start_min, end_min, pause_min, submitted_at)
values
  ('00000000-0000-0000-0000-000000000015','2026-05-04','work','00000000-0000-0000-0000-0000000000a1','GTN',480,660,0,now()),  -- Wo1: 08:00-11:00 = 3,0h
  ('00000000-0000-0000-0000-000000000015','2026-05-11','work','00000000-0000-0000-0000-0000000000a1','GTN',480,660,0,now()),  -- Wo2: 08:00-11:00 = 3,0h
  ('00000000-0000-0000-0000-000000000015','2026-05-18','work','00000000-0000-0000-0000-0000000000a1','GTN',480,660,0,now()),  -- Wo3: 08:00-11:00 = 3,0h
  ('00000000-0000-0000-0000-000000000015','2026-05-26','work','00000000-0000-0000-0000-0000000000a1','GTN',480,600,0,now());  -- Wo4: 08:00-10:00 = 2,0h

commit;

-- ============================================================
-- KONTROLLE (nach commit): erwartet 11,0 h
-- select round(sum(end_min - start_min - pause_min)/60.0,2) as stunden_h
-- from entries
-- where worker_id = '00000000-0000-0000-0000-000000000015'
--   and date between '2026-05-01' and '2026-05-31';
-- ============================================================
