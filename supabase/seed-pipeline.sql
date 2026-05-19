-- Beispiel-Pipeline (10 Karten) — echte Leuschner/sevDesk-Daten.
-- Idempotent: löscht vorhandene Seed-Karten der Firma und legt neu an.
-- Im Supabase SQL-Editor oder via Management-API ausführen.

delete from pipeline_cards
 where company_id = '00000000-0000-0000-0000-000000000001';

insert into pipeline_cards
  (company_id, stage, customer_name, place, description, value_eur,
   open_points, doc_number, valid_until, plan_eur, actual_eur, sort_order)
values
 ('00000000-0000-0000-0000-000000000001','Anfrage','Josef Borgmann',
  'Tunxdorferstraße 46 · 26871 Papenburg',
  'Doppelstabzaun 8/6/8 · 53 Matten (180/160/120) + 56 Pfosten + 3 Tore',
  9333.74,'Tore: Hesse-Preis offen · Rückruf erbeten','AN-1253',null,null,null,1),

 ('00000000-0000-0000-0000-000000000001','Anfrage','Diakoniestation Leer gGmbH',
  'Leer (Ostfriesland)',
  'Außenanlage: Pflasterung Eingangsbereich + Rasenmähkante',
  null,'Vor-Ort-Termin / Aufmaß planen',null,null,null,null,2),

 ('00000000-0000-0000-0000-000000000001','Angebot','Jan Hundertmark','Weener',
  'Doppelstabzaun + Sichtschutzstreifen, Fundamente, Aufbau',
  1546.08,'versendet','AN-1251','2026-05-28',null,null,1),

 ('00000000-0000-0000-0000-000000000001','Angebot','Jan Hundertmark','Weener',
  'Zaun zurückbauen + Neuaufbau, Entsorgung',
  2598.26,'versendet','AN-1250','2026-05-22',null,null,2),

 ('00000000-0000-0000-0000-000000000001','Angebot','Privat · Großprojekt','Bunde',
  'Drainage + Gartenmauer + Pflaster + Rhombuszaun + Rasen (39 Pos.)',
  18290.50,'Gültigkeit abgelaufen — nachfassen!','AN-1245','2026-04-16',null,null,3),

 ('00000000-0000-0000-0000-000000000001','Auftrag','Andrea Remmert',
  'Bunde · Auftrag 26-08',
  'Baggerarbeiten Kettenbagger 22 to. (16 Std) + Transport',
  4350.00,'Baustelle angelegt · Start KW 22','AN-1252',null,4350.00,null,1),

 ('00000000-0000-0000-0000-000000000001','Auftrag','Privat','Weener',
  'Pflaster Hofeinfahrt + Randsteine in Beton',
  4426.25,'Material: 4 Positionen offen','AN-1242',null,4426.25,null,2),

 ('00000000-0000-0000-0000-000000000001','In Arbeit','Privat',
  'Weener · aktiv seit KW 20',
  'Pflaster ums Haus + Zaun + Rasen + Palisaden (35 Pos.)',
  5334.56,null,'AN-1234',null,5334.56,3307.00,1),

 ('00000000-0000-0000-0000-000000000001','In Arbeit','Privat',
  'Leer · aktiv seit KW 19',
  'Terrasse + Drainage + Einfassung',
  7468.71,'Ist knapp — beobachten','AN-1226',null,7468.71,6572.00,2),

 ('00000000-0000-0000-0000-000000000001','Abgerechnet','Andrea Remmert',
  'Bunde · aus AN-1243',
  'Pflasterarbeiten — Schlussrechnung',
  2061.34,'bezahlt · DATEV ✓','RE-1254',null,2100.00,1972.00,1);
