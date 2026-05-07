-- ============================================================
-- Phase 2 · Auth-Setup
-- ============================================================
-- 1) Email-Spalte für Workers (Login per Magic Link)
-- 2) Rick's Email als ersten Test-Account setzen
-- 3) Trigger der bei Sign-Up automatisch workers.auth_user_id verknüpft
-- ============================================================

alter table workers
  add column if not exists email text;

create unique index if not exists workers_email_idx
  on workers(lower(email))
  where email is not null;

-- Rick's Email setzen (Admin-Account)
update workers
  set email = 'rick@dollartdrops.com'
  where last_name = 'Kohlberg' and email is null;

-- Auto-Verknüpfung: wenn jemand sich per Magic Link anmeldet,
-- wird sein workers-Eintrag automatisch verknüpft.
create or replace function public.link_worker_on_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workers
    set auth_user_id = new.id
    where lower(email) = lower(new.email)
      and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_worker_on_auth_signup();
