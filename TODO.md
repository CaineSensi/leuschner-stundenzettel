# Leuschner Stundenzettel · Offene Aufgaben

**Stand:** 06. Mai 2026, 14:00
**Letzter Schritt:** Theme komplett auf Hochkontrast (Schwarz/Weiß/Orange) + System-UI-Schriftart umgestellt. Bug-Fix `login()` setzt jetzt `onboarded`-Flag.

---

## 🔁 Wiedereinstieg nach Neustart

### 1) Dev-Server starten
```powershell
cd E:\Leuschner_Branding\app
npm run dev
```
→ läuft auf <http://localhost:5173>

### 2) Cloudflared-Tunnel starten (für Handy-Test)
```powershell
cloudflared tunnel --url http://localhost:5173
```
→ neue HTTPS-URL wird ausgegeben, Form: `https://<random>.trycloudflare.com`
→ URL ändert sich bei jedem Start (für stabile URL: Phase 5 Live-Deploy)

### 3) Auf Handy testen
- Alte PWA vom Home-Bildschirm löschen (URL hat sich geändert)
- Safari → neue Cloudflared-URL → Teilen → Zum Home-Bildschirm

### 4) Falls kein Test-Code in DB:
```sql
-- Im Supabase SQL Editor
delete from invitations
  where worker_id = (select id from workers where last_name = 'Jauken')
  and used_at is null;

insert into invitations (code, worker_id, invited_by, expires_at)
values (
  'TEST01',
  (select id from workers where last_name = 'Jauken'),
  (select id from workers where last_name = 'Kohlberg'),
  now() + interval '24 hours'
);
```

---

## ✅ Heute erledigt (06.05.2026)

- [x] **SQL-Suite ausgeführt** — Rick mit auth_user_id verknüpft, demo-relax-Policies aktiv, whatsapp-onboarding-RPCs angelegt
- [x] **Anonymous Sign-Ins** in Supabase aktiviert
- [x] **Bug Mitarbeiter-Liste leer** — gefixt durch SQL (Rick-Verknüpfung) + Demo-Policies
- [x] **Bug Demo-Login → Onboarding-Loop** — `login()` setzt jetzt `onboarded`-Flag in `src/lib/auth.ts`
- [x] **Cloudflared installiert** via winget
- [x] **Theme: Hochkontrast** (Schwarz/Weiß/Orange) — siehe unten Branding-Sektion
- [x] **Schriftart: System UI** (SF Pro auf iOS, Roboto auf Android, Segoe auf Windows)
- [x] **Schriftgrößen pauschal um ~20% hoch** (alle text-[8px-10px] → text-[10px-12px])
- [x] **Grain-Overlay deaktiviert** (störte auf reinem Weiß)
- [x] **Vite `allowedHosts`** auf `.trycloudflare.com` und `.ngrok-free.app` erweitert (vite.config.ts)

---

## 🎨 Branding · Finalisiert

| Token | Hex | Verwendung |
|---|---|---|
| `bg.DEFAULT` | `#FFFFFF` | Page-BG |
| `bg.deep` | `#000000` | Buttons, Avatar-BG |
| `bg.2` | `#F4F4F5` | Karten |
| `bg.3` | `#E5E7EB` | Hover/aktive Cards |
| `bg.4` | `#D1D5DB` | tieferer Hintergrund |
| `paper.DEFAULT` | `#000000` | Text |
| `copper.DEFAULT` | `#DC6E2D` | Orange-Akzent |
| `copper.bright` | `#F08A4D` | Highlight |
| `good` | `#15803D` | grün (positiv) |
| `rust` | `#B91C1C` | rot (warnend) |

Schrift: **System UI** für Body, **Big Shoulders Display** für Headlines, **JetBrains Mono** für Mono-Texte.

Mockup-Datei mit allen 10 Theme-Varianten (zur späteren Referenz): `E:\Leuschner_Branding\design-mockups\themes.html`

---

## 🟡 Phase 2 · Auth fertigstellen (Restarbeit)

- [ ] WhatsApp-Code-Flow End-to-End testen (Code generieren als Admin, einlösen am Handy)
- [ ] Magic-Link-Login als Admin durchspielen (Mail klicken → Admin-Dashboard)
- [ ] **Demo-Login-Buttons** aus `Login.tsx` entfernen, sobald Code-Flow rund ist
- [ ] **RLS härten** — `demo-relax.sql`-Policies entfernen, nur authenticated Zugriff

## 🟢 Phase 2.5 · Offline-Modus testen

- [ ] DevTools → Network → Offline → Eintrag speichern → Banner rot („Offline · 1 Eintrag wartet")
- [ ] Online → Auto-Sync → Banner grün
- [ ] Edge-Case: pending Eintrag, mehrere Sync-Versuche scheitern → markFailed setzt `attempts++` + `lastError`

## 🔵 Phase 3 · Speichern in DB scharf schalten (eigentlich schon offline drin)

- [ ] Submit-Week-Funktion (Freitag „An Rick senden") → ruft `submitWeek` aus `api.ts`
- [ ] DATEV-Export-Button im Admin → CSV-Download mit allen entries

## ⚪ Phase 4 · Echte Stammdaten

- [ ] Wolfgangs Phone-Nummer
- [ ] Udos Phone-Nummer
- [ ] Mathias' Phone-Nummer
- [ ] Echte Stamm-Baustellen mit GPS-Koordinaten
- [ ] Logo-Auswahl aus Vol. II finalisieren

## 🟢 Phase 5 · Live-Deployment

**Aktive Live-URL:** <https://leuschner-stundenzettel.pages.dev> (Cloudflare Pages, seit 08.05.2026)

- [x] GitHub-Repo `CaineSensi/leuschner-stundenzettel` (public) angelegt + Initial-Push
- [x] GitHub Secrets `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` gesetzt
- [x] GitHub Pages aktiviert (Source: GitHub Actions) — Workflow läuft, wartet auf DNS
- [x] Custom Domain `app.galabauleuschner.de` im Repo eingetragen
- [x] **Cloudflare Pages Projekt `leuschner-stundenzettel` angelegt + erster Deploy live**
- [x] API-Token nach Deploy revoked
- [ ] **Squarespace-DNS: CNAME `app` → `cainesensi.github.io`** (User-Aktion, wenn Zugriff wieder da)
- [ ] HTTPS scharfschalten via `gh api -X PUT repos/.../pages -f https_enforced=true`
- [ ] Supabase URL Configuration: Site-URL `https://leuschner-stundenzettel.pages.dev`, Redirect `https://leuschner-stundenzettel.pages.dev/**` (später Custom-Domain ergänzen)
- [ ] Magic-Link-Test mit Live-Domain
- [ ] Alte Cloudflared-PWA vom Handy löschen, neu von Live-URL installieren
- [ ] **Optional:** Cloudflare Pages Git-Integration (Dashboard → Pages-Projekt → Settings → Git) — dann wird jeder Push auto-deployt statt manuelles `wrangler pages deploy dist`

## Manueller Re-Deploy auf Cloudflare Pages

```powershell
cd E:\Leuschner_Branding\app
npm run build
$env:CLOUDFLARE_API_TOKEN = "<neu erstellter Token>"
npx wrangler pages deploy dist --project-name=leuschner-stundenzettel --branch=main --commit-dirty=true
```

Token erstellen: <https://dash.cloudflare.com/profile/api-tokens> → Create Token → Template "Edit Cloudflare Workers" → **Zone Resources auf "All zones"** umstellen (sonst Pflichtfeld-Fehler) → Continue → Create.

## ⚪ Phase 6 · Echte Push-Notifications (Background)

- [ ] VAPID-Keys generieren
- [ ] Service Worker um Push-Empfang erweitern
- [ ] Supabase Edge Function für Cron-Push (17:00 / 18:00)
- [ ] Push-Subscription-Speicher pro Worker

## ⚪ Phase 7 · Schulung & Übergabe

- [ ] Datenschutz-Einwilligung formuliert
- [ ] Kurz-Anleitung 1-Seiten-PDF
- [ ] Schulung für Wolfgang + Udo + Mathias
- [ ] Test-Woche live → Feedback-Runde
- [ ] DATEV-Export-Workflow mit Buchhaltung absprechen

---

## 💡 Nice-to-haves (später)

- [ ] Mehrtägiger Krank/Urlaub: Wochenenden überspringen bei Tageszählung
- [ ] Tagessoll/Wochensoll pro Mitarbeiter konfigurierbar
- [ ] Foto-Beleg pro Eintrag (Kamera-API)
- [ ] WeeklySummary aus echten Entries aggregieren statt Mock-Daten
- [ ] Statistik-Bereich für Admin: Stunden pro Baustelle, pro Tätigkeit, pro Quartal
- [ ] Native iOS/Android-App über Capacitor (falls Apple-Wrapper nötig wird)

---

## 📁 Wichtige Dateien

| Datei | Was es ist |
|---|---|
| `TODO.md` | Diese Datei — aktueller Stand |
| `SETUP.md` | Erstanleitung für Frischstart |
| `DEPLOY.md` | Deployment auf GitHub Pages + Squarespace DNS |
| `tailwind.config.ts` | **Theme-Tokens** (Hochkontrast B/W/Orange) |
| `index.html` | Schriftarten geladen (Big Shoulders, JetBrains Mono) |
| `src/index.css` | Body-Defaults, btn-Styles |
| `src/lib/auth.ts` | **Bug-Fix** — `login()` setzt onboarded |
| `src/routes/Admin.tsx` | Admin-Dashboard mit Mitarbeiter-Liste |
| `src/lib/sync.ts` | Offline-Sync-Logik |
| `supabase/whatsapp-onboarding.sql` | Bereits ausgeführt |
| `supabase/demo-relax.sql` | Aktiv — Phase 2 entfernen |
| `E:\Leuschner_Branding\design-mockups\themes.html` | Mockup mit 10 Theme-Varianten |
