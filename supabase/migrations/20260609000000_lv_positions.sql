-- Leistungsverzeichnis-Positionen
-- Festpreise (kein Von-Bis), Zulagen als Prozent-Aufschläge
create table if not exists lv_positions (
  id           text primary key,
  company_id   uuid not null references companies(id) on delete cascade,
  cat          text not null,
  name         text not null,
  price        numeric,
  unit         text,
  surcharge    text,
  short_text   text,
  long_text    text,
  zulagen      text[] not null default '{}',
  used_count   int not null default 0,
  last_used    date,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists lv_positions_company_idx on lv_positions(company_id);
create index if not exists lv_positions_cat_idx     on lv_positions(company_id, cat);

alter table lv_positions enable row level security;

create policy lv_select on lv_positions
  for select using (company_id = current_company_id());

create policy lv_write on lv_positions
  for all
  using  (is_admin() and company_id = current_company_id())
  with check (is_admin() and company_id = current_company_id());

-- ============================================================
-- Seed: Leuschner Rund um's Haus, Weener/Ostfriesland
-- Festpreise netto, Zulagen als %-Aufschläge auf den EP
-- ============================================================

insert into lv_positions
  (id, company_id, cat, name, price, unit, surcharge, short_text, long_text, zulagen)
values

-- ERD
('ERD-001','00000000-0000-0000-0000-000000000001','ERD',
  'Oberboden abtragen und lagern',
  11,'m²',null,
  'Oberboden bis 30 cm Tiefe abtragen, seitlich lagern, für Wiedereinbau vorhalten.',
  'Oberboden bis 30 cm Tiefe abtragen, seitlich lagern, für Wiedereinbau vorhalten. Einbautiefe nach Aufmaß. Abfuhr gesondert.',
  '{ERR-002,ERR-010}'),

('ERD-002','00000000-0000-0000-0000-000000000001','ERD',
  'Bodenaushub Fundament/Unterbau',
  26,'m³',null,
  'Aushub für Fundamente, Pflasterunterbau oder Drainage bis 1,20 m Tiefe. Material laden und abfahren.',
  'Aushub für Fundamente, Pflasterunterbau oder Drainage bis 1,20 m Tiefe. Material laden und abfahren. Bodenklasse 3 bis 5 nach DIN 18300. Klei/Torf als Homogenbereich gesondert.',
  '{ERR-002,ERR-003,ERR-010,ERR-011}'),

('ERD-003','00000000-0000-0000-0000-000000000001','ERD',
  'Frostschutzschicht einbauen, verdichten',
  27,'m²',null,
  'Frostschutzschicht 0/45 mm Brechsand-Splitt-Gemisch, mind. 20 cm, lagenweise einbauen und verdichten.',
  'Frostschutzschicht 0/45 mm Brechsand-Splitt-Gemisch, Schichtdicke nach Planung (mind. 20 cm), lagenweise einbauen und verdichten. Verdichtungsnachweis auf Anforderung.',
  '{ERR-002,ERR-010}'),

('ERD-004','00000000-0000-0000-0000-000000000001','ERD',
  'Oberboden aufbringen und einarbeiten',
  16,'m²',null,
  'Gelagerter oder angelieferter Oberboden aufbringen, profilgerecht einbauen, feinplanieren.',
  'Gelagerter oder angelieferter Oberboden aufbringen, profilgerecht einbauen, feinplanieren. Schichtdicke 15 bis 25 cm. Steine über 5 cm aussortieren.',
  '{ERR-001,ERR-002}'),

('ERD-005','00000000-0000-0000-0000-000000000001','ERD',
  'Aushub entsorgen, Klei-/Torfboden',
  55,'t',null,
  'Aushub aus Klei- oder Torfboden zur Deponie abfahren und entsorgen. Wiegeschein inklusive.',
  'Aushub aus Klei- oder Torfboden zur Deponie abfahren und entsorgen. Klei und Torf sind im Nordseeküstenbereich kaum als Recycling-Material verwertbar. Wiegeschein inklusive. Preis gilt für Nettogewicht.',
  '{}'),

-- PFL
('PFL-001','00000000-0000-0000-0000-000000000001','PFL',
  'Betonpflaster verlegen, Standardformat',
  28,'m²',null,
  'Betonpflastersteine bis 20x20 cm auf Bettungsschicht verlegen, fugen, verdichten. Inkl. Materialverlust 5 %.',
  'Betonpflastersteine im Standardformat bis 20x20 cm auf vorbereitete Bettungsschicht (Brechsand/Splitt 2/5 mm) verlegen. Fugen mit Fugensand verfüllen, Rüttelverdichtung, Fugen nachfüllen und abkehren. Inkl. Materialverlust 5 %. Randabschluss gesondert. Unterbau gesondert. Hinweis Region Weener: Bei Klei- oder Moorboden Bodenaustausch bis ca. 80 cm Tiefe erforderlich (ERR-010). Bei hohem Grundwasserspiegel Wasserhaltung zusätzlich (ERR-011).',
  '{ERR-001,ERR-002,ERR-005,ERR-010,ERR-011}'),

('PFL-002','00000000-0000-0000-0000-000000000001','PFL',
  'Betonpflaster verlegen, Großformat ab 40x40 cm',
  41,'m²',null,
  'Betonplatten ab 40x40 cm verlegen. Verlegezange oder Kransatz erforderlich. Inkl. Materialverlust 3 %.',
  'Betonplatten ab Format 40x40 cm auf vorbereitete Bettungsschicht verlegen. Wegen Eigengewicht Verlegezange oder Kransatz erforderlich. Fugen 3 bis 5 mm, Fugenmörtel oder Fugensand, Rüttelverdichtung. Inkl. Materialverlust 3 %. Randabschluss gesondert.',
  '{ERR-001,ERR-002,ERR-003,ERR-010}'),

('PFL-003','00000000-0000-0000-0000-000000000001','PFL',
  'Natursteinpflaster verlegen, gespalten/geflammt',
  62,'m²',null,
  'Natursteinpflaster aus Granit oder Basalt auf Splitt 2/5 mm verlegen. Fugen mit Trasszement vergießen. Natursteinmaterial gesondert.',
  'Natursteinpflaster aus Granit oder Basalt, gespalten oder geflammt, in Reihenverband oder unregelmäßigem Verband auf Splitt 2/5 mm verlegen. Fugen mit Fugenmörtel (Trasszement) vergießen. Kanten und Ecken zuschneiden. Natursteinmaterial gesondert. Inkl. Zuschnitt-Verlust ca. 8 %. Zuschnitt vor Ort = VOB Besondere Leistung, wird gesondert ausgewiesen.',
  '{ERR-001,ERR-002}'),

('PFL-004','00000000-0000-0000-0000-000000000001','PFL',
  'Pflasterfläche aufnehmen, sortiert lagern',
  12,'m²',null,
  'Vorhandenen Pflasterbelag sorgfältig aufnehmen, Steine reinigen, sortieren, auf Paletten stapeln.',
  'Vorhandenen Pflasterbelag sorgfältig aufnehmen ohne Beschädigung der Steine. Steine von Mörtel- und Bettungsresten reinigen, sortieren und auf Europaletten stapeln. Lagerort auf Grundstück nach Absprache. Bettungsmaterial gesondert entsorgen. Wiederverwendbarkeit nicht garantiert.',
  '{ERR-002,ERR-003}'),

('PFL-005','00000000-0000-0000-0000-000000000001','PFL',
  'Borde und Randsteine setzen, einbetonieren',
  36,'lfm',null,
  'Betonbordsteine 8x25x100 cm auf Betonstreifenfundament C16/20 setzen. Fugen mit Trasszementmörtel vergießen.',
  'Betonbordsteine 8x25x100 cm auf Betonstreifenfundament C16/20 setzen. Rückseite mit Beton C16/20 sichern. Fugen mit Trasszementmörtel vergießen und glätten. Bordstein-Material inkl. Höhenausgleich +-5 cm ohne Mehrkosten. Fundamentaushub gesondert. Hinweis Region Weener: Kleiböden erfordern tieferes Fundament (bis 60 cm). Ausführung nur bei Frost über 0 Grad C. Bei Grundwasser in Aushubtiefe Wasserhaltung zusätzlich (ERR-011).',
  '{ERR-001,ERR-002,ERR-005,ERR-010,ERR-011}'),

('PFL-006','00000000-0000-0000-0000-000000000001','PFL',
  'Pflasterfugen schließen, Fugensand einschlämmen',
  5.50,'m²',null,
  'Offene oder ausgespülte Fugen reinigen, Polymerfugensand aufbringen, einschlämmen, zweiter Durchgang nach Trocknung.',
  'Offene oder ausgespülte Fugen reinigen (Unkraut, Schmutz entfernen). Polymerfugensand aufbringen, mit Wasser einschlämmen, überschüssiges Material abkehren. Zweiter Durchgang nach Trocknung. Nur bei Temperaturen +5 Grad C bis +30 Grad C ausführen.',
  '{ERR-009}'),

-- GTN
('GTN-001','00000000-0000-0000-0000-000000000001','GTN',
  'Rollrasen verlegen inkl. Mähkante',
  18,'m²',null,
  'Rollrasen auf vorbereitetes Saatbett verlegen, andrücken, wässern, Mähkante anbringen. Inkl. Rollrasenmaterial.',
  'Rollrasen auf vorbereitetes Saatbett verlegen, andrücken, wässern, Mähkante aus Kunststoff oder Alu anbringen. Inkl. Rollrasenmaterial.',
  '{ERR-001,ERR-002}'),

('GTN-002','00000000-0000-0000-0000-000000000001','GTN',
  'Rasenfläche anlegen, Ansaat',
  8,'m²',null,
  'Fläche feinplanieren, Rasensaat gleichmäßig ausbringen, einharken, walzen, wässern. Saatgut Gebrauchsrasen RSM 3.1.',
  'Fläche feinplanieren, Rasensaat gleichmäßig ausbringen, einharken, walzen, wässern. Saatgut Gebrauchsrasen RSM 3.1.',
  '{ERR-001}'),

('GTN-003','00000000-0000-0000-0000-000000000001','GTN',
  'Beet anlegen, Pflanzsubstrat einbringen',
  49,'m²',null,
  'Beetfläche tiefgründig lockern, Pflanzsubstrat 20 cm einarbeiten, mulchen. Pflanzgut gesondert.',
  'Beetfläche tiefgründig lockern, Pflanzsubstrat 20 cm einarbeiten, Gehölze/Stauden pflanzen, mulchen. Pflanzgut nach Auftraggeber-Wahl gesondert.',
  '{ERR-002}'),

('GTN-004','00000000-0000-0000-0000-000000000001','GTN',
  'Hecke/Gehölze schneiden',
  30,'Std',null,
  'Formgehölze oder Hecken fachgerecht schneiden, Schnittgut zerkleinern und entsorgen. Höhe bis 2,50 m inkl.',
  'Formgehölze oder Hecken fachgerecht schneiden, Schnittgut zerkleinern und entsorgen. Höhe bis 2,50 m inkl.',
  '{ERR-002,ERR-009}'),

('GTN-005','00000000-0000-0000-0000-000000000001','GTN',
  'Gehölze pflanzen, bis Höhe 200 cm',
  50,'Stk',null,
  'Pflanzgrube ausheben, Substrat einarbeiten, einpflanzen, wässern, Pfahl und Kokosseil. Pflanzware gesondert.',
  'Pflanzgrube ausheben, Pflanzsubstrat einarbeiten, Gehölz einpflanzen, wässern, Pfahl und Kokosseil. Pflanzware gesondert.',
  '{ERR-002}'),

-- ZAU
('ZAU-001','00000000-0000-0000-0000-000000000001','ZAU',
  'Zaunpfosten setzen, einbetonieren',
  62,'Stk',null,
  'Zaunpfosten Ø 60 mm in vorbereitetes Loch setzen, mit Beton C20/25 einbetonieren, Tiefe 60 bis 80 cm.',
  'Zaunpfosten Ø 60 mm oder 60x60 mm in vorbereitetes Loch setzen, mit Beton C20/25 einbetonieren, Tiefe 60 bis 80 cm je nach Bodenbeschaffenheit. Hinweis Weener: Kleiböden erhöhen Lochtiefe auf 80 bis 100 cm.',
  '{ERR-002,ERR-003,ERR-005,ERR-010}'),

('ZAU-002','00000000-0000-0000-0000-000000000001','ZAU',
  'Doppelstabmatten montieren',
  33,'m²',null,
  'Doppelstabmatte 6/5/6 mm verzinkt an vorhandenen Pfosten montieren, inkl. Klemmschellen und Schrauben.',
  'Doppelstabmatte 6/5/6 mm verzinkt an vorhandenen Pfosten montieren, inkl. Klemmschellen, Abstandshalter, Schrauben.',
  '{ERR-002}'),

('ZAU-003','00000000-0000-0000-0000-000000000001','ZAU',
  'Sichtschutzzaun, Holzlattung',
  61,'m²',null,
  'Sichtschutz aus kesseldruckimprägnierter Holzlattung, Lattenabstand 10 mm, auf Pfosten montieren.',
  'Sichtschutz aus kesseldruckimprägnierter Holzlattung, Lattenabstand 10 mm, auf Pfosten montieren, Oberkante absägen und schräg abdecken.',
  '{ERR-002}'),

('ZAU-004','00000000-0000-0000-0000-000000000001','ZAU',
  'Zaunanlage demontieren, entsorgen',
  20,'m²',null,
  'Vorhandene Zaunanlage inkl. Pfosten demontieren, Material zur Deponie abfahren. Inkl. Entsorgungsgebühren.',
  'Vorhandene Zaunanlage inkl. Pfosten demontieren, Betonfundament ausbauen, Material zur Deponie abfahren. Inkl. Entsorgungsgebühren.',
  '{ERR-002,ERR-003}'),

-- VWG (Stundenlohn nur wo unvermeidlich)
('VWG-001','00000000-0000-0000-0000-000000000001','VWG',
  'Aufmaß vor Ort, Dokumentation',
  75,'Std',null,
  'Aufmaß auf der Baustelle durchführen, Skizze und Maßprotokoll anfertigen, Fotodokumentation.',
  'Aufmaß auf der Baustelle durchführen, Skizze und Maßprotokoll anfertigen, Fotodokumentation, digital übergeben.',
  '{}'),

('VWG-002','00000000-0000-0000-0000-000000000001','VWG',
  'Bauleitung, Koordination Subunternehmer',
  85,'Std',null,
  'Örtliche Bauleitung, Koordination von Gewerken, Protokollführung, Abnahme, Mängelrügen.',
  'Örtliche Bauleitung, Koordination von Gewerken, Protokollführung, Abnahme, Mängelrügen. Nach tatsächlichem Aufwand.',
  '{}'),

-- ERR (Erschwernis-Zulagen, kein Festpreis sondern prozentualer Aufschlag)
('ERR-001','00000000-0000-0000-0000-000000000001','ERR',
  'Hanglage ab 25 % Gefälle (1:4)',
  null,null,'+15 %',
  'Aufschlag bei Geländesteigung oder -gefälle ab 25 % (1:4). VOB DIN 18320 §4: Besondere Leistung.',
  'Aufschlag bei Geländesteigung oder -gefälle ab 25 % (= 1:4). Gilt für alle Erdarbeiten, Pflaster- und Zaunarbeiten. Maschineneinsatz und Sicherungsmaßnahmen erhöht. VOB DIN 18320 §4: Flächen mit Neigung über 1:4 sind Besondere Leistung. Praxiswert für Leuschner Weener: +15 % auf Einheitspreis.',
  '{}'),

('ERR-002','00000000-0000-0000-0000-000000000001','ERR',
  'Schwer zugänglich, Handtransport über 20 m',
  null,null,'+20 %',
  'Zuschlag wenn Maschinen nicht bis auf 5 m heranfahren können. Enge Hofstellen, schmale Wirtschaftswege.',
  'Zuschlag wenn Maschinen nicht bis auf 5 m an die Arbeitsstelle heranfahren können. Material muss per Schubkarre oder Hand transportiert werden. Praxiswert GaLaBau Ostfriesland: +20 % auf EP.',
  '{}'),

('ERR-003','00000000-0000-0000-0000-000000000001','ERR',
  'Maschineneinsatz eingeschränkt, nur Kleingerät',
  null,null,'+25 %',
  'Aufschlag wenn nur Minibagger unter 1,5 t oder Handschachtung möglich.',
  'Aufschlag wenn kein Bagger, nur Minibagger unter 1,5 t oder Handschachtung möglich (Innenhöfe, enge Einfahrten, Treppen). Praxiswert GaLaBau: +25 % auf EP.',
  '{}'),

('ERR-004','00000000-0000-0000-0000-000000000001','ERR',
  'Bestehender Belag aufbrechen, entsorgen',
  null,null,'+12,00 €/m²',
  'Asphalt, Beton oder alter Pflasterbelag aufbrechen, laden und entsorgen. Inkl. Deponiegebühren.',
  'Asphalt, Beton oder alter Pflasterbelag aufbrechen, laden und entsorgen. Inkl. Deponiegebühren. Festbetrag je m².',
  '{}'),

('ERR-005','00000000-0000-0000-0000-000000000001','ERR',
  'Boden gefroren, Frostaufbruch',
  null,null,'+25 %',
  'Mehraufwand bei gefrorenem Boden. Frosttiefe Niedersachsen typisch 20 bis 40 cm.',
  'Mehraufwand bei gefrorenem Boden. Frosttiefe Niedersachsen typisch 20 bis 40 cm. Hinweis Ostfriesland: atlantisches Klima, wenige harte Frosttage (unter 20 pro Jahr).',
  '{}'),

('ERR-006','00000000-0000-0000-0000-000000000001','ERR',
  'Nachtarbeit (22 bis 5 Uhr)',
  null,null,'+20 %',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 4 für Arbeiten zwischen 22:00 und 5:00 Uhr.',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 4 für Arbeiten zwischen 22:00 und 5:00 Uhr. Bei gleichzeitiger Mehrarbeit: +50 %. Steuerfrei bis gesetzliche Höchstgrenze §3b EStG.',
  '{}'),

('ERR-007','00000000-0000-0000-0000-000000000001','ERR',
  'Sonntagsarbeit',
  null,null,'+50 %',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 2. Bei Zusammentreffen mehrerer Zuschläge gilt nur der höhere.',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 2. Bei Zusammentreffen mehrerer Zuschläge gilt nur der höhere. Steuerfrei bis gesetzliche Höchstgrenze §3b EStG.',
  '{}'),

('ERR-008','00000000-0000-0000-0000-000000000001','ERR',
  'Feiertagsarbeit',
  null,null,'+150 %',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 3 für lohnzahlungspflichtige gesetzliche Feiertage.',
  'Tariflicher Zuschlag BRTV GaLaBau §5 Abs. 3 für lohnzahlungspflichtige gesetzliche Feiertage. Höchster Tarifsatz im GaLaBau.',
  '{}'),

('ERR-009','00000000-0000-0000-0000-000000000001','ERR',
  'Schmutz- und Staubschutzmaßnahmen',
  null,null,'+10 %',
  'Aufschlag wenn Schutzmaßnahmen für angrenzende Gebäude oder Bepflanzungen erforderlich.',
  'Aufschlag wenn Schutzmaßnahmen für angrenzende Gebäude, Bepflanzungen oder öffentlichen Verkehr erforderlich. Staubschutzfolien, Bauzäune, Reinigung nach Abschluss inkl. BRTV GaLaBau §10: Tätigkeitsbezogener Erschwerniszuschlag +10 %.',
  '{}'),

('ERR-010','00000000-0000-0000-0000-000000000001','ERR',
  'Klei-/Moorboden, Bodenaustausch erforderlich',
  null,null,'+30 %',
  'Region Weener/Rheiderland: Kleiböden und Torfböden erfordern Bodenaustausch bis frostsichere Tiefe.',
  'In der Region Weener/Rheiderland treten häufig Kleiböden (schwerer mariner Lehm, geringe Tragfähigkeit) und Torf-/Moorböden (organisch, setzungsempfindlich) auf. Bodenaustausch bis frostsichere Tiefe (ca. 80 cm) mit gebrochener Tragschicht 0/45 mm erforderlich. Nach VOB DIN 18300: eigener Homogenbereich.',
  '{}'),

('ERR-011','00000000-0000-0000-0000-000000000001','ERR',
  'Grundwasser angetroffen, Wasserhaltung',
  null,null,'+200,00 €/Tag',
  'Ostfriesland: Grundwasser häufig bei 40 bis 80 cm unter Gelände. Tauchpumpe und Wasserhaltung pro Arbeitstag.',
  'Im Norddeutschen Tiefland, insbesondere Ostfriesland, steht Grundwasser häufig bei 40 bis 80 cm unter Gelände. Bei Aushubarbeiten über 30 cm Tiefe Wasserhaltung mit Tauchpumpe regelmäßig erforderlich. Nach VOB DIN 18305 §4: Besondere Leistung. Pauschale pro Arbeitstag. Strom durch Auftraggeber oder gesondert.',
  '{}')

on conflict (id) do nothing;
