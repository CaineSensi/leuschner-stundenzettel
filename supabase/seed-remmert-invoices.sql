-- Rechnungen für Baustelle Remmert (sevDesk-Stand 2026-05-12).
-- Voraussetzung: Migration 20260512140000_site_invoices.sql ist drin.

insert into site_invoices (site_id, invoice_number, invoice_date, status, net_eur, gross_eur, paid_at, notes)
values
  ('ceaac537-7d6d-474d-995c-bb5a851b8c3b', 'RE-1248', '2026-03-31', 'paid', 1890.00, 2249.10, '2026-04-15 00:00+02', 'Erste Teilrechnung Pflasterarbeiten'),
  ('ceaac537-7d6d-474d-995c-bb5a851b8c3b', 'RE-1254', '2026-04-24', 'open', 2061.34, 2453.00, null, 'Zweite Teilrechnung, fällig 15.05.')
on conflict do nothing;

update site_invoices set due_at = '2026-05-15' where invoice_number = 'RE-1254';
