-- Stornierung von Pipeline-Vorgängen (Angebote, Aufträge).
-- cancelled_at = Zeitpunkt der Stornierung
-- cancellation_reason = freier Grund-Text (optional)
-- Storno setzt zusätzlich archived_at, damit die Karte aus dem aktiven Board rutscht.

alter table pipeline_cards
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancellation_reason text;

-- Im Archiv kann man stornierte schnell finden
create index if not exists pipeline_cards_cancelled_idx
  on pipeline_cards (cancelled_at)
  where cancelled_at is not null;
