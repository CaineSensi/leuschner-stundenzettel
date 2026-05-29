-- ============================================================
-- Cleanup: doppelte Mitarbeiter zusammenfuehren  (2026-05-29)
-- ============================================================
-- Ursache: Der Stunden-Import hat fuer Bley + Ewald NEUE worker-IDs
-- angelegt, obwohl in der Live-DB bereits (leere) Datensaetze existierten.
-- Ziel: je 1 Datensatz pro Person, Stunden bleiben erhalten.
--
-- Kanonisch (behalten, traegt die Stunden):
--   Bley  = 00000000-0000-0000-0000-000000000014  (GaLa-Bau, 118,5 h)
--   Ewald = 00000000-0000-0000-0000-000000000015  (Aushilfe, 11 h)
-- ============================================================


-- ============================================================
-- TEIL 1 — DIAGNOSE  (zuerst ALLEIN ausfuehren und pruefen!)
-- Zeigt alle Mitarbeiter der Firma, ob sie ein Login haben und
-- wie viele Eintraege dranhaengen.
-- ------------------------------------------------------------
-- WICHTIG: Falls eine der zu loeschenden Dubletten "hat_login = true"
-- zeigt, NICHT loeschen, sondern kurz Bescheid geben -> dann haengt da
-- ein echter App-Account dran.
-- ============================================================
select
  w.id,
  w.initials,
  w.first_name,
  w.last_name,
  w.role,
  (w.auth_user_id is not null) as hat_login,
  (select count(*) from entries e where e.worker_id = w.id) as eintraege
from workers w
where w.company_id = '00000000-0000-0000-0000-000000000001'
order by w.last_name, w.first_name;


-- ============================================================
-- TEIL 2 — ZUSAMMENFUEHREN + AUFRAEUMEN
-- Erst ausfuehren, wenn Teil 1 ok ist. Laeuft in einer Transaktion:
-- bei Fehler wird nichts geschrieben.
-- ============================================================
begin;

-- 2a) Ewald: kanonischen Datensatz mit echtem Nachnamen versehen
update workers
set last_name = 'Helyenga', initials = 'EH'
where id = '00000000-0000-0000-0000-000000000015';

-- 2b) BLEY: evtl. vorhandene Eintraege der Dublette(n) auf den
--     kanonischen Datensatz umhaengen, dann Dublette(n) loeschen.
update entries
set worker_id = '00000000-0000-0000-0000-000000000014'
where worker_id in (
  select id from workers
  where company_id = '00000000-0000-0000-0000-000000000001'
    and id <> '00000000-0000-0000-0000-000000000014'
    and (lower(first_name) like 'hartwig%' or lower(last_name) like '%bley%')
);

delete from workers
where company_id = '00000000-0000-0000-0000-000000000001'
  and id <> '00000000-0000-0000-0000-000000000014'
  and (lower(first_name) like 'hartwig%' or lower(last_name) like '%bley%');

-- 2c) EWALD: dasselbe fuer Ewald-Dublette(n)
update entries
set worker_id = '00000000-0000-0000-0000-000000000015'
where worker_id in (
  select id from workers
  where company_id = '00000000-0000-0000-0000-000000000001'
    and id <> '00000000-0000-0000-0000-000000000015'
    and (lower(first_name) like 'ewald%' or lower(last_name) like '%helyenga%')
);

delete from workers
where company_id = '00000000-0000-0000-0000-000000000001'
  and id <> '00000000-0000-0000-0000-000000000015'
  and (lower(first_name) like 'ewald%' or lower(last_name) like '%helyenga%');

commit;


-- ============================================================
-- TEIL 3 — KONTROLLE (nach commit)
-- erwartet: genau 1x Bley (118,5 h) und 1x Ewald/Helyenga (11 h)
-- ============================================================
-- select w.first_name, w.last_name,
--        round(coalesce(sum(e.end_min - e.start_min - e.pause_min)
--              filter (where e.entry_type='work'),0)/60.0, 2) as arbeit_h,
--        count(*) filter (where e.entry_type='vacation') as urlaubstage
-- from workers w
-- left join entries e on e.worker_id = w.id
--      and e.date between '2026-05-01' and '2026-05-31'
-- where w.company_id = '00000000-0000-0000-0000-000000000001'
--   and (lower(w.last_name) like '%bley%' or lower(w.last_name) like '%helyenga%')
-- group by w.id, w.first_name, w.last_name;
