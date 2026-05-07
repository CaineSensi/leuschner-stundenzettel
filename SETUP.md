# Setup · Was du jetzt machen musst

Aktueller Stand: App läuft mit **Mock-Daten**, ist aber zu 100 % vorbereitet auf echtes Backend + Live-Deploy.

Es fehlen genau **drei Schritte von dir**, danach übernehme ich den Rest.

---

## Schritt A · Supabase-Projekt anlegen (5 Min)

1. <https://supabase.com> öffnen → mit deinem GitHub-Account einloggen
2. **New Project** klicken
3. Felder ausfüllen:
   - Name: `leuschner-stundenzettel`
   - Region: **Frankfurt (eu-central-1)** ← wichtig für DSGVO
   - Database Password: erzeugen lassen, **abspeichern** (nicht verloren gehen!)
4. Warten ~2 Minuten, bis Provisioning fertig ist

## Schritt B · Schema einspielen (3 Min)

Im Supabase-Dashboard:

1. **SQL Editor** → **New query**
2. Kompletten Inhalt von `supabase/migrations/20260508000000_init.sql` einfügen → **Run**
3. Neue Query → Inhalt von `supabase/seed.sql` einfügen → **Run**

Damit sind Tabellen, Policies und Stamm-Daten (Firma + Rick + Udo + Wolfgang + Mathias + 6 Baustellen) drin.

## Schritt C · Zwei Werte an mich geben (1 Min)

Im Supabase-Dashboard: **Settings → API**

| Feld | Was du brauchst |
|---|---|
| **Project URL** | beginnt mit `https://...supabase.co` |
| **anon (public) key** | langer JWT-Token, beginnt mit `eyJ...` |

→ Diese zwei Werte schickst du mir.

---

## Was ich danach übernehme

- `.env` lokal befüllen → App schaltet automatisch von Mock auf Live
- GitHub-Repo anlegen + Code pushen
- GitHub Pages aktivieren + Secrets setzen (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- DNS-Anleitung für Squarespace (`app.galabauleuschner.de` als CNAME)
- Erste Test-Einträge live machen, prüfen dass alles synchronisiert

---

## Optional · Was du nebenbei machen kannst

**Mathias' Telefonnummer** für späteren Login per SMS-Code:
- `+49 ...`

**Echte Stamm-Baustellen** (falls die Mock-Liste nicht stimmt):
- Name · Adresse · Disziplinen
- Ich aktualisiere das `seed.sql` und du fährst es neu aus

**GitHub-Username** für das App-Repo:
- z. B. `rickkohlberg` oder eigener Account
