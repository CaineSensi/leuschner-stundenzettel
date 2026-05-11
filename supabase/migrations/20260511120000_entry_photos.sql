-- ============================================================
-- Phase D · Foto-Belege pro Eintrag
-- ============================================================
-- Jeder Eintrag (work / sick / vacation) kann beliebig viele Fotos haben.
-- Pro Foto werden zwei Versionen im Storage gehalten:
--   raw      — Original wie aus der Kamera
--   stamped  — eingebrannte Version mit Datum + Uhrzeit + GPS + Baustelle
--              in der unteren Bild-Ecke (forensische Verwertbarkeit bei
--              Reklamationen, Wetterschäden, Vorher-Nachher).
-- ============================================================

create table entry_photos (
  id              uuid primary key default uuid_generate_v4(),
  entry_id        uuid not null references entries(id) on delete cascade,
  worker_id       uuid not null references workers(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  raw_path        text not null,
  stamped_path    text,                              -- null = Stamp fehlgeschlagen / opt-out
  taken_at        timestamptz,                       -- aus EXIF, fallback created_at
  geo_lat         double precision,
  geo_lng         double precision,
  width_px        integer,
  height_px       integer,
  bytes_raw       integer,
  bytes_stamped   integer,
  position        integer not null default 0,        -- Sortierreihenfolge
  created_at      timestamptz not null default now()
);

create index entry_photos_entry_idx    on entry_photos(entry_id);
create index entry_photos_worker_idx   on entry_photos(worker_id);
create index entry_photos_company_idx  on entry_photos(company_id, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY · Tabelle
-- ============================================================

alter table entry_photos enable row level security;

-- Mitarbeiter sieht eigene Fotos
-- Admin sieht alle der eigenen Firma
create policy entry_photos_select on entry_photos
  for select using (
    worker_id = current_worker_id()
    or (is_admin() and company_id = current_company_id())
  );

-- Insert: nur eigene + company_id muss zur eigenen Firma passen
create policy entry_photos_insert_own on entry_photos
  for insert with check (
    worker_id = current_worker_id()
    and company_id = current_company_id()
  );

-- Update: Mitarbeiter darf eigene Felder ändern (z.B. position)
create policy entry_photos_update_own on entry_photos
  for update using (worker_id = current_worker_id());

-- Delete: eigene Fotos. Admin darf alle der Firma löschen.
create policy entry_photos_delete on entry_photos
  for delete using (
    worker_id = current_worker_id()
    or (is_admin() and company_id = current_company_id())
  );

-- Realtime-Publication, damit Admin Foto-Uploads live sieht
alter publication supabase_realtime add table entry_photos;

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
-- Privat (kein public URL). Zugriff nur via signed URLs oder
-- authentifizierte Requests. Path-Konvention:
--   <company_id>/<entry_id>/<photo_id>.jpg     (raw)
--   <company_id>/<entry_id>/<photo_id>_s.jpg   (stamped)
-- Dadurch greift RLS auf storage.objects über split_part(name,'/',1).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'entry-photos',
  'entry-photos',
  false,
  20 * 1024 * 1024,                                  -- 20 MB Hardcap pro File
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- ROW LEVEL SECURITY · Storage-Objekte
-- ============================================================
-- Zugriff anhand des Path-Präfix: erste Ebene == company_id.

create policy entry_photos_storage_select on storage.objects
  for select to authenticated using (
    bucket_id = 'entry-photos'
    and (
      (split_part(name, '/', 1))::uuid = current_company_id()
    )
  );

create policy entry_photos_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'entry-photos'
    and (split_part(name, '/', 1))::uuid = current_company_id()
  );

create policy entry_photos_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'entry-photos'
    and (
      (split_part(name, '/', 1))::uuid = current_company_id()
      and (
        -- Mitarbeiter: nur eigene Fotos (entry_id-Ordner gehört einem entry_photos-Eintrag des Workers)
        exists (
          select 1 from entry_photos p
          where p.company_id = (split_part(name, '/', 1))::uuid
            and p.entry_id   = (split_part(name, '/', 2))::uuid
            and p.worker_id  = current_worker_id()
        )
        or is_admin()
      )
    )
  );
