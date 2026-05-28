-- 28.05.2026 abends: entry_photos nimmt jetzt auch Video + Audio.
-- Hintergrund: WhatsApp-Anfragen kommen mit kurzen Vor-Ort-Videos +
-- Sprachnachrichten an. Damit die komplette Anhang-Story unter einer
-- Baustelle landen kann, weiten wir die Tabelle und den Bucket aus,
-- ohne den Tabellennamen oder die Path-Konvention zu brechen.
--
-- - kind: image (Default = Backward-Compat) | video | audio
-- - mime_type: optional, fuer Frontend-Player und korrekten Download-Header
-- - Bucket-Allowlist: + MP4/QuickTime/WebM, Opus/Ogg, M4A/MP3/AAC
-- - file_size_limit: 60 MB (vorher 20) - WhatsApp-PTT/-VID kommen drueber

alter table entry_photos
  add column if not exists kind text not null default 'image'
    check (kind in ('image','video','audio')),
  add column if not exists mime_type text;

create index if not exists entry_photos_kind_idx on entry_photos(kind);

update storage.buckets
  set file_size_limit    = 60 * 1024 * 1024,
      allowed_mime_types = array[
        'image/jpeg','image/png','image/webp','image/heic','image/heif',
        'video/mp4','video/quicktime','video/webm',
        'audio/ogg','audio/opus','audio/webm','audio/mpeg','audio/mp4','audio/x-m4a','audio/aac'
      ]
  where id = 'entry-photos';
