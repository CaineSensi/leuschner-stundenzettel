-- Pipeline-Seed · NUR REALE VORGÄNGE (Stand 2026-05-19).
-- Abgeleitet aus dem bereinigten Live-Bestand (9 echte sevDesk-Vorgänge).
-- Keine Platzhalter/Test-Karten mehr ("Privat"-Karten AN-1242/AN-1234
-- wurden am 19.05.2026 gelöscht, NICHT wieder einfügen).
-- Idempotent: löscht die Karten der Firma und legt die 9 realen neu an.
-- Im Supabase SQL-Editor oder via Management-API ausführen.
-- Texte mit echten Umlauten, keine Gedankenstriche (Projektregel).

delete from pipeline_cards
 where company_id = '00000000-0000-0000-0000-000000000001';

insert into pipeline_cards
  (company_id, stage, customer_name, place, description, value_eur,
   open_points, doc_number, valid_until, plan_eur, actual_eur, sort_order)
values
 -- Anfrage
 ('00000000-0000-0000-0000-000000000001','Anfrage','Diakoniestation Leer gGmbH',
  'Leer (Ostfriesland)',
  'Außenanlage: Pflasterung Eingangsbereich + Rasenmähkante',
  null,'Vor-Ort-Termin / Aufmaß planen',null,null,null,null,2),

 -- Angebot
 ('00000000-0000-0000-0000-000000000001','Angebot','Josef Borgmann',
  'Tunxdorferstraße 46 · 26871 Papenburg',
  'Doppelstabzaun 8/6/8 · 53 Matten (180/160/120) + 56 Pfosten + 3 Tore',
  10885.08,'Tore: Hesse-Preis offen · Rückruf erbeten','AN-1253',null,null,null,1),

 ('00000000-0000-0000-0000-000000000001','Angebot','Jan Hundertmark','Weener',
  'Doppelstabzaun + Sichtschutzstreifen, Fundamente, Aufbau',
  1546.08,'versendet','AN-1251','2026-05-28',null,null,1),

 ('00000000-0000-0000-0000-000000000001','Angebot','Jan Hundertmark','Weener',
  'Zaun zurückbauen + Neuaufbau, Entsorgung',
  2598.26,'versendet','AN-1250','2026-05-22',null,null,2),

 ('00000000-0000-0000-0000-000000000001','Angebot','Marco De Haan',
  'Leer (Ostfriesland)',
  'Gesamtprojekt 18k, Phase 2 (Zaun + Pflaster + Gartenmauer), nach Phase 1',
  18290.50,'Phase 2 zurückgestellt · Phase 1 läuft als AN-1254',
  'AN-1245','2026-04-16',null,null,3),

 ('00000000-0000-0000-0000-000000000001','Angebot','Marco De Haan',
  'Leer (Ostfriesland)',
  'Phase 1: Erdarbeiten + Drainage + Rasen + Rasenbord + Kiesstreifen (aus AN-1245 geschnürt)',
  6720.08,'Bagger auf 18 Std gesetzt · Rasenbord/Kiesstreifen-Mengen noch Schätzwerte · Telefonat offen',
  'AN-1254','2026-06-16',null,null,4),

 -- Auftrag
 ('00000000-0000-0000-0000-000000000001','Auftrag','Andrea Remmert',
  'Bunde · Auftrag 26-08',
  'Baggerarbeiten Kettenbagger 22 to. (16 Std) + Transport',
  4350.00,'Baustelle angelegt · Start KW 22','AN-1252',null,4350.00,null,1),

 -- In Arbeit
 ('00000000-0000-0000-0000-000000000001','In Arbeit','Andrea Remmert',
  'Leer · aktiv seit KW 19',
  'Terrasse + Drainage + Einfassung',
  7468.71,'Ist knapp, beobachten','AN-1226',null,7468.71,6572.00,2),

 -- Abgerechnet
 ('00000000-0000-0000-0000-000000000001','Abgerechnet','Andrea Remmert',
  'Bunde · aus AN-1243',
  'Pflasterarbeiten, Schlussrechnung',
  2061.34,'bezahlt · DATEV erledigt','RE-1254',null,2100.00,1972.00,1);
