-- ============================================================
-- Chat · Nachrichten als Aufgaben markieren
-- ============================================================
-- Stand 2026-06-16. Einzelne Chat-Nachrichten können als Aufgabe markiert
-- und abgehakt werden; ein eigener „Aufgaben"-Bereich im Chat listet sie.
-- Geteilt (company-weit), Realtime über die bestehende messages-Publication.
--
-- Schreibrechte: Teilnehmer dürfen fremde Nachrichten per RLS NICHT direkt
-- ändern (wie beim read_at-Haken) → Markieren/Abhaken läuft über security-
-- definer-RPCs, die prüfen, dass der aktuelle Worker Sender oder Empfänger ist.
-- ============================================================

alter table messages
  add column if not exists is_task      boolean not null default false,
  add column if not exists task_done    boolean not null default false,
  add column if not exists task_done_at timestamptz,
  add column if not exists task_done_by uuid;

create index if not exists messages_is_task_idx on messages (is_task) where is_task;

-- Markieren / Demarkieren (Demarkieren setzt den Erledigt-Status zurück)
create or replace function set_message_task(p_message_id uuid, p_is_task boolean)
returns void language plpgsql security definer as $$
declare wid uuid;
begin
  wid := current_worker_id();
  update messages
     set is_task      = p_is_task,
         task_done    = case when p_is_task then task_done    else false end,
         task_done_at = case when p_is_task then task_done_at else null  end,
         task_done_by = case when p_is_task then task_done_by else null  end
   where id = p_message_id
     and (sender_id = wid or receiver_id = wid);
  if not found then
    raise exception 'Nachricht nicht gefunden oder kein Gespraechs-Teilnehmer';
  end if;
end;
$$;

-- Aufgabe abhaken / wieder öffnen
create or replace function set_task_done(p_message_id uuid, p_done boolean)
returns void language plpgsql security definer as $$
declare wid uuid;
begin
  wid := current_worker_id();
  update messages
     set task_done    = p_done,
         task_done_at = case when p_done then now() else null end,
         task_done_by = case when p_done then wid   else null end
   where id = p_message_id
     and is_task = true
     and (sender_id = wid or receiver_id = wid);
  if not found then
    raise exception 'Keine Aufgabe oder kein Gespraechs-Teilnehmer';
  end if;
end;
$$;

grant execute on function set_message_task(uuid, boolean) to authenticated, anon;
grant execute on function set_task_done(uuid, boolean)    to authenticated, anon;
