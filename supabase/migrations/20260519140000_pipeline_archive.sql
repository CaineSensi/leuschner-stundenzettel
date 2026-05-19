-- Archiv für die Angebote-Pipeline.
-- Eine Karte = ein Vorgang, wandert durch die Stufen, existiert nie doppelt.
-- Ist die Rechnung bezahlt, wird der Vorgang manuell archiviert: er fällt aus
-- dem aktiven Board, bleibt aber in der Archiv-Ansicht abrufbar.

alter table pipeline_cards
  add column if not exists archived_at timestamptz;

create index if not exists pipeline_cards_archived_idx
  on pipeline_cards(archived_at);
