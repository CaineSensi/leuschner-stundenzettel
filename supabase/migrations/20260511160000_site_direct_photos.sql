-- ============================================================
-- Phase D2 · Baustellen-Stamm-Fotos
-- ============================================================
-- Fotos können entweder an einem Stundeneintrag hängen (entry_id)
-- ODER direkt an einer Baustelle (site_id) — z.B. Vorab-Begehung,
-- Pläne, Skizzen, Lieferschein-Vorlagen.
-- ============================================================

alter table entry_photos alter column entry_id drop not null;

alter table entry_photos
  add column if not exists site_id uuid references sites(id) on delete cascade;

-- Garantiert dass jedes Foto einer Quelle zugeordnet ist
alter table entry_photos
  add constraint entry_photos_owner_check
  check (entry_id is not null or site_id is not null);

create index if not exists entry_photos_site_idx
  on entry_photos(site_id) where site_id is not null;

-- ============================================================
-- Hinweis: Storage-RLS bleibt unverändert.
-- Path-Konvention für site-direct: {company_id}/{site_id}/{photo_id}.jpg
-- Beide Foto-Typen nutzen also dasselbe UUID-Format im zweiten Segment.
-- Die bestehende Policy darf weiter via split_part(name,'/',2)::uuid prüfen,
-- ohne Cast-Fehler. Worker-Check matched nur für entry-Fotos (eigene),
-- Admin matched alle.
-- ============================================================
