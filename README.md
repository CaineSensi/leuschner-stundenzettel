# Leuschner · Stundenzettel

Progressive Web App für die Wochen-Stundenerfassung bei **Rund um's Haus Leuschner e.K.** (Weener · Ostfriesland). Pflaster · Garten · Zaun.

Stand: Grundgerüst mit Mock-Daten. Backend (Supabase) ist im Code vorbereitet, aktuell aber noch nicht angeschlossen.

---

## Schnellstart

Voraussetzung: **Node.js ≥ 18** (`node -v` zum Prüfen).

```bash
cd E:/Leuschner_Branding/app
npm install
npm run dev
```

Dann im Browser öffnen: <http://localhost:5173>

Beim ersten Start landest du auf dem Onboarding (5 Schritte). Den Code-Schritt kannst du mit dem „Demo · ohne Code überspringen"-Button durchklicken.

## Was ist drin

- **Onboarding**-Flow (5 Schritte: Code → Profil → PIN → Berechtigungen → Fertig)
- **Login**-Screen (personalisiert auf Tim Janssen)
- **Wochenübersicht** mit Soll/Ist-Stunden und Tagesliste
- **Schnell-Eintrag** (Bottom-Sheet Flow: Baustelle → Tätigkeit + Zeit)
- **Tagesdetail** mit Material/Wetter/Standort-Info
- **Smart-GPS-Vorschlag** (Modus A) bei der Eingabe — fragt einmal Standort ab, schlägt nähste Stamm-Baustelle vor
- **PWA**: installierbar als App-Icon auf iOS und Android, funktioniert offline

## Stack

- Vite 5 · React 18 · TypeScript 5
- React Router 6
- Tailwind CSS 3 mit Custom-Theme (`tailwind.config.ts`)
- vite-plugin-pwa (Service Worker, Manifest)
- Fonts: Geist · Big Shoulders Display · JetBrains Mono (Google Fonts)

## Verzeichnis

```
src/
├── main.tsx              # Entry point + Router setup
├── App.tsx               # Routes + Auth-Guards
├── index.css             # Tailwind + Custom-Tokens
├── lib/
│   ├── types.ts          # Discipline, Site, Worker, Entry
│   ├── mockData.ts       # Tim, 6 Mitarbeiter, 6 Baustellen, KW-19-Einträge
│   ├── utils.ts          # Datum, Stunden, Geo-Distanz
│   └── auth.ts           # localStorage-Session (Mock)
├── components/
│   └── Logo.tsx
└── routes/
    ├── Onboarding.tsx
    ├── Login.tsx
    ├── Home.tsx          # Wochenübersicht
    ├── Entry.tsx         # 2-Step-Eingabe mit GPS
    └── Day.tsx
```

## Nächste Schritte

1. **Supabase-Projekt anlegen** (EU-Region: Frankfurt)
2. Schema migrieren (Tabellen: `workers`, `sites`, `entries`)
3. Row-Level-Security aktivieren (`mitarbeiter_id = auth.uid()`)
4. Magic-Link-Auth aktivieren oder eigenen Einladungs-Code-Flow
5. `.env` aus `.env.example` befüllen, Supabase-Client in `lib/supabase.ts` einbinden
6. Mock-Calls in `Home.tsx` / `Entry.tsx` durch echte Supabase-Queries ersetzen
7. Service Worker Background-Sync für Offline-Eingaben anschließen

## Build

```bash
npm run build      # erzeugt /dist
npm run preview    # lokaler Preview-Server
```

Der Build ist eine statische PWA — kann auf Hetzner, Vercel, Netlify, Cloudflare Pages oder einem eigenen NGINX deployed werden.

---

**Markenwelt:** Anthrazit (`#161A1C`) · Cream (`#ECE6D6`) · Bronze (`#B17B3D`).

Designsystem dokumentiert in `tailwind.config.ts` und `src/index.css`.
