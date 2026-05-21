-- Anfragen-Inbox: Rohe Kundenanfragen (Mail / Telefon / WhatsApp / Brief)
-- werden hier in Rohtext-Form abgelegt, optional strukturiert, und können
-- in eine Pipeline-Karte (Stage „Anfrage") und später ein sevDesk-Angebot
-- überführt werden. Die Inbox überlebt unabhängig vom Kanban — auch
-- verworfene/abgelehnte Anfragen bleiben hier für die Historie.

create table if not exists inquiries (
  id                uuid primary key default uuid_generate_v4(),
  company_id        uuid not null references companies(id) on delete cascade,

  -- Roh + Strukturiert
  source            text not null check (source in ('mail','phone','whatsapp','letter','in_person','web','other')),
  raw_text          text not null,
  parsed_json       jsonb,           -- {customerName, phone, email, street, zip, city, description, leistung, mengen[], dringlichkeit}

  -- Felder zum Editieren (überschreiben parsed_json beim Speichern)
  customer_name     text,
  customer_phone    text,
  customer_email    text,
  street            text,
  zip               text,
  city              text,
  description       text,
  notes             text,

  -- Verknüpfungen
  customer_id       uuid references customers(id)      on delete set null,
  pipeline_card_id  uuid references pipeline_cards(id) on delete set null,

  -- Status
  status            text not null default 'offen'
                      check (status in ('offen','in_arbeit','wurde_zu_angebot','verworfen')),

  created_by        uuid references workers(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists inquiries_company_idx on inquiries(company_id);
create index if not exists inquiries_status_idx  on inquiries(status);
create index if not exists inquiries_created_idx on inquiries(created_at desc);

create or replace function inquiries_touch() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists inquiries_touch on inquiries;
create trigger inquiries_touch before update on inquiries
  for each row execute function inquiries_touch();

alter table inquiries enable row level security;

drop policy if exists inquiries_demo_all on inquiries;
create policy inquiries_demo_all on inquiries
  for all using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table inquiries;
exception when duplicate_object then null;
end$$;
