-- VOB-Bereinigung · Leuschner · 11.6.2026
-- Einheiten, Kurztexte, Namensbereinigung, Material-Archivierung

-- ─────────────────────────────────────────────────────────────
-- 1. Material-Positionen archivieren (keine Leistungen)
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET archived_at = NOW() WHERE id IN (
  'ERD-169',  -- Stützenfuß (Kaufteil)
  'PFL-125',  -- Plattenbag Asbest (Verpackungsmaterial)
  'PFL-127',  -- Big Bag Asbest (Verpackungsmaterial)
  'SON-013',  -- Montageschaum (Material)
  'SON-017',  -- MEA-Befestigungsset (Material)
  'ZAU-127'   -- Pfostenträger (Kaufteil)
);

-- ─────────────────────────────────────────────────────────────
-- 2. ERD – Erdarbeiten
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Bagger- und Radladerarbeiten',         unit='h',     short_text='Bagger- und Radladerarbeiten, nach Aufwand (Stundenlohn).'                                        WHERE archived_at IS NULL AND id='ERD-100';
UPDATE lv_positions SET name='Brechsand einbauen und verdichten',    unit='m²',    short_text='Brechsand liefern, verteilen und maschinell verdichten.'                                            WHERE archived_at IS NULL AND id='ERD-101';
UPDATE lv_positions SET name='Aushub / Abfälle entsorgen',           unit='t',     short_text='Erdaushub oder Abfälle abtransportieren und entsorgen.'                                             WHERE archived_at IS NULL AND id='ERD-102';
UPDATE lv_positions SET name='Schotter einbauen und verdichten',     unit='m²',    short_text='Schotter liefern, verteilen und maschinell verdichten.'                                             WHERE archived_at IS NULL AND id='ERD-103';
UPDATE lv_positions SET name='Füllsand einbauen und verdichten',     unit='m³',    short_text='Füllsand liefern, einbauen und lagenweise verdichten.'                                              WHERE archived_at IS NULL AND id='ERD-104';
UPDATE lv_positions SET name='Bauschutt entsorgen',                  unit='Psch',  short_text='Bauschutt aufnehmen, abtransportieren und fachgerecht entsorgen, pauschal.'                        WHERE archived_at IS NULL AND id='ERD-105';
UPDATE lv_positions SET name='Rohr ausrichten und anschließen',      unit='Stk',   short_text='Vorhandenes Rohr ausrichten, dichten und Anschluss herstellen.'                                    WHERE archived_at IS NULL AND id='ERD-106';
UPDATE lv_positions SET name='ACO Drain Rinne setzen und anschließen', unit='lfm', short_text='ACO Drain Rinne in Betonbett setzen, ausrichten und an Entwässerung anschließen.'                  WHERE archived_at IS NULL AND id='ERD-107';
UPDATE lv_positions SET name='Mutterboden einbauen',                 unit='m³',    short_text='Mutterboden einbauen, verteilen und einebnen.'                                                      WHERE archived_at IS NULL AND id='ERD-108';
UPDATE lv_positions SET name='Betonfundament herstellen',            unit='m³',    short_text='Schalung stellen, Beton (mind. C16/20) einbringen und verdichten, Schalung entfernen.'             WHERE archived_at IS NULL AND id='ERD-109';
UPDATE lv_positions SET name='Frachtkosten Fremd-LKW',               unit='Fuhre', short_text='Frachtkosten für Fremd-LKW-Transport, je Fuhre.'                                                   WHERE archived_at IS NULL AND id='ERD-110';
UPDATE lv_positions SET name='Betonfundament entfernen',             unit='m³',    short_text='Betonfundament aufbrechen, aufnehmen und entsorgen.'                                               WHERE archived_at IS NULL AND id='ERD-111';
UPDATE lv_positions SET name='Grabaushub, 2 Mitarbeiter',            unit='m³',    short_text='Grabaushub von Hand und/oder maschinell mit 2 Mitarbeitern.'                                       WHERE archived_at IS NULL AND id='ERD-112';
UPDATE lv_positions SET name='Entwässerung herstellen (KG-Rohr)',    unit='Psch',  short_text='Entwässerungsanlage mit KG-Rohr und Ablauf herstellen, pauschal je Anlage.'                        WHERE archived_at IS NULL AND id='ERD-113';
UPDATE lv_positions SET name='Boden verdichten',                     unit='m²',    short_text='Tragschicht oder Unterbau maschinell verdichten.'                                                   WHERE archived_at IS NULL AND id='ERD-114';
UPDATE lv_positions SET name='Kabel verlegen im Erdreich',           unit='lfm',   short_text='Kabel im Erdreich verlegen, einschließlich Sandschüttung und Abdeckung.'                           WHERE archived_at IS NULL AND id='ERD-115';
UPDATE lv_positions SET name='Kiesbeet zurückbauen',                 unit='m²',    short_text='Kiesbeet aufnehmen, Kies abtransportieren, Fläche reinigen.'                                       WHERE archived_at IS NULL AND id='ERD-116';
UPDATE lv_positions SET name='Betonfundament mit Stahleinlage entsorgen', unit='Psch', short_text='Bewehrtes Betonfundament aufbrechen, aufnehmen und fachgerecht entsorgen, pauschal.'           WHERE archived_at IS NULL AND id='ERD-117';
UPDATE lv_positions SET name='Fundament für Gartenmauer herstellen', unit='Psch',  short_text='Streifenfundament für Gartenmauer ausheben, betonieren und ausschalen, pauschal.'                  WHERE archived_at IS NULL AND id='ERD-118';
UPDATE lv_positions SET name='Drainage erstellen',                   unit='Psch',  short_text='Graben ausheben, Filterflies einlegen, Drainagerohr verlegen und einbetten, Graben schließen.'     WHERE archived_at IS NULL AND id='ERD-119';
UPDATE lv_positions SET name='Rohrverstopfung lokalisieren',         unit='Psch',  short_text='Rohrverstopfung orten, freilegen und beheben.'                                                      WHERE archived_at IS NULL AND id='ERD-120';
UPDATE lv_positions SET name='Rohre umlegen',                        unit='Psch',  short_text='Vorhandene Rohre vorsichtig freilegen, umverlegen und neu einbetten, pauschal.'                    WHERE archived_at IS NULL AND id='ERD-121';
UPDATE lv_positions SET name='Geotextilvlies verlegen',              unit='m²',    short_text='Geotextilvlies zuschneiden und verlegen, Überlappung mind. 30 cm.'                                 WHERE archived_at IS NULL AND id='ERD-122';
UPDATE lv_positions SET name='Grabaushub, mehrere Mitarbeiter',      unit='m³',    short_text='Grabaushub von Hand mit mehreren Mitarbeitern bei beengten Verhältnissen.'                         WHERE archived_at IS NULL AND id='ERD-123';
UPDATE lv_positions SET name='Abpumparbeiten',                       unit='h',     short_text='Angestautes Wasser abpumpen, einschließlich Geräteaufwand.'                                        WHERE archived_at IS NULL AND id='ERD-124';
UPDATE lv_positions SET name='Pumparbeiten',                         unit='h',     short_text='Pumparbeiten nach Aufwand.'                                                                         WHERE archived_at IS NULL AND id='ERD-125';
UPDATE lv_positions SET name='Abwasserschacht setzen',               unit='Stk',   short_text='Fertigteil-Abwasserschacht setzen, ausrichten und anschließen.'                                    WHERE archived_at IS NULL AND id='ERD-126';
UPDATE lv_positions SET name='Grube schließen und verdichten',       unit='m³',    short_text='Graben oder Grube lagenweise verfüllen und maschinell verdichten.'                                 WHERE archived_at IS NULL AND id='ERD-127';
UPDATE lv_positions SET name='Treppenstufe abbrechen und neu verkleben', unit='Stk', short_text='Defekte Treppenstufe abbrechen, Untergrund säubern, neue Stufe kleben.'                          WHERE archived_at IS NULL AND id='ERD-128';
UPDATE lv_positions SET name='Fallrohr instandsetzen',               unit='Stk',   short_text='Defektes Fallrohr reparieren oder erneuern und wieder befestigen.'                                 WHERE archived_at IS NULL AND id='ERD-129';
UPDATE lv_positions SET name='L-Borte setzen',                       unit='lfm',   short_text='L-Bordstein auf Betonbett verlegen und ausrichten.'                                                WHERE archived_at IS NULL AND id='ERD-130';
UPDATE lv_positions SET name='Treppenstufe herstellen',              unit='Stk',   short_text='Treppenstufe herstellen durch Mauern oder Kleben, inkl. Untergrundvorbereitung.'                  WHERE archived_at IS NULL AND id='ERD-131';
UPDATE lv_positions SET name='Mehraufwand L-Borte',                  unit='lfm',   short_text='Mehraufwand L-Borte bei erschwerter Lage (Kurven, Einzelstücke).'                                  WHERE archived_at IS NULL AND id='ERD-132';
UPDATE lv_positions SET name='Fundamente für Carport herstellen',    unit='Stk',   short_text='Einzelfundamente für Carport ausheben, betonieren und ausschalen, je Stütze.'                     WHERE archived_at IS NULL AND id='ERD-133';
UPDATE lv_positions SET name='Treppenstufe in Beton erstellen',      unit='Stk',   short_text='Treppenstufe in Ortbeton: schalen, betonieren, ausschalen.'                                        WHERE archived_at IS NULL AND id='ERD-134';
UPDATE lv_positions SET name='Bordstein in Beton setzen',            unit='lfm',   short_text='Bordstein auf Betonbett setzen, ausrichten und mit Beton hinterfüllen.'                            WHERE archived_at IS NULL AND id='ERD-135';
UPDATE lv_positions SET name='Steinabfall entsorgen',                unit='t',     short_text='Steinabfall aufnehmen, abtransportieren und entsorgen.'                                            WHERE archived_at IS NULL AND id='ERD-136';
UPDATE lv_positions SET name='Sand entsorgen',                       unit='t',     short_text='Sand aufnehmen, abtransportieren und entsorgen.'                                                   WHERE archived_at IS NULL AND id='ERD-137';
UPDATE lv_positions SET name='Baggerarbeiten',                       unit='h',     short_text='Baggerarbeiten nach Aufwand, einschließlich Maschineneinsatz.'                                     WHERE archived_at IS NULL AND id='ERD-138';
UPDATE lv_positions SET name='Weg verfüllen und verdichten',         unit='m³',    short_text='Graben oder Weg lagenweise verfüllen und verdichten.'                                              WHERE archived_at IS NULL AND id='ERD-139';
UPDATE lv_positions SET name='Treppenstufe entfernen',               unit='Stk',   short_text='Treppenstufe abbrechen und entsorgen.'                                                             WHERE archived_at IS NULL AND id='ERD-140';
UPDATE lv_positions SET name='Fläche einspülen und ansäen',          unit='m²',    short_text='Fläche einspülen, glätten und mit Rasensamen ansäen.'                                             WHERE archived_at IS NULL AND id='ERD-141';
UPDATE lv_positions SET name='Boden auskoffern',                     unit='m³',    short_text='Boden auf Planumstiefe auskoffern und abtransportieren.'                                           WHERE archived_at IS NULL AND id='ERD-142';
UPDATE lv_positions SET name='Parkplatzfläche herstellen',           unit='m²',    short_text='Parkplatzfläche herstellen: auskoffern, Schotter, verdichten, Deckschicht.'                        WHERE archived_at IS NULL AND id='ERD-143';
UPDATE lv_positions SET name='Fläche einebnen und auffüllen',        unit='m²',    short_text='Fläche einebnen, ggf. mit Füllmaterial auffüllen und planieren.'                                  WHERE archived_at IS NULL AND id='ERD-144';
UPDATE lv_positions SET name='ACO Drain Rinne einbauen',             unit='lfm',   short_text='ACO Drain Rinne komplett einbauen: Bett herstellen, Rinne setzen, anschließen.'                   WHERE archived_at IS NULL AND id='ERD-145';
UPDATE lv_positions SET name='Kabelkanal in Beton flexen und stemmen', unit='lfm', short_text='Kabelkanal in Betondecke oder -wand flexen und aufstemmen, Breite bis 10 cm.'                     WHERE archived_at IS NULL AND id='ERD-146';
UPDATE lv_positions SET name='Hofablauf herstellen und anpassen',    unit='Stk',   short_text='Hofablauf unter Wasserhahn herstellen, an Gitterrost anpassen und einbauen.'                       WHERE archived_at IS NULL AND id='ERD-147';
UPDATE lv_positions SET name='Rohr freistemmen, Verrohrung herstellen', unit='Psch', short_text='Rohr freistemmen, Verrohrung herstellen, lagenweise verdichten, Hofablauf anschließen.'         WHERE archived_at IS NULL AND id='ERD-148';
UPDATE lv_positions SET name='Grasnabe fräsen, Mutterboden auffüllen und ansäen', unit='m²', short_text='Grasnabe durchfräsen, Mutterboden anfüllen, angleichen und einsäen.'                   WHERE archived_at IS NULL AND id='ERD-149';
UPDATE lv_positions SET name='Noppenbahn anbringen',                 unit='m²',    short_text='Noppenbahn auf Untergrund auflegen, überlappen und befestigen.'                                    WHERE archived_at IS NULL AND id='ERD-150';
UPDATE lv_positions SET name='Regenwasserablauf instandsetzen',      unit='Stk',   short_text='Defekten Regenwasserablauf freilegen, reparieren und wieder verschließen.'                         WHERE archived_at IS NULL AND id='ERD-151';
UPDATE lv_positions SET name='Sondermüll Rigips entsorgen',          unit='t',     short_text='Rigips-Abfall (Sondermüll) aufnehmen, abtransportieren und fachgerecht entsorgen.'                WHERE archived_at IS NULL AND id='ERD-152';
UPDATE lv_positions SET name='Abwasserschacht instandsetzen',        unit='Stk',   short_text='Abwasserschacht öffnen, Schäden beheben und wieder verschließen.'                                  WHERE archived_at IS NULL AND id='ERD-153';
UPDATE lv_positions SET name='Regenwasserschacht sanieren',          unit='Stk',   short_text='Regenwasserschacht sanieren, mit Beton vergießen, Deckel aufsetzen.'                               WHERE archived_at IS NULL AND id='ERD-154';
UPDATE lv_positions SET name='Schacht einbauen (Neubau)',            unit='Stk',   short_text='Neuen Schacht einbauen, setzen, ausrichten und anschließen.'                                       WHERE archived_at IS NULL AND id='ERD-155';
UPDATE lv_positions SET name='L-Steine setzen',                      unit='lfm',   short_text='L-Steine auf Betonbett setzen, ausrichten und hinterfüllen.'                                      WHERE archived_at IS NULL AND id='ERD-156';
UPDATE lv_positions SET name='Kellerschacht zurückbauen',            unit='Stk',   short_text='Bestehenden Kellerschacht vorsichtig demontieren und fachgerecht entsorgen.'                       WHERE archived_at IS NULL AND id='ERD-157';
UPDATE lv_positions SET name='Kellerschacht montieren (Neubau)',     unit='Stk',   short_text='Neuen Kellerschacht einbauen, abdichten und befestigen.'                                           WHERE archived_at IS NULL AND id='ERD-158';
UPDATE lv_positions SET name='Fallrohr einbauen',                    unit='lfm',   short_text='Neues Fallrohr einbauen, ausrichten und befestigen.'                                               WHERE archived_at IS NULL AND id='ERD-159';
UPDATE lv_positions SET name='Kanalschacht verschließen',            unit='Stk',   short_text='Kanalschacht verschließen, Rohre absanden und abdichten.'                                          WHERE archived_at IS NULL AND id='ERD-160';
UPDATE lv_positions SET name='Hochbeet erstellen',                   unit='Stk',   short_text='Hochbeet aus vorgegebenem Material erstellen, inkl. Befüllung.'                                   WHERE archived_at IS NULL AND id='ERD-161';
UPDATE lv_positions SET name='Mehraufwand Boden auskoffern',         unit='m³',    short_text='Mehraufwand für Bodenauskofferung bei erschwertem Untergrund.'                                     WHERE archived_at IS NULL AND id='ERD-162';
UPDATE lv_positions SET name='Container für Erdaushub',              unit='Stk',   short_text='Container für lehmhaltigen Mischboden bestellen, stellen und abfahren lassen.'                    WHERE archived_at IS NULL AND id='ERD-163';
UPDATE lv_positions SET name='Treppenstufe entfernen',               unit='Stk',   short_text='Treppenstufe abbrechen und entsorgen.'                                                             WHERE archived_at IS NULL AND id='ERD-164';
UPDATE lv_positions SET name='Gefälle verändern für Schmutzwasserschacht', unit='Psch', short_text='Vorhandenes Rohr-Gefälle verändern, um Schmutzwasserschacht anzupassen.'                    WHERE archived_at IS NULL AND id='ERD-165';
UPDATE lv_positions SET name='Stemmarbeiten',                        unit='h',     short_text='Stemmarbeiten in Beton oder Mauerwerk, nach Aufwand.'                                              WHERE archived_at IS NULL AND id='ERD-166';
UPDATE lv_positions SET name='Eternit entsorgen',                    unit='Psch',  short_text='Eternitabfälle aufnehmen, fachgerecht verpacken und entsorgen (Sonderabfall).'                    WHERE archived_at IS NULL AND id='ERD-167';
UPDATE lv_positions SET name='Asbestentsorgung (Kostenschätzung)',   unit='Psch',  short_text='Geschätzte Kosten für Asbestentsorgung gemäß geltenden Vorschriften, pauschal.'                   WHERE archived_at IS NULL AND id='ERD-168';
UPDATE lv_positions SET name='Rohrgraben herstellen',                unit='lfm',   short_text='Rohrgraben ausheben, Rohrbett herstellen, nach Verlegung verfüllen und verdichten.'               WHERE archived_at IS NULL AND id='ERD-170';
UPDATE lv_positions SET name='Stemmarbeiten Fundament',              unit='h',     short_text='Stemmarbeiten an Fundamenten oder Betonbauteilen, nach Aufwand.'                                  WHERE archived_at IS NULL AND id='ERD-171';
UPDATE lv_positions SET name='Hofablauf einbauen',                   unit='Stk',   short_text='Hofablauf einbauen, einpassen und an Entwässerung anschließen.'                                   WHERE archived_at IS NULL AND id='ERD-172';
UPDATE lv_positions SET name='Steine aufnehmen und abtransportieren', unit='m²',   short_text='Pflastersteine oder Platten aufnehmen, sortieren und abtransportieren.'                           WHERE archived_at IS NULL AND id='ERD-173';
UPDATE lv_positions SET name='Treppenstufe neu verfugen',            unit='Stk',   short_text='Fugen reinigen, vorbereiten und Treppenstufe neu verfugen.'                                        WHERE archived_at IS NULL AND id='ERD-174';

-- ─────────────────────────────────────────────────────────────
-- 3. PFL – Pflasterarbeiten
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Pflasterarbeiten',                     unit='m²',    short_text='Pflastern mit vorhandenem oder beigestelltem Material, inkl. Bettung.'                            WHERE archived_at IS NULL AND id='PFL-100';
UPDATE lv_positions SET name='Rütteln, schneiden und einschlämmen',  unit='m²',    short_text='Pflasterfläche rütteln, Kanten schneiden und mit Sand einschlämmen.'                              WHERE archived_at IS NULL AND id='PFL-101';
UPDATE lv_positions SET name='Bordstein in Beton setzen',            unit='lfm',   short_text='Bordsteine auf Betonbett setzen, ausrichten und hinterfüllen.'                                    WHERE archived_at IS NULL AND id='PFL-102';
UPDATE lv_positions SET name='Pflasterung aufnehmen und Rückbau',    unit='m²',    short_text='Pflasterbelag aufnehmen, ggf. reinigen und für Wiedereinbau vorbereiten.'                         WHERE archived_at IS NULL AND id='PFL-103';
UPDATE lv_positions SET name='Steine und Platten aufnehmen',         unit='m²',    short_text='Pflastersteine und Platten aufnehmen und sortiert lagern oder entsorgen.'                         WHERE archived_at IS NULL AND id='PFL-104';
UPDATE lv_positions SET name='Terrasse demontieren',                 unit='m²',    short_text='Terrassenbelag aufnehmen, Unterkonstruktion entfernen und entsorgen.'                              WHERE archived_at IS NULL AND id='PFL-105';
UPDATE lv_positions SET name='Bordsteine entfernen',                 unit='lfm',   short_text='Bordsteine aufnehmen, abtransportieren und entsorgen.'                                            WHERE archived_at IS NULL AND id='PFL-106';
UPDATE lv_positions SET name='Steine und Platten aufnehmen',         unit='m²',    short_text='Pflastersteine oder Platten aufnehmen, sortieren und lagern oder entsorgen.'                      WHERE archived_at IS NULL AND id='PFL-107';
UPDATE lv_positions SET name='Rasenbord herstellen',                 unit='lfm',   short_text='Rasenbordstein setzen, ausrichten und verdichten.'                                                 WHERE archived_at IS NULL AND id='PFL-108';
UPDATE lv_positions SET name='Terrassenplatten verlegen',            unit='m²',    short_text='Terrassenplatten auf vorbereitetes Bett verlegen, ausrichten und verfugen.'                        WHERE archived_at IS NULL AND id='PFL-109';
UPDATE lv_positions SET name='Pflasterplanung erstellen',            unit='Psch',  short_text='Pflasterfläche aufmaßen und Verlegeplan erstellen, pauschal.'                                      WHERE archived_at IS NULL AND id='PFL-110';
UPDATE lv_positions SET name='Pflaster aufnehmen und Rohr freilegen', unit='m²',   short_text='Pflasterbelag aufnehmen, Rohr freilegen, nach Reparatur Pflaster wiederherstellen.'               WHERE archived_at IS NULL AND id='PFL-111';
UPDATE lv_positions SET name='Klinker mit Zierstreifen pflastern',   unit='m²',    short_text='Klinkerpflaster mit Zierstreifen verlegen, inkl. Bettung und Randeinfassung.'                     WHERE archived_at IS NULL AND id='PFL-112';
UPDATE lv_positions SET name='Pflaster aufnehmen und säubern',       unit='m²',    short_text='Pflasterbelag aufnehmen, Steine säubern und für Wiedereinbau lagern.'                             WHERE archived_at IS NULL AND id='PFL-113';
UPDATE lv_positions SET name='Terrassenplatten einbauen',            unit='m²',    short_text='Terrassenplatten auf Splitt- oder Betonbett einbauen und ausrichten.'                             WHERE archived_at IS NULL AND id='PFL-114';
UPDATE lv_positions SET name='Graben verfüllen, Pflasterung wiederherstellen', unit='m²', short_text='Graben nach Rohrreparatur verfüllen, Pflasterbelag wiederherstellen.'                     WHERE archived_at IS NULL AND id='PFL-115';
UPDATE lv_positions SET name='Blumenbeet zurückbauen, Randbefestigung setzen', unit='Psch', short_text='Blumenbeet zurückbauen und verkleinern, Randbefestigung in Naturstein setzen, pauschal.' WHERE archived_at IS NULL AND id='PFL-116';
UPDATE lv_positions SET name='Schadstellen ausbessern, Randbefestigung herstellen', unit='Psch', short_text='Schadhafte Stellen mit Beton ausgleichen, Randbefestigung zu Platten herstellen.'  WHERE archived_at IS NULL AND id='PFL-117';
UPDATE lv_positions SET name='Carport verbreitern, Lichtplatten befestigen', unit='Psch', short_text='Carport um 60 cm verbreitern und Lichtplatten befestigen, pauschal.'                       WHERE archived_at IS NULL AND id='PFL-118';
UPDATE lv_positions SET name='Sandwichplatten montieren',            unit='m²',    short_text='Sandwichplatten montieren, ausrichten und verschrauben.'                                           WHERE archived_at IS NULL AND id='PFL-119';
UPDATE lv_positions SET name='Betonplatten ausbaggern',              unit='m²',    short_text='Betonplatten mit Bagger aufnehmen und abtransportieren.'                                           WHERE archived_at IS NULL AND id='PFL-120';
UPDATE lv_positions SET name='Beet ausbaggern, Pflasterfläche vorbereiten', unit='m²', short_text='Beet ausbaggern, Untergrund planieren und für Pflasterfläche vorbereiten.'                   WHERE archived_at IS NULL AND id='PFL-121';
UPDATE lv_positions SET name='Steine und Bordsteine aufnehmen',      unit='m²',    short_text='Pflastersteine und Bordsteine aufnehmen und sortiert lagern.'                                      WHERE archived_at IS NULL AND id='PFL-122';
UPDATE lv_positions SET name='Pflasterung aufnehmen und tiefer auskoffern', unit='m²', short_text='Pflasterbelag aufnehmen und Untergrund tiefer auskoffern, Mehraufwand.'                       WHERE archived_at IS NULL AND id='PFL-123';
UPDATE lv_positions SET name='Platten auf Nachbargrundstück anheben', unit='m²',   short_text='Plattenbelag auf Nachbargrundstück auf Kundenwunsch mitheben und angleichen.'                     WHERE archived_at IS NULL AND id='PFL-124';
UPDATE lv_positions SET name='Rohre freilegen, erneuern, Pflasterung wiederherstellen', unit='Psch', short_text='Pflaster aufnehmen, Rohre freilegen und erneuern, Boden austauschen, verdichten, Pflaster wiederherstellen.' WHERE archived_at IS NULL AND id='PFL-126';

-- ─────────────────────────────────────────────────────────────
-- 4. GTN – Gartenarbeiten
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Grünabfall entsorgen',                 unit='m³',    short_text='Grünabfall aufnehmen, abtransportieren und entsorgen.'                                             WHERE archived_at IS NULL AND id='GTN-100';
UPDATE lv_positions SET name='Baumwurzel fräsen',                    unit='Stk',   short_text='Baumstumpf oder Wurzel mit Wurzelfräse entfernen.'                                                 WHERE archived_at IS NULL AND id='GTN-101';
UPDATE lv_positions SET name='Jahresrückschnitt Hecken, Büsche, Bäume', unit='Psch', short_text='Jährlicher Rückschnitt von Hecken, Büschen und kleinen Bäumen, pauschal je Einsatz.'           WHERE archived_at IS NULL AND id='GTN-102';
UPDATE lv_positions SET name='Hecke entfernen',                      unit='lfm',   short_text='Hecke komplett entfernen, Wurzeln ziehen, Abfall entsorgen.'                                       WHERE archived_at IS NULL AND id='GTN-103';
UPDATE lv_positions SET name='Rasenfläche angleichen',               unit='m²',    short_text='Unebenheiten in der Rasenfläche ausgleichen, abharken und glätten.'                               WHERE archived_at IS NULL AND id='GTN-104';
UPDATE lv_positions SET name='Gartenborte setzen',                   unit='lfm',   short_text='Gartenborte setzen, ausrichten und befestigen.'                                                    WHERE archived_at IS NULL AND id='GTN-105';
UPDATE lv_positions SET name='Dachrinne reinigen',                   unit='lfm',   short_text='Dachrinne von Laub und Schmutz reinigen, Ablauf prüfen und spülen.'                               WHERE archived_at IS NULL AND id='GTN-106';
UPDATE lv_positions SET name='Baumschnitt',                          unit='h',     short_text='Baum fachmännisch schneiden, Grünabfall häckseln oder entsorgen.'                                  WHERE archived_at IS NULL AND id='GTN-107';
UPDATE lv_positions SET name='Rindenmulch verteilen, Vlies auslegen', unit='m²',   short_text='Vlies auslegen, Rindenmulch verteilen, Laub entfernen.'                                           WHERE archived_at IS NULL AND id='GTN-108';
UPDATE lv_positions SET name='Rasengittersteine verlegen',           unit='m²',    short_text='Rasengittersteine auf vorbereitetes Bett verlegen und einrütteln.'                                 WHERE archived_at IS NULL AND id='GTN-109';
UPDATE lv_positions SET name='Aufräumarbeiten',                      unit='h',     short_text='Allgemeine Aufräumarbeiten auf Baustelle oder Grundstück, nach Aufwand.'                           WHERE archived_at IS NULL AND id='GTN-110';
UPDATE lv_positions SET name='Rasenbord in Beton setzen',            unit='lfm',   short_text='Rasenbordstein auf Betonbett setzen, ausrichten und hinterfüllen.'                                 WHERE archived_at IS NULL AND id='GTN-111';
UPDATE lv_positions SET name='Baumstumpf entfernen inkl. Entsorgung', unit='Stk',  short_text='Baumstumpf mit Gerät entfernen, Grube auffüllen, Stumpf entsorgen.'                               WHERE archived_at IS NULL AND id='GTN-112';
UPDATE lv_positions SET name='Borten setzen und richten',            unit='lfm',   short_text='Gartenborten setzen, ausrichten und befestigen.'                                                   WHERE archived_at IS NULL AND id='GTN-113';
UPDATE lv_positions SET name='Kies verteilen und Kunstrasen verlegen', unit='m²',  short_text='Kies verteilen und einebnen, Kunstrasen verlegen und befestigen.'                                  WHERE archived_at IS NULL AND id='GTN-114';
UPDATE lv_positions SET name='Dachrinnenhalter versetzen',           unit='Stk',   short_text='Vorhandene Dachrinnenhalter umsetzen oder neu ausrichten.'                                         WHERE archived_at IS NULL AND id='GTN-115';
UPDATE lv_positions SET name='Efeu entfernen',                       unit='h',     short_text='Efeu von Fassade, Zaun oder Boden entfernen, Wurzeln ziehen, Abfall entsorgen.'                   WHERE archived_at IS NULL AND id='GTN-116';
UPDATE lv_positions SET name='Grünfläche mähen und Graben ausheben', unit='h',     short_text='Grünflächen mähen und Graben ausheben, nach Aufwand.'                                             WHERE archived_at IS NULL AND id='GTN-117';
UPDATE lv_positions SET name='Grundstück einebnen inkl. Wurzelfräsen', unit='Psch', short_text='Grundstück einebnen, Baumwurzeln fräsen und Fläche abplanieren, pauschal.'                       WHERE archived_at IS NULL AND id='GTN-118';
UPDATE lv_positions SET name='Abfall entsorgen (gesamt)',            unit='Psch',  short_text='Anfallende Abfälle aufnehmen, abtransportieren und entsorgen, pauschal.'                           WHERE archived_at IS NULL AND id='GTN-119';
UPDATE lv_positions SET name='Pinienrinde verteilen',                unit='m²',    short_text='Pinienrinde gleichmäßig verteilen und einharken.'                                                  WHERE archived_at IS NULL AND id='GTN-120';
UPDATE lv_positions SET name='Pflanzen ausgraben, Rasen ausbessern', unit='h',     short_text='Pflanzen ausgraben, Rasenrollschicht ausbessern und glätten.'                                      WHERE archived_at IS NULL AND id='GTN-121';
UPDATE lv_positions SET name='Hecke und Pflanzen entfernen',         unit='h',     short_text='Hecke und Pflanzen entfernen, Wurzeln ziehen und entsorgen.'                                       WHERE archived_at IS NULL AND id='GTN-122';
UPDATE lv_positions SET name='Boden im Wurzelbereich verdichten und ebnen', unit='m²', short_text='Boden im Wurzelbereich verdichten, ebnen und ggf. auffüllen.'                                WHERE archived_at IS NULL AND id='GTN-123';
UPDATE lv_positions SET name='Baum fällen',                          unit='Stk',   short_text='Baum fachgerecht fällen, Grünabfall zerkleinern und entsorgen.'                                    WHERE archived_at IS NULL AND id='GTN-124';
UPDATE lv_positions SET name='Mähkante einbauen, Rasen ansäen, Pflanzen einpflanzen', unit='Psch', short_text='Mähkanten einbauen, Rasenfläche abharken, begradigen, ansäen und Pflanzen einpflanzen.' WHERE archived_at IS NULL AND id='GTN-125';
UPDATE lv_positions SET name='Gartenarbeiten allgemein',             unit='h',     short_text='Allgemeine Gartenarbeiten: Pflanzen umsetzen, Unkraut entfernen, Abfall entsorgen.'                WHERE archived_at IS NULL AND id='GTN-126';
UPDATE lv_positions SET name='Bäume fällen',                         unit='Stk',   short_text='Mehrere Bäume fachgerecht fällen, Grünabfall zerkleinern und entsorgen.'                          WHERE archived_at IS NULL AND id='GTN-127';
UPDATE lv_positions SET name='Wildkraut entfernen',                  unit='m²',    short_text='Wildkraut von Hand oder mit Gerät entfernen und entsorgen.'                                        WHERE archived_at IS NULL AND id='GTN-128';
UPDATE lv_positions SET name='Mäh- und Aufräumarbeiten',             unit='h',     short_text='Rasenflächen mähen und Grundstück aufräumen, nach Aufwand.'                                        WHERE archived_at IS NULL AND id='GTN-129';
UPDATE lv_positions SET name='Mäharbeiten',                          unit='h',     short_text='Rasenflächen und Grünflächen mähen, nach Aufwand.'                                                 WHERE archived_at IS NULL AND id='GTN-130';

-- ─────────────────────────────────────────────────────────────
-- 5. ZAU – Zaunarbeiten
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Doppelstabmattenzaun aufbauen',        unit='lfm',   short_text='Doppelstabmattenzaun auf einbetonierten Pfosten aufbauen, inkl. Abschlussschienen.'                WHERE archived_at IS NULL AND id='ZAU-100';
UPDATE lv_positions SET name='Zaunpfosten einbetonieren',            unit='Stk',   short_text='Zaunpfosten einbetonieren: Loch bohren/ausheben, Pfosten ausrichten und einbetonieren.'            WHERE archived_at IS NULL AND id='ZAU-101';
UPDATE lv_positions SET name='Sichtschutzstreifen einfädeln',        unit='lfm',   short_text='Sichtschutzstreifen in Doppelstabmattenzaun einfädeln.'                                            WHERE archived_at IS NULL AND id='ZAU-102';
UPDATE lv_positions SET name='Zaun zurückbauen',                     unit='lfm',   short_text='Zaunelemente demontieren, Pfosten ziehen, Material sortiert lagern oder entsorgen.'                WHERE archived_at IS NULL AND id='ZAU-103';
UPDATE lv_positions SET name='Pfostenträger ausheben und betonieren', unit='Stk',  short_text='Pfostenträger-Loch ausheben und Träger einbetonieren, je Stück.'                                   WHERE archived_at IS NULL AND id='ZAU-104';
UPDATE lv_positions SET name='Zaundemontage',                        unit='lfm',   short_text='Bestehenden Zaun demontieren und entsorgen.'                                                        WHERE archived_at IS NULL AND id='ZAU-105';
UPDATE lv_positions SET name='Zaun aufstellen und Tür bauen',        unit='Psch',  short_text='Zaun mit Pfosten aufstellen und passende Tür herstellen und einbauen, pauschal.'                   WHERE archived_at IS NULL AND id='ZAU-106';
UPDATE lv_positions SET name='Terrassenüberdachung herstellen',      unit='Psch',  short_text='Terrassenüberdachung herstellen, anpassen und montieren, pauschal.'                                WHERE archived_at IS NULL AND id='ZAU-107';
UPDATE lv_positions SET name='Dach eindecken',                       unit='m²',    short_text='Dachfläche mit vorgegebenem Material eindecken.'                                                   WHERE archived_at IS NULL AND id='ZAU-108';
UPDATE lv_positions SET name='Zaunpfosten in Beton setzen',          unit='Stk',   short_text='Zaunpfosten ausrichten, einbetonieren und bis zur Aushärtung sichern.'                             WHERE archived_at IS NULL AND id='ZAU-109';
UPDATE lv_positions SET name='Treppenstufe aus Palisaden herstellen', unit='Stk',  short_text='Palisaden als Treppenstufe einbauen, ausrichten und verdichten.'                                   WHERE archived_at IS NULL AND id='ZAU-110';
UPDATE lv_positions SET name='Carport-Pfeiler abändern',             unit='Stk',   short_text='Bestehenden Carport-Pfeiler abändern, anpassen oder erneuern.'                                    WHERE archived_at IS NULL AND id='ZAU-111';
UPDATE lv_positions SET name='Boden im Zaunbereich verdichten',      unit='lfm',   short_text='Boden entlang der Zaunlinie verdichten.'                                                           WHERE archived_at IS NULL AND id='ZAU-112';
UPDATE lv_positions SET name='Pfosten betonieren und Zaun aufstellen', unit='Psch', short_text='Mehrere Pfosten einbetonieren und Zaunanlage aufstellen, pauschal.'                               WHERE archived_at IS NULL AND id='ZAU-113';
UPDATE lv_positions SET name='Alten Zaun entsorgen',                 unit='Psch',  short_text='Bestehenden Zaun demontieren und entsorgen, pauschal.'                                             WHERE archived_at IS NULL AND id='ZAU-114';
UPDATE lv_positions SET name='Tor herstellen',                       unit='Stk',   short_text='Tor herstellen, aufhängen und einrichten.'                                                         WHERE archived_at IS NULL AND id='ZAU-115';
UPDATE lv_positions SET name='Beton wegstemmen, Bordstein setzen, Wurzel entfernen', unit='Psch', short_text='Beton wegstemmen, Bordstein entfernen und neu setzen, Baumwurzel für Zaun entfernen.' WHERE archived_at IS NULL AND id='ZAU-116';
UPDATE lv_positions SET name='Carport aufbauen',                     unit='Psch',  short_text='Fertigteil-Carport aufbauen und auf Fundament befestigen, pauschal.'                               WHERE archived_at IS NULL AND id='ZAU-117';
UPDATE lv_positions SET name='Platten unter Zaun verlegen',          unit='lfm',   short_text='Platten unter Zaunlinie verlegen, um Unterkriechen zu verhindern.'                                 WHERE archived_at IS NULL AND id='ZAU-118';
UPDATE lv_positions SET name='Blechdach demontieren und entsorgen',  unit='m²',    short_text='Blechdach abdecken, abbauen und entsorgen.'                                                        WHERE archived_at IS NULL AND id='ZAU-119';
UPDATE lv_positions SET name='Windstopper-Feder montieren',          unit='Stk',   short_text='Windstopper-Feder an Tor oder Türflügel montieren.'                                               WHERE archived_at IS NULL AND id='ZAU-120';
UPDATE lv_positions SET name='Überdachung aufbauen',                 unit='Psch',  short_text='Überdachungskonstruktion aufbauen und auf Fundament befestigen, pauschal.'                         WHERE archived_at IS NULL AND id='ZAU-121';
UPDATE lv_positions SET name='L-Steine setzen, Terrasse pflastern, Zaunpfosten betonieren', unit='Psch', short_text='L-Steine setzen, Terrassenfläche pflastern und Zaunpfosten einbetonieren, pauschal.' WHERE archived_at IS NULL AND id='ZAU-122';
UPDATE lv_positions SET name='Zaunanlage aufbauen und Tür erstellen', unit='Psch', short_text='Zaunanlage aufbauen und Tür herstellen sowie einbauen, pauschal.'                                  WHERE archived_at IS NULL AND id='ZAU-123';
UPDATE lv_positions SET name='Palisaden setzen, Brunnenumrandung herstellen', unit='Psch', short_text='Palisaden als Abgrenzung setzen und Umrandung für Brunnen herstellen, pauschal.'           WHERE archived_at IS NULL AND id='ZAU-124';
UPDATE lv_positions SET name='Doppelstabmattenzaun versetzen',       unit='lfm',   short_text='Bestehenden Zaun demontieren und an neuer Position aufstellen.'                                    WHERE archived_at IS NULL AND id='ZAU-125';
UPDATE lv_positions SET name='Pfostenträger ausheben und betonieren', unit='Stk',  short_text='Pfostenträger-Löcher ausheben und Träger einbetonieren, je Stück.'                                 WHERE archived_at IS NULL AND id='ZAU-126';
UPDATE lv_positions SET name='Holzzaun entsorgen',                   unit='Psch',  short_text='Bestehenden Holzzaun demontieren und entsorgen, pauschal.'                                         WHERE archived_at IS NULL AND id='ZAU-128';
UPDATE lv_positions SET name='Borden und Pfostenträger in Beton setzen', unit='Stk', short_text='Borden und Pfostenträger auf Betonbett setzen und ausrichten, je Stück.'                        WHERE archived_at IS NULL AND id='ZAU-129';

-- ─────────────────────────────────────────────────────────────
-- 6. VWG – Verwaltung / Gerät / Pauschalen
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Transportpauschale Fertigbeton',       unit='Fuhre', short_text='Transportpauschale für Fertigbeton-Lieferung, je Fuhre.'                                           WHERE archived_at IS NULL AND id='VWG-100';
UPDATE lv_positions SET name='Anfahrtspauschale',                    unit='Psch',  short_text='Anfahrtspauschale für Baustelle, je Einsatz.'                                                      WHERE archived_at IS NULL AND id='VWG-101';
UPDATE lv_positions SET name='Arbeitslohn',                          unit='h',     short_text='Arbeitslohn je Arbeitsstunde, nach Aufwand.'                                                        WHERE archived_at IS NULL AND id='VWG-102';
UPDATE lv_positions SET name='Einsatz Motorerdbohrer',               unit='h',     short_text='Motorerdbohrer-Einsatz zur Herstellung von Bohrlöchern, nach Aufwand.'                             WHERE archived_at IS NULL AND id='VWG-103';
UPDATE lv_positions SET name='Frachtpauschale ab Werk',              unit='Fuhre', short_text='Frachtpauschale für Materiallieferung ab Werk, je Fuhre.'                                          WHERE archived_at IS NULL AND id='VWG-104';
UPDATE lv_positions SET name='Baggergerätenutzung',                  unit='h',     short_text='Baggergerät-Nutzung nach Aufwand.'                                                                  WHERE archived_at IS NULL AND id='VWG-105';
UPDATE lv_positions SET name='Europaletten-Leihgebühr',              unit='Stk',   short_text='Anteilige Leihgebühr für Europaletten, je Stück.'                                                  WHERE archived_at IS NULL AND id='VWG-106';
UPDATE lv_positions SET name='Abgesprochene Mehrarbeit',             unit='Psch',  short_text='Abgesprochene Mehrarbeit über Auftragsumfang hinaus, pauschal.'                                    WHERE archived_at IS NULL AND id='VWG-107';
UPDATE lv_positions SET name='Leihgebühr Microbagger',               unit='Tag',   short_text='Leihgebühr für Microbagger, je Arbeitstag.'                                                        WHERE archived_at IS NULL AND id='VWG-108';
UPDATE lv_positions SET name='Container-Stellpauschale',             unit='Psch',  short_text='Stellpauschale für Container-Bereitstellung und Abfuhr.'                                           WHERE archived_at IS NULL AND id='VWG-109';
UPDATE lv_positions SET name='Transportpauschale Sand',              unit='Fuhre', short_text='Transportpauschale für Sand-Lieferung, je Fuhre.'                                                  WHERE archived_at IS NULL AND id='VWG-110';
UPDATE lv_positions SET name='Wartezeit',                            unit='h',     short_text='Wartezeit durch externe Einflüsse (Lieferung, Behörde o.ä.), nach Aufwand.'                        WHERE archived_at IS NULL AND id='VWG-111';
UPDATE lv_positions SET name='Baustelle einrichten',                 unit='Psch',  short_text='Baustelle einrichten: Absperrung, Beschilderung, Geräteaufstellung, pauschal.'                     WHERE archived_at IS NULL AND id='VWG-112';
UPDATE lv_positions SET name='Einsatz Rohrspirale',                  unit='h',     short_text='Einsatz Rohrspirale zur Rohrreinigung/-entstopfung, nach Aufwand.'                                WHERE archived_at IS NULL AND id='VWG-113';
UPDATE lv_positions SET name='Einsatz Nassschneider',                unit='h',     short_text='Nassschneider-Einsatz für Beton- und Steinschnitte, nach Aufwand.'                                WHERE archived_at IS NULL AND id='VWG-114';
UPDATE lv_positions SET name='Anfahrtspauschale über 50 km',         unit='Psch',  short_text='Anfahrtspauschale für Baustellen mit mehr als 50 km Entfernung.'                                   WHERE archived_at IS NULL AND id='VWG-115';
UPDATE lv_positions SET name='Planung erstellen',                    unit='Psch',  short_text='Aufmaß nehmen und Ausführungsplanung erstellen, pauschal.'                                          WHERE archived_at IS NULL AND id='VWG-116';
UPDATE lv_positions SET name='Verbrauchsmaterialpauschale',          unit='Psch',  short_text='Pauschale für Verbrauchsmaterialien (Schrauben, Dübel, Klebeband etc.).'                           WHERE archived_at IS NULL AND id='VWG-117';
UPDATE lv_positions SET name='Entsorgung Pflaster und Container-Stellpauschale', unit='Psch', short_text='Altes Pflaster entsorgen und Container-Stellpauschale, pauschal.'                      WHERE archived_at IS NULL AND id='VWG-118';
UPDATE lv_positions SET name='Handwerkerkosten pauschal',            unit='Psch',  short_text='Handwerkerleistungen pauschal, nach Vereinbarung.'                                                 WHERE archived_at IS NULL AND id='VWG-119';
UPDATE lv_positions SET name='Leihgebühr Radlader',                  unit='Tag',   short_text='Leihgebühr für Radlader, je Arbeitstag.'                                                           WHERE archived_at IS NULL AND id='VWG-120';
UPDATE lv_positions SET name='Montagekosten pauschal',               unit='Psch',  short_text='Montagekosten pauschal, nach Vereinbarung.'                                                        WHERE archived_at IS NULL AND id='VWG-121';
UPDATE lv_positions SET name='Arbeitsbühne selbstfahrend (Benzin)',  unit='Tag',   short_text='Selbstfahrende Arbeitsbühne (Benzin), Leihgebühr je Arbeitstag.'                                  WHERE archived_at IS NULL AND id='VWG-122';
UPDATE lv_positions SET name='Einsatz Motorpfahlramme',              unit='h',     short_text='Motorpfahlramme zur Pfahlgründung, nach Aufwand.'                                                  WHERE archived_at IS NULL AND id='VWG-123';

-- ─────────────────────────────────────────────────────────────
-- 7. UMZ – Umzug
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Umzug pauschal',                       unit='Psch',  short_text='Umzugsleistung komplett mit Ab- und Aufbau, pauschal.'                                            WHERE archived_at IS NULL AND id='UMZ-001';
UPDATE lv_positions SET name='Umzug regional',                       unit='Psch',  short_text='Regionaler Umzug mit Helfern und Transporter, pauschal.'                                           WHERE archived_at IS NULL AND id='UMZ-002';
UPDATE lv_positions SET name='Umzug überregional mit Helfern',       unit='Psch',  short_text='Überregionaler Umzug mit Umzugshelfern, Ab- und Aufbau, pauschal.'                                WHERE archived_at IS NULL AND id='UMZ-003';
UPDATE lv_positions SET name='Umzug mit Helfern, Ab- und Aufbau',    unit='Psch',  short_text='Umzug mit Helfern inkl. Möbel ab- und aufbauen, pauschal.'                                        WHERE archived_at IS NULL AND id='UMZ-004';

-- ─────────────────────────────────────────────────────────────
-- 8. SON – Sonstige
-- ─────────────────────────────────────────────────────────────
UPDATE lv_positions SET name='Kabelverlegungsarbeiten',              unit='lfm',   short_text='Kabel verlegen und anschließen, nach Aufwand.'                                                     WHERE archived_at IS NULL AND id='SON-001';
UPDATE lv_positions SET name='Ausbesserungsarbeiten',                unit='h',     short_text='Allgemeine Ausbesserungsarbeiten, nach Aufwand.'                                                   WHERE archived_at IS NULL AND id='SON-002';
UPDATE lv_positions SET name='Boxen reinigen',                       unit='Stk',   short_text='Boxen oder Behälter reinigen, je Stück.'                                                           WHERE archived_at IS NULL AND id='SON-003';
UPDATE lv_positions SET name='Hofentwässerung einbauen',             unit='Stk',   short_text='Hofentwässerungsanlage einbauen und anschließen.'                                                  WHERE archived_at IS NULL AND id='SON-004';
UPDATE lv_positions SET name='Schneidarbeiten',                      unit='h',     short_text='Schneidarbeiten an Stein, Beton oder Metall, nach Aufwand.'                                        WHERE archived_at IS NULL AND id='SON-005';
UPDATE lv_positions SET name='Rütteln, schneiden und einschlämmen',  unit='m²',    short_text='Pflasterfläche rütteln, Kanten schneiden und mit Sand einschlämmen.'                              WHERE archived_at IS NULL AND id='SON-006';
UPDATE lv_positions SET name='Pflasterarbeiten pauschal',            unit='Psch',  short_text='Pflasterarbeiten als Pauschalauftrag, nach Vereinbarung.'                                          WHERE archived_at IS NULL AND id='SON-007';
UPDATE lv_positions SET name='Fugen ausflexen und vorbereiten',      unit='m²',    short_text='Alte Fugen ausflexen, Untergrund säubern und für neue Verfugung vorbereiten.'                     WHERE archived_at IS NULL AND id='SON-008';
UPDATE lv_positions SET name='Löcher herstellen',                    unit='Stk',   short_text='Durchbrüche oder Löcher herstellen, je Stück.'                                                    WHERE archived_at IS NULL AND id='SON-009';
UPDATE lv_positions SET name='Bauschutt entsorgen',                  unit='t',     short_text='Bauschutt aufnehmen, abtransportieren und entsorgen.'                                             WHERE archived_at IS NULL AND id='SON-010';
UPDATE lv_positions SET name='KVH-Holzunterkonstruktion anpassen und montieren', unit='m²', short_text='KVH-Holzunterkonstruktion anpassen und montieren.'                                       WHERE archived_at IS NULL AND id='SON-011';
UPDATE lv_positions SET name='Gemischte Bau- und Abbruchabfälle entsorgen', unit='t', short_text='Gemischte Bau- und Abbruchabfälle aufnehmen, abtransportieren und entsorgen.'                 WHERE archived_at IS NULL AND id='SON-012';
UPDATE lv_positions SET name='Bodenverlegearbeiten',                 unit='m²',    short_text='Bodenbelag verlegen, inkl. Untergrundvorbereitung.'                                               WHERE archived_at IS NULL AND id='SON-014';
UPDATE lv_positions SET name='Duschwand herstellen',                 unit='Stk',   short_text='Duschwand aufstellen, ausrichten und befestigen.'                                                  WHERE archived_at IS NULL AND id='SON-015';
UPDATE lv_positions SET name='Rollschicht abbrechen',                unit='m²',    short_text='Rollschicht (aufgestellte Steine) abbrechen und entsorgen.'                                        WHERE archived_at IS NULL AND id='SON-016';
UPDATE lv_positions SET name='Befüllen und Ansäen',                  unit='m²',    short_text='Fläche auffüllen, einebnen und mit Rasensamen ansäen.'                                            WHERE archived_at IS NULL AND id='SON-018';
UPDATE lv_positions SET name='Terrasse herstellen',                  unit='m²',    short_text='Terrasse komplett herstellen, inkl. Untergrundvorbereitung und Belag.'                            WHERE archived_at IS NULL AND id='SON-019';
UPDATE lv_positions SET name='Treppe fliesen',                       unit='m²',    short_text='Treppenstufen fliesen: Untergrund vorbereiten, Fliesen verlegen und verfugen.'                    WHERE archived_at IS NULL AND id='SON-020';
UPDATE lv_positions SET name='Abbrucharbeiten pauschal',             unit='Psch',  short_text='Allgemeine Abbrucharbeiten, pauschal nach Vereinbarung.'                                           WHERE archived_at IS NULL AND id='SON-021';
UPDATE lv_positions SET name='Grabenbefestigung Bongossi-Geflecht',  unit='m²',    short_text='Grabenbefestigung aus Bongossi-Geflecht verlegen.'                                                WHERE archived_at IS NULL AND id='SON-022';

-- Kontrollabfrage
SELECT cat, count(*) AS gesamt,
       count(*) FILTER (WHERE unit IS NOT NULL) AS mit_einheit,
       count(*) FILTER (WHERE short_text IS NOT NULL) AS mit_kurztext,
       count(*) FILTER (WHERE archived_at IS NOT NULL) AS archiviert
FROM lv_positions
GROUP BY cat ORDER BY cat;

