-- ============================================================
-- Leuschner · Stundenzettel · Initial Schema
-- ============================================================
-- Anlegen via Supabase SQL-Editor oder `supabase db push`.
-- Reihenfolge: Extensions → Types → Tables → Indexes → Functions → RLS Policies → Triggers.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

create type discipline as enum ('PFL', 'GTN', 'ZAU');
create type entry_type as enum ('work', 'sick', 'vacation', 'holiday');
create type weather_type as enum ('sun', 'cloud', 'rain', 'snow');

-- ============================================================
-- TABLES
-- ============================================================

-- Firmen (Mehrmandanten-fähig)
create table companies (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,                       -- z. B. "Rund um's Haus Leuschner"
  legal_name  text not null,                       -- z. B. "Rund um's Haus Leuschner e.K."
  address     text,
  vat_id      text,
  created_at  timestamptz not null default now()
);

-- Mitarbeiter (incl. Chefs und Admins)
create table workers (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  initials      text not null check (length(initials) between 1 and 3),
  first_name    text not null,
  last_name     text not null,
  role          text not null,                     -- z. B. "Maschinist · Bagger"
  is_admin      boolean not null default false,
  starts_on     date default current_date,
  ends_on       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index workers_company_idx on workers(company_id);
create index workers_auth_idx on workers(auth_user_id) where auth_user_id is not null;

-- Baustellen
create table sites (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,
  name                text not null,
  street              text,
  city                text,
  geo_lat             double precision,
  geo_lng             double precision,
  geofence_radius_m   integer default 50,
  starred             boolean default false,
  archived_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index sites_company_active_idx on sites(company_id) where archived_at is null;

-- Stundenerfassung
create table entries (
  id              uuid primary key default uuid_generate_v4(),
  worker_id       uuid not null references workers(id) on delete cascade,
  date            date not null,
  entry_type      entry_type not null default 'work',

  -- Nur für entry_type = 'work':
  site_id         uuid references sites(id) on delete restrict,
  discipline      discipline,
  start_min       integer check (start_min between 0 and 1440),
  end_min         integer check (end_min between 0 and 1440),
  pause_min       integer default 30 check (pause_min >= 0),
  weather         weather_type,
  geo_verified    boolean default false,
  geo_distance_m  integer,

  -- Nur für entry_type IN ('sick', 'vacation', 'holiday'):
  end_date        date,

  -- Allgemein:
  note            text,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint valid_work_entry check (
    (entry_type = 'work' and site_id is not null and discipline is not null
     and start_min is not null and end_min is not null and end_min > start_min)
    or
    entry_type != 'work'
  )
);

create index entries_worker_date_idx on entries(worker_id, date desc);
create index entries_date_submitted_idx on entries(date, submitted_at);

-- Einladungs-Codes für Onboarding
create table invitations (
  code         text primary key,                   -- z. B. "LU92K3"
  worker_id    uuid not null references workers(id) on delete cascade,
  invited_by   uuid references workers(id) on delete set null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  device_id    text
);

create index invitations_active_idx on invitations(expires_at) where used_at is null;

-- Web-Push-Subscriptions
create table push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  worker_id   uuid not null references workers(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  unique (worker_id, endpoint)
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

create or replace function current_worker_id()
returns uuid
language sql stable
security definer set search_path = public
as $$
  select id from workers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_company_id()
returns uuid
language sql stable
security definer set search_path = public
as $$
  select company_id from workers where auth_user_id = auth.uid() limit 1;
$$;

create or replace function is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select coalesce(
    (select is_admin from workers where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

-- updated_at automatisch pflegen
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workers_updated_at before update on workers
  for each row execute function set_updated_at();

create trigger entries_updated_at before update on entries
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table companies          enable row level security;
alter table workers            enable row level security;
alter table sites              enable row level security;
alter table entries            enable row level security;
alter table invitations        enable row level security;
alter table push_subscriptions enable row level security;

-- COMPANIES: jeder darf seine eigene Firma sehen
create policy companies_select_own on companies
  for select using (id = current_company_id());

-- WORKERS: jeder sieht eigenen Datensatz; Admin sieht alle der Firma
create policy workers_select on workers
  for select using (
    auth_user_id = auth.uid()
    or (is_admin() and company_id = current_company_id())
  );

create policy workers_insert_admin on workers
  for insert with check (
    is_admin() and company_id = current_company_id()
  );

create policy workers_update_admin on workers
  for update using (
    is_admin() and company_id = current_company_id()
  );

create policy workers_delete_admin on workers
  for delete using (
    is_admin() and company_id = current_company_id()
  );

-- SITES: jeder in der Firma darf lesen; Admin darf schreiben
create policy sites_select_company on sites
  for select using (company_id = current_company_id());

create policy sites_write_admin on sites
  for all using (is_admin() and company_id = current_company_id())
  with check (is_admin() and company_id = current_company_id());

-- ENTRIES: jeder seine eigenen; Admin sieht alle der Firma
create policy entries_select on entries
  for select using (
    worker_id = current_worker_id()
    or (is_admin() and worker_id in (
      select id from workers where company_id = current_company_id()
    ))
  );

create policy entries_insert_own on entries
  for insert with check (worker_id = current_worker_id());

create policy entries_update_own on entries
  for update using (worker_id = current_worker_id());

create policy entries_delete_own on entries
  for delete using (worker_id = current_worker_id());

-- INVITATIONS: nur Admin
create policy invitations_admin on invitations
  for all using (is_admin())
  with check (is_admin());

-- PUSH_SUBSCRIPTIONS: jeder verwaltet eigene
create policy push_own on push_subscriptions
  for all using (worker_id = current_worker_id())
  with check (worker_id = current_worker_id());

-- ============================================================
-- SEED · Stamm-Daten
-- ============================================================

-- ============================================================
-- Leuschner · Stundenzettel · Seed-Daten für Erstinstallation
-- ============================================================
-- Anlegen NACH der Migration 20260508000000_init.sql.
-- Diese Daten ersetzen die Mock-Daten aus src/lib/mockData.ts.
-- ============================================================

-- 1) Firma anlegen
insert into companies (id, name, legal_name, address, vat_id) values
  ('00000000-0000-0000-0000-000000000001',
   'Rund um''s Haus Leuschner',
   'Rund um''s Haus Leuschner e.K.',
   'Industriestr. 4, 26826 Weener',
   null);

-- 2) Mitarbeiter (auth_user_id wird beim ersten Login via Einladungs-Code verknüpft)
insert into workers (id, company_id, initials, first_name, last_name, role, is_admin) values
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'RK', 'Rick', 'Kohlberg', 'Büro · Verwaltung', true),

  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'UL', 'Udo', 'Leuschner', 'Inhaber · Geschäftsführer', false),

  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   'WW', 'Wolfgang', 'Wilken', 'Inhaber · Geschäftsführer', false),

  ('00000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-000000000001',
   'MJ', 'Mathias', 'Jauken', 'Maschinist · Bagger', false);

-- 3) Stamm-Baustellen
insert into sites (company_id, name, street, city, geo_lat, geo_lng, starred) values
  ('00000000-0000-0000-0000-000000000001', 'Fam. Hoffmann',     'Wilhelmstr. 12',  '26789 Leer',         53.2306, 7.4577, true),
  ('00000000-0000-0000-0000-000000000001', 'Dr. Meents',        'Hauptstr. 84',    '26831 Bunde',        53.1810, 7.2630, true),
  ('00000000-0000-0000-0000-000000000001', 'Kita Stapelmoor',   'Schulstr. 5',     '26826 Stapelmoor',   53.1620, 7.3650, false),
  ('00000000-0000-0000-0000-000000000001', 'Nelkenweg 14',      'Nelkenweg 14',    '26826 Weener',       53.1640, 7.3500, false),
  ('00000000-0000-0000-0000-000000000001', 'Friedhof Weener',   'Hindenburgstr. 1','26826 Weener',       53.1665, 7.3580, false),
  ('00000000-0000-0000-0000-000000000001', 'Gewerbepark Bingum','Industriestr. 14','26789 Leer',         53.2410, 7.4400, false);
