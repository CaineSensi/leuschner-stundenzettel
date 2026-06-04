-- ============================================================
-- site_sketches · Draufsicht-Skizzen (Garten-Planer) pro Baustelle
-- ============================================================
-- Speichert den JSON-Stand des Garten-Skizzen-Editors (Flächen, Maßstab,
-- Luftbild-Bezug) pro Baustelle, damit die Skizze auf jedem Gerät verfügbar
-- ist statt nur im localStorage. Eine Skizze je Baustelle (Upsert über
-- site_id). RLS wie alle Company-Tabellen: lesen je Company, schreiben Admin.
-- ============================================================

create table if not exists site_sketches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  site_id     uuid references sites(id) on delete cascade,
  title       text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- genau eine Skizze pro Baustelle (Upsert-Schlüssel)
create unique index if not exists site_sketches_site_uniq
  on site_sketches(site_id) where site_id is not null;
create index if not exists site_sketches_company_idx
  on site_sketches(company_id);

alter table site_sketches enable row level security;

create policy site_sketches_select_company on site_sketches
  for select using (company_id = current_company_id());

create policy site_sketches_write_admin on site_sketches
  for all using  (is_admin() and company_id = current_company_id())
         with check (is_admin() and company_id = current_company_id());
