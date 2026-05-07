# Deployment · Schritt für Schritt

Zwei Komponenten getrennt einrichten:

1. **Backend (Supabase)** — Datenbank, Auth, RLS
2. **Frontend (GitHub Pages)** — Auto-Deploy bei jedem Push

---

## 1 · Supabase einrichten (~30 Min)

### 1.1 Projekt anlegen

1. <https://supabase.com> → Sign up (oder mit GitHub einloggen)
2. **New project**:
   - Name: `leuschner-stundenzettel`
   - Region: **Frankfurt (eu-central-1)** ← wichtig wegen DSGVO
   - Database Password: generieren und speichern
3. Warten bis Provisioning fertig ist (~2 Min)

### 1.2 Schema migrieren

1. Im Supabase-Dashboard: **SQL Editor → New query**
2. Kompletten Inhalt von `supabase/migrations/20260508000000_init.sql` einfügen
3. **Run** klicken
4. Anschließend `supabase/seed.sql` ebenfalls einfügen und ausführen → Stamm­daten sind drin

### 1.3 API-Keys kopieren

Settings → API:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` → `VITE_SUPABASE_ANON_KEY`

Diese Werte trägst du:
- Lokal in `.env` (kopiert von `.env.example`)
- In GitHub als **Repository Secret** (siehe unten)

### 1.4 Auth einrichten (optional, später)

Authentication → Providers → **Email**:
- Confirm email: aus
- Magic Link: ein

In Phase 2 wird der Onboarding-Code-Flow gegen einen Magic-Link-Flow ausgetauscht.

---

## 2 · GitHub-Repo + Pages (~15 Min)

### 2.1 Repo anlegen

```bash
cd E:/Leuschner_Branding/app
git init
git add .
git commit -m "Initial: Leuschner Stundenzettel App"

# Auf GitHub neu erstellen: Repository "leuschner-stundenzettel"
git remote add origin https://github.com/<dein-user>/leuschner-stundenzettel.git
git branch -M main
git push -u origin main
```

### 2.2 GitHub Pages aktivieren

Repository → Settings → **Pages**:
- **Source**: GitHub Actions

### 2.3 Secrets setzen

Repository → Settings → Secrets and variables → **Actions** → New repository secret:

| Name | Wert |
|---|---|
| `VITE_SUPABASE_URL` | aus 1.3 |
| `VITE_SUPABASE_ANON_KEY` | aus 1.3 |

### 2.4 Erster Deploy

Push auf `main` triggert automatisch den Workflow `.github/workflows/deploy.yml`.
Erfolg im Tab **Actions** sichtbar. URL: `https://<dein-user>.github.io/leuschner-stundenzettel/`

---

## 3 · Custom Domain (Squarespace DNS)

Die Hauptseite bleibt bei Squarespace, die App läuft unter `app.galabauleuschner.de`.

### 3.1 Bei Squarespace im DNS-Manager

Domains → galabauleuschner.de → Advanced DNS Settings → **Add Custom Record**:

| Type  | Host | Data                    |
|-------|------|-------------------------|
| CNAME | app  | `<dein-user>.github.io` |

Speichern. DNS braucht 5 – 30 Min bis aktiv.

### 3.2 Bei GitHub im Repo

`public/CNAME` enthält bereits `app.galabauleuschner.de`. Beim nächsten Build wird daraus ein DNS-Eintrag mitgegeben.

Repository → Settings → Pages → **Custom domain**: `app.galabauleuschner.de` eintragen.
Häkchen **Enforce HTTPS** setzen (sobald Let's-Encrypt-Zertifikat fertig ist, ~10 Min).

---

## 4 · Testen

### Lokal

```bash
cp .env.example .env
# .env mit VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY befüllen
npm install
npm run dev
```

→ <http://localhost:5173>

### Live

→ <https://app.galabauleuschner.de> (nach DNS-Propagation)

---

## 5 · Bei Problemen

| Symptom | Ursache | Fix |
|---|---|---|
| 404 auf `app.galabauleuschner.de` | DNS noch nicht propagiert | 30 Min warten, dig im Terminal prüfen |
| App lädt, aber Login fehlschlägt | Supabase-Keys fehlen oder falsch | `.env` und GitHub Secrets prüfen |
| TypeScript-Fehler beim Build | Schema-Änderung in Supabase | `db.types.ts` aktualisieren |
| RLS verweigert Zugriff | Worker hat noch keinen `auth_user_id` | Manuelle Verknüpfung im SQL-Editor |
