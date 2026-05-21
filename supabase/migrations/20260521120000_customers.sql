-- Kunden-Tabelle: spiegelt sevDesk-Contact, ein Eintrag pro Kunde.
-- Vorher hing der Kunde an `sites` (denormalisiert via customer_name etc.).
-- Mit dem sevDesk-Import wird das umgekehrt: Kunde primär, Baustelle/Karte
-- verweisen darauf. Die bestehenden customer_*-Spalten auf `sites` bleiben
-- als Fallback/Cache bestehen, werden aber nicht mehr autoritativ.

create table if not exists customers (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,
  sevdesk_contact_id  text,
  customer_number     text,            -- sevDesk customerNumber (z. B. "1236")
  name                text not null,   -- Anzeigename: "Andrea Remmert" oder Firmenname
  surename            text,            -- Vorname (bei Personen)
  familyname          text,            -- Nachname (bei Personen)
  is_company          boolean not null default false,
  email               text,
  phone               text,
  street              text,
  zip                 text,
  city                text,
  country             text default 'Deutschland',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists customers_sevdesk_uniq
  on customers(sevdesk_contact_id) where sevdesk_contact_id is not null;

create index if not exists customers_company_idx on customers(company_id);
create index if not exists customers_name_idx    on customers(name);

create or replace function customers_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists customers_touch on customers;
create trigger customers_touch before update on customers
  for each row execute function customers_touch();

alter table customers enable row level security;

-- Demo-relax-Phase analog zu pipeline_cards/site_invoices.
-- TODO: beim RLS-Cleanup auf authenticated einschränken.
drop policy if exists customers_demo_all on customers;
create policy customers_demo_all on customers
  for all using (true) with check (true);

-- Realtime für Live-Updates im Admin
do $$
begin
  alter publication supabase_realtime add table customers;
exception when duplicate_object then null;
end$$;

-- Verknüpfungen: Baustellen und Pipeline-Karten zeigen optional auf Kunde.
alter table sites
  add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists sites_customer_idx
  on sites(customer_id) where customer_id is not null;

alter table pipeline_cards
  add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists pipeline_cards_customer_idx
  on pipeline_cards(customer_id) where customer_id is not null;
