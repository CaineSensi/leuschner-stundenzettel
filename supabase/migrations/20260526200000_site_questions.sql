-- Klärpunkte pro Baustelle (Idee #3, 26.05.2026)
-- ──────────────────────────────────────────────────────────────────────────
-- Offene Fragen, Klärungen, Wiedervorlagen pro Baustelle. Drei häufige
-- Klassen aus dem Tagesgeschäft:
--   - material   (z.B. "Naturstein oder Beton bei den Beeteinfassungen?")
--   - termin     (z.B. "Aufmaß-Termin Phase 2 ausstehend")
--   - technisch  (z.B. "Strom-Trasse vor Pflasterung markieren")
--   - sonstiges
--
-- Quelle kann eine Inquiry sein (Auto-Anlage bei Parser-Material-Alternativen
-- aus M12: wenn ein Material `note ~ 'alternativ'` hat, wird automatisch
-- ein Klärpunkt erzeugt).

create table if not exists site_questions (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,
  site_id             uuid not null references sites(id) on delete cascade,

  kind                text not null default 'sonstiges'
                        check (kind in ('material','termin','technisch','sonstiges')),
  title               text not null,
  detail              text,                  -- ausführlichere Notiz
  owner               text,                  -- "Rick" | "Udo" | "Wolfgang" | externe Person
  status              text not null default 'offen'
                        check (status in ('offen','wartet','erledigt','verworfen')),

  due_at              date,                  -- gewünschte Wiedervorlage
  resolved_at         timestamptz,           -- wann auf 'erledigt' gesetzt
  resolution_note     text,                  -- was war das Ergebnis?

  -- Verknüpfung zur Anfrage, falls Klärpunkt automatisch aus Parser-Material entstand
  source_inquiry_id   uuid references inquiries(id) on delete set null,
  source_field        text,                  -- z.B. 'leistungen[3].materialien[0]'

  created_by          uuid references workers(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists site_questions_site_idx    on site_questions(site_id);
create index if not exists site_questions_status_idx  on site_questions(status);
create index if not exists site_questions_due_idx     on site_questions(due_at) where status in ('offen','wartet');

create or replace function site_questions_touch() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists site_questions_touch on site_questions;
create trigger site_questions_touch before update on site_questions
  for each row execute function site_questions_touch();

-- RLS analog zu site_materials
alter table site_questions enable row level security;
drop policy if exists site_questions_demo_all on site_questions;
create policy site_questions_demo_all on site_questions
  for all using (true) with check (true);

-- Realtime für Live-Updates
do $$
begin
  alter publication supabase_realtime add table site_questions;
exception when duplicate_object then null;
end$$;
