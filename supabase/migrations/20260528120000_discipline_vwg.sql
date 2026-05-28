-- Disziplin "VWG" (Verwaltung) hinzufuegen — fuer Bueroarbeit (Rick, evtl. spaeter Buchhaltung).
-- Bisher kannte das Enum nur PFL/GTN/ZAU (handwerklich). Verwaltungsstunden
-- konnten nicht sauber gebucht werden.
--
-- Enum-add ist transaktional, aber neu hinzugefuegte Werte koennen erst NACH
-- COMMIT in IF-Block-Bedingungen genutzt werden. Hier nur ADD VALUE — keine
-- Folge-Statements, die VWG direkt verwenden.

alter type discipline add value if not exists 'VWG';
