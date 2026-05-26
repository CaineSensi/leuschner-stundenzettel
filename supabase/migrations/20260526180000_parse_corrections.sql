-- M11 · Korrektur-Log für den Strukturierungs-Parser (Sprint-3, 26.05.2026)
-- ──────────────────────────────────────────────────────────────────────────
-- Wenn der User im AnfrageNeu-Edit-Step oder im Anfragen-Drawer einen vom
-- LLM gelieferten Wert manuell korrigiert, wird ein Datensatz hier abgelegt.
-- Zweck: über 50–100 echte Korrekturen sehen wir Muster — welche Felder
-- macht das Modell systematisch falsch, welcher Parser-Pfad ist schwach,
-- bei welchen Vorgangs-Typen liegt es daneben. Material für Prompt-
-- Nachschärfung oder späteres Fine-Tuning.
--
-- WICHTIG: Diese Tabelle ist ZUSÄTZLICH — KEINE bestehenden Tabellen werden
-- angefasst, kein Schema-Wechsel an `inquiries`. Lösch-Cascade bei Inquiry
-- nur als Aufräum-Komfort (Korrektur ohne Bezug ist wertlos).

create table if not exists parse_corrections (
  id                   uuid primary key default uuid_generate_v4(),
  company_id           uuid not null references companies(id) on delete cascade,
  inquiry_id           uuid not null references inquiries(id) on delete cascade,

  -- Was wurde korrigiert?
  field                text not null,          -- 'customerName' | 'email' | 'phone' | 'leistung' | ...
  original_value       text,                   -- was das LLM geliefert hat (kann null sein bei "leer → ausgefüllt")
  corrected_value      text,                   -- was der User getippt hat (kann null sein bei "ausgefüllt → leer")

  -- Kontext für die Auswertung
  original_confidence  text check (original_confidence in ('high','medium','low')),
  parser               text,                   -- 'workers-ai-70b' | 'workers-ai-8b' | 'anthropic' | 'heuristic'
  model                text,                   -- '@cf/meta/llama-3.3-70b-instruct-fp8-fast' etc.
  vorgang              text,                   -- 'angebot' | 'termin' | ...

  created_by           uuid references workers(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists parse_corrections_company_idx  on parse_corrections(company_id);
create index if not exists parse_corrections_inquiry_idx  on parse_corrections(inquiry_id);
create index if not exists parse_corrections_field_idx    on parse_corrections(field);
create index if not exists parse_corrections_created_idx  on parse_corrections(created_at desc);

-- RLS analog zu `inquiries` — gleicher Zugriff für die Anon-Rolle, wir
-- speichern keine PII, die nicht ohnehin in `inquiries` steht.
alter table parse_corrections enable row level security;

drop policy if exists parse_corrections_read_anon  on parse_corrections;
drop policy if exists parse_corrections_write_anon on parse_corrections;

create policy parse_corrections_read_anon
  on parse_corrections for select
  using (true);

create policy parse_corrections_write_anon
  on parse_corrections for insert
  with check (true);

-- Hinweise:
-- - Updates/Deletes bewusst NICHT erlaubt: einmal protokolliert, bleibt's so.
-- - Bei vielen Korrekturen kann später eine View parse_corrections_summary
--   (field, count, häufigster original_value, häufigster corrected_value)
--   die Auswertung erleichtern.
