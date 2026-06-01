# Leuschner Stundenzettel · Offene Aufgaben

**Stand:** 01. Juni 2026 (Feierabend)
**Hauptapp (`app`):** `main` = `origin/main` = `7f025c3` ✓ gepusht · Live-Bundle `index-BHOcF0CK.js`
**Aufmaß-App (`aufmass`):** `main` = `8d9afeb` ✓ (lokal committed, KEIN Git-Remote — lebt auf dem Stick) · live `leuschner-aufmass.pages.dev`
Git = Live = lokal bei beiden Apps. Voller Stand: `../WIEDEREINSTIEG.md`.

---

## 🔁 Wiedereinstieg morgen am Laptop

```powershell
# Stick einstecken (L:), dann:
cd "L:\Leuschner APP\app"      && git pull origin main && npm install   # Hauptapp (Remote vorhanden)
cd "L:\Leuschner APP\aufmass"  && npm install                          # Aufmaß-App: LEAFLET ist NEU -> npm install Pflicht!
npm run dev   # je App, http://localhost:5173 bzw. 5174
```
> ⚠️ Die Aufmaß-App hat seit heute **Leaflet** als Dependency (GPS-Karte mit Luftbild). Ohne `npm install` bricht der Build. Sie hat **kein Git-Remote** — der Stick ist ihr Master, sie wandert nur mit dem Stick.

---

## 🔥 Kritisch · jetzt fällig

- Nichts blockiert. Alles synchron + live.

## 📋 Offen / nächste Schritte
- **Aufmaß-Flow auf echtem Tablet draußen testen** (GPS-Genauigkeit + Luftbild-Kontrolle + Kamera mit Handschuhen). Bisher nur mit gemocktem GPS verifiziert.
- **Dashboard-Tab-Bug auf dem Handy gegentesten** (Session-beim-Mount-Fix `6ab16e7`) — sollte „ständig F5" beheben.
- Optional: Bestands-Baustellen ohne Koordinaten geocoden, damit Luftbild + GPS-Erkennung überall greifen (aktuell 11/12 mit geo).
- Optional aufräumen: Test-Baustelle „GaLa Bau" (generische ID `…00a1`) — falls reine Testdaten.

---

## ✅ Drin seit 28.05. (Zeiterfassungs- & RLS-Block)

### RLS-Härtung
- Alle Demo-Policies (demo_*_read, *_demo_all, *_anon) entfernt
- Authenticated/Admin-Policies für alle Sprint-Tabellen (pipeline_cards, customers, inquiries, site_questions, site_materials, site_invoices, parse_corrections)
- Verifiziert: Anon-Key liefert auf 11 Tabellen `[]`
- Migration `20260528100000_rls_harden.sql` + `20260512160000_site_materials.sql` (war auf Stick, nun live)
- Supabase PAT (`sbp_…`) in KeePass `Supabase PAT Leuschner` — für DDL via Management-API

### Mitarbeiter-Modell
- `workers.daily_target_minutes` (Default 480, Rick 300)
- `workers.workdays integer[]` (Default Mo–Fr, Rick `{2,4}` = Di+Do)
- `paidMinutes()` und `isWorkdayFor()` Helper in `utils.ts`

### Disziplin VWG
- `discipline`-Enum um `VWG` (Verwaltung) erweitert
- `LOHNART_MAPPING` für VWG = `020` (Gehalt)
- Type-Updates in `types.ts` + `db.types.ts` + `Day.tsx`

### Rick als Worker konfiguriert
- 7 work-Entries Mai (jeden Di + Do je 5h Verwaltung)
- Site `11111111-…`: TEST-Präfix raus, jetzt "Leuschner Firmensitz · Weener", Adresse Industriestr. 4
- Feiertag-Auto-Lohn (Christi Himmelfahrt 14.5. wird ohne Entry mit 5h berechnet)

### Zeiterfassung 5. Tab "Monatsübersicht"
- Kalender-Grid 7 Spalten Mo–So
- KPIs: Σ Monat / Arbeitstage / Feiertage
- Mitarbeiter-Karten mit individuellem Soll (Workday-Set, Tagessoll)
- Admins mit Stunden sind jetzt in Auswertung sichtbar

### Druck-Stundenzettel
- Neue Route `/admin/stunden-print?worker=…&year=…&month=…`
- Klick auf Mitarbeiter-Karte in Monatsansicht öffnet Druck im neuen Tab
- Auto-`window.print()` nach 0,5s
- A4-kompakt (alle 28–31 Tage + Header + Bilanz + Unterschriften auf 1 Seite)
- Workday-bewusst: Mo/Mi/Fr/Sa/So bei Rick als „frei" grau
- Feiertag automatisch bezahlt wenn auf Workday
- App-Banner (Push/Offline/Install/Update) via `print:hidden` weg
- `@page A4 portrait` + `@media print` in `index.css`

### Sicherheit & Docs
- KeePass-Datei `Leuschners-KeyPass.kdbx` (Stick) + `DollartDrops-Zugaenge.kdbx` (E:) — 6 + 19 Einträge
- Klartext-Secrets (supabase-keys.md, github-recovery-codes.txt) geschreddert, sevDesk-Datei ohne API-Key
- Memory `project_leuschner_app.md` + `leuschner_stick_master.md`

---

## ✅ Heute drin (Sprint 19. – 27.05.)

### Pipeline & Vertrieb
- Pipeline-Kanban-Board `/admin/angebote` (6 Stages, archived_at, sent_at, freigabe-jsonb)
- Pipeline-Stage „Versendet" + 7-Tage-Nachfass-Hinweis
- Chef-Freigabe pro Angebots-Position (review_status, Stempel, Verlauf)
- Cheff-Flow als Live-Seite `/cheff-flow` mit WhatsApp-Vorschau
- Detail-Drawer 1080px breit, 2-Spalten-Layout
- Karten-Datum + Beleg-Positionen im Drawer

### Anfragen-Modul + KI-Parser
- Anfragen-Inbox `/admin/anfragen` als Uhrwerk
- Wizard `/admin/anfrage-neu` mit 3 Schritten (Rohtext → Parsen → Kunde matchen → Speichern)
- Workers AI Strukturierung (Llama 3.3 70B Default, 8B Fallback, Heuristik Notfall)
- Sprint-1: Modell-Upgrade auf 70B + Few-Shot + Cross-Validation
- Sprint-2: Pre-Cleaning + Self-Check + Active-Asking
- Sprint-3: Domain-Glossar + Multi-Leistung + Korrektur-Log
- M12 Material-Erkennung pro Leistung
- M13 Live-Pipeline-Visualisierung via SSE-Streaming
- M14 Quellen-Highlights im Originaltext
- Festnetz/Mobil als getrennte Felder
- Telefon-Parser-Sanity (kein Doppel-Match), Mobile-Regex-Fix
- LLM-Erkanntes (Mengen/Termin/Leistung) als Chips im Drawer
- S5 Wizard befüllt sich aus Anfrage-Positionen
- Heuristik-Parser: Grußformel raus, Telefon mit Slash, Pre-Check inquiries-Tabelle
- Live-Progress-Modal beim Anlegen
- Duplikat-Hänger gefixt

### Baustellen & SiteDetail
- SiteDetail nach Mockup-Variante 14 (Modal-Trigger + Karte + KPIs)
- Live-Wetter pro Baustelle via Buienradar
- Material-Status (`site_materials`)
- Klärpunkte (`site_questions` — Migration noch nicht live!)
- Satelliten-Toggle mit ESRI World Imagery
- Auto-Geocoding via Nominatim für Baustellen ohne GPS
- Zoom in Karte (Inline + Vollbild)
- Marker-Drag korrigiert Position + präziseres Geocoding
- Karten-Toggle z-Index über Leaflet-Layer
- Karten-Toggle außerhalb der Karte links oben + Google-Earth-Link
- Auto-Anlage Baustelle bei Auftrag-Stage (mit Dedupe)

### sevDesk-Anbindung
- Pages-Function-Proxy `/api/sevdesk/[[path]].ts`
- Initial-Import (Pipeline-Filter „Erledigte ausblenden")
- Contact-Anlage aus Wizard (`sevdeskCreateContact`)
- Belegpositionen-Übernahme (AN-… / RE-…)

### UI / Theme
- Theme „Stahl & Beton" (Welle 1 – 4 alle Routen umgestellt)
- Admin-Dashboard als Module-Grid
- Schiefer-Bühne + K1-Pipeline + Liquid-Pixel-Logo
- Inbox-Karten-Tooltips + Schnell-Aktionen
- InfoTip-Tooltips am Dashboard
- BackButton prominent + überall integriert
- Kontrast Self-Check
- Tooltips raus aus Sidebar (V16, 21.05.)
- Rick-Rolle korrigiert (Admin/Coder, nicht Inhaber)

### Backend / Infra
- 9 neue Migrationen (Pipeline-Familie, Customers, Inquiries, Parse-Corrections, Site-Questions, Site-Materials)
- Cloudflare Pages Function `/api/weather.ts` (Buienradar)
- Cloudflare Pages Functions `/api/llm/{structure,preclean,domain}.ts`
- Demo-Modus entfernt (klarer Fehler bei fehlendem Env)
- DATEV-CSV-Export (`datev.ts`)
- `.claude/` aus Tracking ausgeschlossen

---

## 🟡 Restarbeit · hoher Business-Wert

1. **„An Rick senden"-Submit-Sperre** (`entries.submitted_at`) — Mitarbeiter kann Woche einreichen, danach nicht mehr ändern
2. **DATEV-CSV mit Buchhalter abstimmen** — Export existiert in `datev.ts`, Format finalisieren
3. **Auftrags-Nachkalkulation** (Plan- vs. Ist-Stunden pro Baustelle) — Werte sind da (`pipeline_cards.planEur` + entries-Summen), Dashboard-Modul fehlt
4. **Live-Stunden-Tracker auf Home** (Counter bis Ende-Eintrag)
5. **RLS härten** — `demo-relax.sql`-Policies entfernen, nur authenticated Zugriff

## 🟢 Polish & Nice-to-haves

6. **Code-Splitting** — Bundle ~635 kB (exifr + leaflet sind die Brocken)
7. **Sentry / Error-Capture**
8. **Audit-Log** (GoBD-relevant)
9. **Stunden-Konto + Urlaub**
10. **Geo-Fence-Auto-Vorschlag** beim Eintragen
11. **Echte Push-Notifications** (VAPID + Edge-Function-Cron für 17:00 / 18:00)
12. **WeeklySummary** aus echten Entries statt Mock
13. **Statistik-Bereich Admin** (Stunden pro Baustelle / Tätigkeit / Quartal)

## 📋 Phase „Echte Stamm-Daten"

- [ ] Wolfgangs Telefon-Nummer
- [ ] Udos Telefon-Nummer
- [ ] Mathias' Telefon-Nummer
- [ ] Echte Stamm-Baustellen mit GPS-Koordinaten
- [ ] Bei Remmert die echte Adresse nachtragen (aktuell Beispiel `Hauptstr. 17, 26831 Bunde`)
- [ ] Vor-Foto-Watermarks bei Remmert: 3 Bilder neu hochladen über UI (Browser stempelt Datum+GPS+Baustelle drauf — die per Service-Role direkt eingespielten Vorab-Bilder haben das nicht)

## 🌐 Live-Domain & Push

- [ ] Squarespace-DNS: CNAME `app` → `cainesensi.github.io`
- [ ] HTTPS scharfschalten via `gh api -X PUT repos/.../pages -f https_enforced=true`
- [ ] Magic-Link-Test mit Custom-Domain
- [ ] Cloudflare Pages Git-Integration (Settings → Git) — auto-Deploy bei push statt manuell wrangler
- [ ] Alte Cloudflared-Tunnel-PWA vom Handy löschen, neu von Live-URL installieren

## 🎓 Schulung & Übergabe

- [ ] Datenschutz-Einwilligung formuliert
- [ ] Kurz-Anleitung 1-Seiten-PDF
- [ ] Schulung Wolfgang + Udo + Mathias
- [ ] Test-Woche live → Feedback-Runde

## 🔐 Sicherheit (Stick-bezogen)

- [ ] KeePass-Portable auf Stick legen (KeePass-Programm aktuell weder auf Stick noch global installiert)
- [ ] Klartext-Secrets in KDBX migrieren:
  - `_Sicherheit/supabase-keys.md` (Service-Secret!)
  - `_Sicherheit/github-recovery-codes.txt`
  - `SEVDESK.md` (API-Key)
- [ ] Master-Passwort für `Leuschners-KeyPass.kdbx` setzen (war noch jungfräulich?) — nur im Kopf / Passwort-Manager, nirgends auf Stick

---

## 📁 Wichtige Dateien

| Datei | Was |
|---|---|
| `../WIEDEREINSTIEG.md` | Setup-Anleitung beim Rechner-Wechsel |
| `../SEVDESK.md` | sevDesk API-Doku + Endpoints + Sample-Daten |
| `../_Sicherheit/` | Secrets-Ordner (Klartext + KDBX) |
| `src/App.tsx` | Routen + Auth-Guards |
| `src/routes/Admin.tsx` | Admin-Dashboard (Module-Grid) |
| `src/routes/AnfrageNeu.tsx` | KI-Parser-Wizard |
| `src/routes/SiteDetail.tsx` | Baustellen-Detail (Foto/Material/Klärpunkte/Wetter/Karte) |
| `src/lib/llm.ts` | Frontend-Wrapper für Workers-AI-Parser |
| `src/lib/pipeline.ts` | Pipeline-API (Stages, Cards, Freigabe) |
| `src/lib/sevdesk.ts` | sevDesk-Client |
| `src/lib/datev.ts` | DATEV-CSV-Export |
| `functions/api/llm/structure.ts` | Pages-Function: KI-Parser-Eskalation |
| `functions/api/weather.ts` | Pages-Function: Buienradar-Proxy |
| `tailwind.config.ts` | Theme „Stahl & Beton" |
| `supabase/migrations/` | 19 Migrationen, 1 fehlt noch live |
