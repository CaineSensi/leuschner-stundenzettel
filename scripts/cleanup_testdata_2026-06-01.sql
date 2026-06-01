-- Test-Daten-Bereinigung 2026-06-01 (Rick / Admin-Auftrag)
-- Idempotent gehalten: alle Statements anhand fester UUIDs.
BEGIN;

-- 1) Firmensitz: Test-Projektnummer TEST-001 entfernen (Site selbst bleibt!)
UPDATE sites
   SET project_number = NULL
 WHERE id = '11111111-1111-1111-1111-111111111111'
   AND project_number = 'TEST-001';

-- 2) Test-Pipeline-Karten loeschen (Max Mustermann + Hans Tester FIX-TEST)
DELETE FROM pipeline_cards
 WHERE id IN ('432314ef-e203-483c-8755-f9a6311d71b6',  -- Max Mustermann
              'def46a43-0066-42ae-b7f0-77f0ef8c6f77'); -- Hans Tester FIX-TEST

-- 3) Test-Kunden loeschen (Max Mustermann + Hans Tester + Hans Tester FIX-TEST)
DELETE FROM customers
 WHERE id IN ('e1e7f980-585b-4f5e-a332-133fd713e272',  -- Max Mustermann
              'cd8b8de1-9333-4352-9bc6-e3db80eee8fc',  -- Hans Tester
              '3ee6316f-0012-4a2f-a043-b02b473c54e3'); -- Hans Tester FIX-TEST

-- 4) Archivierte Testbaustelle hart loeschen (erst abhaengige Datensaetze)
DELETE FROM entries     WHERE site_id = '5e1cdcff-4d0d-4486-bd03-47a39b52721f';
DELETE FROM assignments WHERE site_id = '5e1cdcff-4d0d-4486-bd03-47a39b52721f';
DELETE FROM sites       WHERE id      = '5e1cdcff-4d0d-4486-bd03-47a39b52721f';

COMMIT;
