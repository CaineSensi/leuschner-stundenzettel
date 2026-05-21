-- Erweiterung der inquiries-Tabelle für den polierten Inbox-Workflow:
-- * notes_log: Append-only-Verlauf (jsonb-Array von {at, by, kind, text}).
--              Die existierende `notes`-Spalte (Freitext) bleibt unverändert.
-- * priority:  niedrig / normal / hoch — für Sortierung und Visualisierung
--
-- Idempotent — läuft nach (oder zusammen mit) Migration 15.

alter table inquiries
  add column if not exists notes_log jsonb not null default '[]'::jsonb,
  add column if not exists priority  text  not null default 'normal'
    check (priority in ('niedrig','normal','hoch'));

create index if not exists inquiries_priority_idx on inquiries(priority);
