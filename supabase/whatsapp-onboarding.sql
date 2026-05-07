-- ============================================================
-- Phase 2 · WhatsApp-Code-Onboarding
-- ============================================================
-- Workflow:
--   1) Admin (Rick) ruft create_invitation(worker_id) auf
--      → bekommt 6-stelligen Code (24 h gültig)
--   2) Code wird per WhatsApp an Mitarbeiter geschickt
--   3) Mitarbeiter öffnet App, signInAnonymously()
--   4) Mitarbeiter ruft redeem_invitation(code) auf
--      → workers.auth_user_id wird auf seine anonymous ID gesetzt
--      → ab jetzt sieht er nur seine eigenen Daten
-- ============================================================

-- 1) Telefonnummer-Spalte für Workers
alter table workers
  add column if not exists phone text;

-- 2) RPC: Einladungs-Code erzeugen (nur Admin)
create or replace function public.create_invitation(p_worker_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O/1/I/L
  v_code     text := '';
  v_pos      int;
begin
  if not is_admin() then
    raise exception 'Nur Administratoren können einladen';
  end if;

  -- 6-stelligen Code generieren (lesefreundlich)
  for i in 1..6 loop
    v_pos := floor(random() * length(v_alphabet))::int + 1;
    v_code := v_code || substr(v_alphabet, v_pos, 1);
  end loop;

  -- Speichern (alte unverwendete Codes für diesen Worker zuerst löschen)
  delete from invitations
    where worker_id = p_worker_id
      and used_at is null;

  insert into invitations (code, worker_id, invited_by, expires_at)
    values (v_code, p_worker_id, current_worker_id(), now() + interval '24 hours');

  return v_code;
end;
$$;

grant execute on function public.create_invitation(uuid) to authenticated;

-- 3) RPC: Code einlösen (verknüpft anonymous user mit worker)
create or replace function public.redeem_invitation(p_code text)
returns workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation invitations;
  v_worker     workers;
  v_user_id    uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Code prüfen (case-insensitive)
  select * into v_invitation
    from invitations
    where upper(code) = upper(p_code)
      and used_at is null
      and expires_at > now();

  if not found then
    raise exception 'Code ungültig oder abgelaufen';
  end if;

  -- Worker verknüpfen (nur wenn noch nicht verknüpft)
  update workers
    set auth_user_id = v_user_id
    where id = v_invitation.worker_id
      and auth_user_id is null
    returning * into v_worker;

  if v_worker.id is null then
    raise exception 'Mitarbeiter ist bereits an ein anderes Gerät gebunden';
  end if;

  -- Code als verbraucht markieren
  update invitations
    set used_at = now(), device_id = v_user_id::text
    where code = v_invitation.code;

  return v_worker;
end;
$$;

grant execute on function public.redeem_invitation(text) to authenticated;

-- 4) Hilfs-Policy: Mitarbeiter darf seinen eigenen workers-Eintrag lesen,
--    auch wenn die Demo-RLS-Policies später entfernt werden.
--    (Die echte Policy `workers_select` aus init.sql deckt das schon ab.)

-- 5) Demo-Policies können nach erfolgreichem WhatsApp-Onboarding entfernt werden:
--    drop policy if exists "demo_workers_read"   on workers;
--    drop policy if exists "demo_sites_read"     on sites;
--    drop policy if exists "demo_entries_read"   on entries;
--    drop policy if exists "demo_companies_read" on companies;
