-- Neue Pipeline-Stufe "Versendet" zwischen "Angebot" und "Auftrag":
-- versendete Angebote sichtbar, Nachfassen nach Best-Practice-Frist (7 Tage).
-- Check-Constraint erweitern + sent_at (Versanddatum) ergaenzen.

alter table pipeline_cards drop constraint if exists pipeline_cards_stage_check;
alter table pipeline_cards add constraint pipeline_cards_stage_check
  check (stage in
    ('Anfrage','Angebot','Versendet','Auftrag','In Arbeit','Abgerechnet'));

alter table pipeline_cards add column if not exists sent_at timestamptz;
create index if not exists pipeline_cards_sent_idx on pipeline_cards(sent_at);
