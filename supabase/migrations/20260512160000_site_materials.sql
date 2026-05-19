-- Material-Bestellungen + Lieferungen pro Baustelle.
-- Status-Flow: planned → ordered → delivered → installed (oder returned bei Rückgabe).

create table if not exists site_materials (
  id            uuid primary key default uuid_generate_v4(),
  site_id       uuid not null references sites(id) on delete cascade,
  name          text not null,
  quantity      numeric(12,2),
  unit          text,
  status        text not null default 'planned' check (status in ('planned','ordered','delivered','installed','returned')),
  supplier      text,
  ordered_at    date,
  delivered_at  date,
  price_eur     numeric(12,2),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists site_materials_site_idx   on site_materials(site_id);
create index if not exists site_materials_status_idx on site_materials(status);

create or replace function site_materials_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists site_materials_touch on site_materials;
create trigger site_materials_touch before update on site_materials
  for each row execute function site_materials_touch();

alter table site_materials enable row level security;

create policy site_materials_demo_all on site_materials
  for all using (true) with check (true);

alter publication supabase_realtime add table site_materials;
