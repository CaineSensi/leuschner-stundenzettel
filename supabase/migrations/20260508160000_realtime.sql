-- ============================================================
-- Realtime aktivieren — Push-Updates für Wochenplan, Einträge, Baustellen
-- ============================================================
-- Damit das Admin-Dashboard sofort sieht, wenn ein Mitarbeiter
-- eine Stunde einträgt, und das Mitarbeiter-Handy sofort merkt,
-- wenn der Admin eine neue Zuweisung macht.
-- ============================================================

alter publication supabase_realtime add table assignments;
alter publication supabase_realtime add table entries;
alter publication supabase_realtime add table sites;
alter publication supabase_realtime add table workers;
