# Leuschner Stundenzettel · Offene Aufgaben

**Stand:** 27. Mai 2026
**Master-Branch:** `feat/parser-upgrade-sprint1` (65+ Commits jenseits von `main`, ungepusht)
**Live deployt:** `main` @ `64b823d` (21.05.) — Stand vor dem Parser-Sprint

---

## 🔁 Wiedereinstieg

Vollständige Setup-Anleitung in `../WIEDEREINSTIEG.md`. Kurzform:

```powershell
cd "L:\Leuschner APP\app"
git status
npm run dev      # http://localhost:5173
```

---

## 🔥 Kritisch · jetzt fällig

- [ ] **Migration `20260526200000_site_questions.sql` auf Live-DB einspielen** — Tabelle fehlt aktuell, Klärpunkte-Feature greift live nicht
- [ ] **Branch `feat/parser-upgrade-sprint1` nach `main` mergen** und auf Cloudflare Pages deployen — sonst läuft live noch der 21.05.-Stand ohne die ganzen Parser/Wetter/Material-Features
- [ ] Nach Deploy: Supabase URL-Configuration prüfen (Site-URL + Redirect-Allowlist auf `leuschner-stundenzettel.pages.dev`)

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
