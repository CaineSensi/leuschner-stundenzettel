# sevDesk → Supabase Import

Einmaliger Bulk-Import von sevDesk-Daten (Contacts/Orders/Invoices) in die
Leuschner-Stundenzettel-App. Refresh-Button für laufenden Sync kommt später.

## Ablauf

1. **API-Token bereitstellen** — Token liegt in `E:\Leuschner APP\SEVDESK.md`.
   In dieser Shell setzen:
   ```powershell
   $env:SEVDESK_TOKEN = '<token aus SEVDESK.md>'
   ```

2. **Daten holen** — zieht sevDesk-API in `data/*.json`:
   ```powershell
   .\fetch.ps1
   ```
   Filter:
   - Orders: nur ab 2026-01-01, ohne verworfene (Status 300/500)
   - Invoices: alle (sevDesk hat aktuell nur paid)
   - Contacts: nur die in den geholten Orders/Invoices referenziert sind

3. **SQL-Block bauen** — erzeugt `out/import-YYYY-MM-DD.sql`:
   ```powershell
   .\build-sql.ps1
   ```
   Reihenfolge im Block:
   1. Neue Migrationen (customers, site_invoices) — idempotent
   2. customers upsert auf sevdesk_contact_id
   3. sites auto-anlegen für angenommene Aufträge (status 1000) auf sevdesk_order_number
   4. pipeline_cards upsert auf sevdesk_order_id mit Stage-Mapping
   5. site_invoices upsert auf sevdesk_invoice_id

4. **Im Supabase-Dashboard SQL-Editor ausführen.**
   <https://supabase.com/dashboard/project/vejhsyrxpveunygyhqlo/sql/new>

5. **Verifikation** per Anon-Read:
   ```powershell
   .\verify.ps1
   ```
   Vergleicht Zeilenzahlen Live-DB ↔ Fetch-Snapshots.

## Daten/Out sind gitignored

`data/` und `out/` werden nicht eingecheckt — Sicherheits-Snapshots
und generierte SQL bleiben lokal auf dem Stick.
