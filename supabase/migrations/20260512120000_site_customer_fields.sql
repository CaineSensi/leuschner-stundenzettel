-- Erweiterung der sites-Tabelle um Kundendaten + sevDesk-Verknüpfung.
-- Damit lassen sich Adresse, Kontakt, Auftragsnummer und Plan-Summe je
-- Baustelle pflegen — automatisch oder von Hand. sevdesk_contact_id und
-- sevdesk_order_number sind Bindeglied für späteren API-Sync.

alter table sites
  add column if not exists zip                  text,
  add column if not exists customer_name        text,
  add column if not exists customer_phone       text,
  add column if not exists customer_email       text,
  add column if not exists sevdesk_contact_id   text,
  add column if not exists sevdesk_order_number text,
  add column if not exists estimate_net_eur     numeric(12,2),
  add column if not exists notes                text;

create index if not exists sites_sevdesk_contact_idx
  on sites(sevdesk_contact_id) where sevdesk_contact_id is not null;

create index if not exists sites_sevdesk_order_idx
  on sites(sevdesk_order_number) where sevdesk_order_number is not null;
