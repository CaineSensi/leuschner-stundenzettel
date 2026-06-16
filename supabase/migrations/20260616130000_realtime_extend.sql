-- ============================================================
-- Realtime-Publication nachziehen + dokumentieren
-- ============================================================
-- Stand 2026-06-16. Die Live-Publication supabase_realtime wurde über die Zeit
-- direkt (außerhalb der Migrationen) auf viele Tabellen erweitert — diese Datei
-- holt diese Drift in die Migrationen zurück UND ergänzt die noch fehlenden:
--   - lv_positions  → Leistungsverzeichnis-Tab aktualisiert sich live
--   - diag_events   → Live-Log im Diagnose-Tab läuft in Echtzeit
--
-- Idempotent: jede Tabelle wird nur hinzugefügt, wenn sie noch nicht Mitglied
-- der Publication ist (sonst wirft ALTER PUBLICATION ... ADD TABLE einen Fehler).
-- ============================================================

DO $$
DECLARE
  t text;
  wanted text[] := ARRAY[
    -- bereits live (zur Dokumentation/Sicherung mitgeführt):
    'assignments','customers','entries','entry_photos','inquiries','messages',
    'pipeline_cards','site_invoices','site_materials','site_questions','sites','workers',
    -- neu in dieser Migration:
    'lv_positions','diag_events'
  ];
BEGIN
  FOREACH t IN ARRAY wanted LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;  -- Tabelle existiert (noch) nicht → überspringen
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Kontrolle nach dem Run:
--   select tablename from pg_publication_tables
--   where pubname='supabase_realtime' order by tablename;
