-- 28.05.2026 abends: archived_at auf workers + Chefs archivieren.
-- Hintergrund: Wolfgang Wilken und Udo Leuschner sind Inhaber/Geschaeftsfuehrer
-- bei Leuschner und tragen keine Stunden ein. Sie sollen aus den
-- Mitarbeiter-Listen/-Pickern verschwinden, ohne hart geloescht zu werden
-- (Reversibilitaet: archived_at = null setzt sie zurueck in die aktive Liste).

alter table workers
  add column if not exists archived_at timestamptz;

create index if not exists workers_company_active_idx
  on workers(company_id) where archived_at is null;

update workers
  set archived_at = now()
  where id in (
    '00000000-0000-0000-0000-000000000011',  -- Udo Leuschner (Inhaber/GF)
    '00000000-0000-0000-0000-000000000012'   -- Wolfgang Wilken (Inhaber/GF)
  )
  and archived_at is null;
