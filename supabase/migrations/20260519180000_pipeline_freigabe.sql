-- Chef-Freigabe: pro Beleg ein freigabe-jsonb
-- ({ releasedBy, releasedAt, history:[{at,by,action}] }).
-- Positions-Review (OK/Kommentar/Änderung je Zeile) liegt im bestehenden
-- positions-jsonb, dafür ist KEINE Migration nötig.

alter table pipeline_cards add column if not exists freigabe jsonb;
