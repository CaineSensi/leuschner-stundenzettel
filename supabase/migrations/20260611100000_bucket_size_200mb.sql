-- 11.06.2026: Bucket-Größenlimit auf 200 MB anheben.
-- Hintergrund: WhatsApp-Videos können >60 MB sein (62 MB Beispiel-Fall).
-- 200 MB ist ein praxistauglicher Wert für Handy-Videos bis ~5 Minuten.

update storage.buckets
  set file_size_limit = 200 * 1024 * 1024
  where id = 'entry-photos';
