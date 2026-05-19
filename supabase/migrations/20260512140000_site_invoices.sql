-- Rechnungen pro Baustelle. Quelle: sevDesk (Manual-Sync oder API).
-- Status spiegelt sevDesk-Status: paid (1000), open (200), overdue, cancelled, draft (100).

create table if not exists site_invoices (
  id                  uuid primary key default uuid_generate_v4(),
  site_id             uuid not null references sites(id) on delete cascade,
  invoice_number      text not null,
  invoice_date        date not null,
  status              text not null check (status in ('paid','open','overdue','cancelled','draft')),
  net_eur             numeric(12,2) not null,
  gross_eur           numeric(12,2),
  sevdesk_invoice_id  text,
  paid_at             timestamptz,
  due_at              date,
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists site_invoices_site_idx   on site_invoices(site_id);
create index if not exists site_invoices_status_idx on site_invoices(status);

alter table site_invoices enable row level security;

-- Demo-relax-Phase: alle dürfen lesen/schreiben (analog zu bestehenden Policies).
-- TODO: tighten beim demo-relax-Cleanup (RLS-Härtung TODO aus WIEDEREINSTIEG.md).
create policy site_invoices_demo_all on site_invoices
  for all using (true) with check (true);

-- Realtime für Live-Updates im Admin
alter publication supabase_realtime add table site_invoices;
