-- ============================================================
-- Baustellen-Nummer (Job-Number / Auftragsnummer)
-- ============================================================
-- Pro Baustelle eine Kennung wie "2026-042" oder "AUF-1234",
-- damit Mitarbeiter und Buchhaltung den Auftrag eindeutig
-- referenzieren können.
-- ============================================================

alter table sites add column if not exists project_number text;

-- Index für schnelle Suche im Admin
create index if not exists sites_project_number_idx on sites(project_number);
