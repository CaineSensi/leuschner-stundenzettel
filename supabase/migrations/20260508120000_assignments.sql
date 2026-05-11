-- ============================================================
-- Phase C · Tagesplanung durch Admin
-- ============================================================
-- Admin weist Mitarbeiter pro Tag eine Baustelle + Tätigkeit zu.
-- Mitarbeiter sieht in der App vorausgefüllt: Baustelle + Tätigkeit
-- + Default-Zeiten (07:00–16:30, 30min Pause). Er kann anpassen,
-- aber nichts mehr selbst auswählen.
-- ============================================================

create table assignments (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,
  worker_id           uuid not null references workers(id) on delete cascade,
  date                date not null,
  site_id             uuid not null references sites(id) on delete restrict,
  discipline          discipline not null,
  planned_start_min   integer check (planned_start_min between 0 and 1440),
  planned_end_min     integer check (planned_end_min between 0 and 1440),
  planned_pause_min   integer default 30 check (planned_pause_min >= 0),
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references workers(id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (worker_id, date)
);

create index assignments_worker_date_idx on assignments(worker_id, date);
create index assignments_company_date_idx on assignments(company_id, date);

create trigger assignments_updated_at before update on assignments
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table assignments enable row level security;

-- Mitarbeiter sieht nur seine eigenen Zuweisungen
-- Admin sieht alle in seiner Firma
create policy assignments_select on assignments
  for select using (
    worker_id = current_worker_id()
    or (is_admin() and company_id = current_company_id())
  );

-- Nur Admin darf insert/update/delete
create policy assignments_write_admin on assignments
  for all using (is_admin() and company_id = current_company_id())
  with check (is_admin() and company_id = current_company_id());
