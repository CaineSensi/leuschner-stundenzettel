-- Mitarbeiter-spezifische Arbeits-Wochentage.
-- Bisher implizit Mo-Fr fuer alle. Rick arbeitet aber nur Di + Do
-- (Teilzeit Bueroarbeit). Andere koennten nur Mo-Mi-Fr oder Wochenende
-- arbeiten.
--
-- Format: integer[] mit ISO-Wochentag (1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa, 7=So)
-- Default: ARRAY[1,2,3,4,5] (Mo-Fr)

alter table workers
  add column if not exists workdays integer[] not null default array[1,2,3,4,5];

comment on column workers.workdays is
  'ISO-Wochentage an denen der Mitarbeiter regulaer arbeitet (1=Mo .. 7=So). Basis fuer Soll-Berechnung und "frei"-Markierung im Stundenzettel.';

-- Rick: nur Di + Do
update workers
  set workdays = array[2, 4]
  where id = '00000000-0000-0000-0000-000000000010';
