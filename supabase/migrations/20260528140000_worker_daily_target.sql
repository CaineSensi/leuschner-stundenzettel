-- Mitarbeiter-spezifisches Tagessoll (Minuten).
-- Hintergrund: bislang implizit 8h/Tag fuer alle. Rick arbeitet aber nur
-- 5h pro Tag (Teilzeit Bueroarbeit), andere Mitarbeiter 8h.
-- Brauchen wir, damit Feiertag/Urlaub/Krank in der Stunden-Auswertung
-- mit dem korrekten Tagessoll bezahlt werden (Feiertagslohn = uebliche
-- Stunden, nicht pauschal 8h).
--
-- Wertbereich: 0..1440. Default 480 (= 8h).

alter table workers
  add column if not exists daily_target_minutes integer not null default 480
  check (daily_target_minutes >= 0 and daily_target_minutes <= 1440);

comment on column workers.daily_target_minutes is
  'Soll-Arbeitszeit pro Arbeitstag in Minuten. Bezahlungsbasis fuer Feiertag/Urlaub/Krank.';

-- Rick (Buero, 5h) gleich richtig setzen
update workers
  set daily_target_minutes = 300
  where id = '00000000-0000-0000-0000-000000000010';
