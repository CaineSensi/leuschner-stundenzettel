-- Angebote-Pipeline: Kanban-Board vom Lead bis zur bezahlten Rechnung.
-- Stages: Anfrage (app-eigen) → Angebot (sevDesk Order) → Auftrag (Baustelle)
--         → In Arbeit (entries laufen) → Abgerechnet (Invoice bezahlt).
-- Eine Karte kann mit einer Baustelle (sites) verknüpft sein; daraus fällt
-- die Nachkalkulation ab: plan_eur = Order.sumNet, actual_eur = Σ entries.

create table if not exists pipeline_cards (
  id                 uuid primary key default uuid_generate_v4(),
  company_id         uuid not null,
  stage              text not null default 'Anfrage'
                       check (stage in ('Anfrage','Angebot','Auftrag','In Arbeit','Abgerechnet')),
  customer_name      text not null,
  place              text,
  description        text,
  value_eur          numeric(12,2),
  open_points        text,
  doc_number         text,            -- AN-/RE-Nummer aus sevDesk (optional)
  sevdesk_order_id   text,
  sevdesk_invoice_id text,
  site_id            uuid references sites(id)   on delete set null,
  assigned_worker_id uuid references workers(id) on delete set null,
  plan_eur           numeric(12,2),   -- Plan (= sevDesk Order.sumNet)
  actual_eur         numeric(12,2),   -- Ist (= Σ entries × Satz)
  valid_until        date,            -- Angebotsgültigkeit (4 Wochen Standard)
  sort_order         int  not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pipeline_cards_stage_idx   on pipeline_cards(stage);
create index if not exists pipeline_cards_company_idx on pipeline_cards(company_id);

create or replace function pipeline_cards_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists pipeline_cards_touch on pipeline_cards;
create trigger pipeline_cards_touch before update on pipeline_cards
  for each row execute function pipeline_cards_touch();

alter table pipeline_cards enable row level security;

-- Demo-relax-Phase: alle dürfen lesen/schreiben (analog zu site_invoices etc.).
-- TODO: beim RLS-Cleanup auf authenticated/admin einschränken.
create policy pipeline_cards_demo_all on pipeline_cards
  for all using (true) with check (true);

alter publication supabase_realtime add table pipeline_cards;
