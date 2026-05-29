-- ============================================================
-- Ewald Helyenga als Aushilfe konfigurieren  (2026-05-29)
-- ============================================================
-- Vorgabe (Rick): Ewald bekommt KEINE Feiertage bezahlt.
--
-- Hintergrund: Feiertag/Urlaub/Krank werden in der Auswertung mit dem
-- Tagessoll (daily_target_minutes) bezahlt. Default = 480 Min (8h) ->
-- darum tauchten 01./14./25.05. mit je 8,00 h auf.
--
-- Fix: Tagessoll = 0  -> Feiertage zahlen 0 h. Nur tatsaechlich
-- erfasste Arbeitsstunden (Ende-Beginn) zaehlen. Worked-Stunden sind
-- davon unabhaengig -> seine 11 h bleiben.
--
-- Ausfuehren im Supabase SQL-Editor (service_role).
-- ============================================================

begin;

-- (1) ESSENZIELL: kein Feiertags-/Urlaubs-/Kranklohn
update workers
set daily_target_minutes = 0
where id = '00000000-0000-0000-0000-000000000015';   -- Ewald Helyenga

-- (2) OPTIONAL, empfohlen fuer Aushilfe ohne feste Tage:
--     keine festen Arbeits-Wochentage -> kein Soll, keine falschen
--     "Luecken" und kein -133h-Saldo im Nachweis. Nur echte Eintragstage
--     erscheinen mit Stunden, der Rest als "frei".
update workers
set workdays = '{}'
where id = '00000000-0000-0000-0000-000000000015';   -- Ewald Helyenga

commit;

-- ============================================================
-- KONTROLLE: erwartet Tagessoll 0, Σ Monat = 11,00 h (Feiertage 0)
-- ============================================================
-- select first_name, last_name, daily_target_minutes, workdays
-- from workers where id = '00000000-0000-0000-0000-000000000015';
