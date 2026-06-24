import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listEntryPhotos } from "../lib/photos";
import { useRealtime } from "../lib/realtime";
import { useLiveData } from "../lib/live";
import { currentUser } from "../lib/auth";
import PhotoStrip from "../components/PhotoStrip";
import {
  attendanceEndMin, effectivePauseMin, fmtHours, fmtTime,
  isEntryActiveOn, shortDate, workMinutes
} from "../lib/utils";
import { isWorkEntry, type EntryPhoto } from "../lib/types";

export default function Day() {
  const { date } = useParams<{ date: string }>();
  const me = currentUser();

  // ── Daten aus zentralem Context ──────────────────────────────────────────
  const { entries, sites, isLoaded } = useLiveData();

  // Eintrag für diesen Tag (unterstützt mehrtägige Abwesenheiten via isEntryActiveOn)
  const entry = date ? (entries.find((e) => isEntryActiveOn(e, date)) ?? null) : null;
  const site = (entry && isWorkEntry(entry))
    ? (sites.find((s) => s.id === entry.siteId) ?? null)
    : null;

  // ── Fotos: lokal laden (nicht im Context) ────────────────────────────────
  const [photos, setPhotos] = useState<EntryPhoto[]>([]);

  useEffect(() => {
    if (!entry?.id) { setPhotos([]); return; }
    let cancelled = false;
    listEntryPhotos(entry.id)
      .then((ps) => { if (!cancelled) setPhotos(ps); })
      .catch((err) => console.warn("[day] photos fail", err));
    return () => { cancelled = true; };
  }, [entry?.id]);

  // Fotos live halten (entry_photos-Tabelle), Entries kommen bereits aus dem Context
  useRealtime(`day-photos-${date}`, ["entry_photos"], () => {
    if (entry?.id) {
      listEntryPhotos(entry.id).then(setPhotos).catch(console.warn);
    }
  });

  // ── Lade-Zustand ─────────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <main className="on-dark min-h-screen flex items-center justify-center">
        <div className="h-mono text-ink-2 text-[12px]">Wird geladen …</div>
      </main>
    );
  }

  if (!me || !date || !entry) {
    return (
      <main className="on-dark min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto">
        <p className="h-mono text-ink-2">Kein Eintrag für diesen Tag.</p>
        <Link to="/" className="btn-ghost mt-4">Zurück zur Woche</Link>
      </main>
    );
  }

  const dayLabel = new Date(date).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
  });

  // ── Abwesenheits-Ansicht ──────────────────────────────────────────────────
  if (!isWorkEntry(entry)) {
    const meta = ABSENCE_META[entry.type];
    return (
      <main className="on-dark min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
        <header className="px-6 safe-top pt-3 flex items-center justify-between">
          <Link to="/" className="h-mono text-ink-2 text-[12px]">← Zurück</Link>
          <Link to={`/entry?date=${date}`} className="h-mono text-copper text-[12px]">Bearbeiten →</Link>
        </header>

        <section className="surface-steel px-6 pt-6 pb-8 mt-3">
          <div className="text-5xl mb-3">{meta.emoji}</div>
          <div className="dd-eyebrow text-copper-bright">{dayLabel}</div>
          <h1 className="font-display font-black uppercase text-3xl text-white mt-1">{meta.title}</h1>
          {entry.endDate && entry.endDate !== entry.date && (
            <p className="font-sans text-steel text-[12px] mt-1">bis {shortDate(entry.endDate)}</p>
          )}
        </section>

        <ul className="px-6 py-4 divide-y divide-ink/10">
          <Row label="Typ" value={meta.title} sub={meta.sub} />
          <Row
            label="Zeitraum"
            value={entry.endDate
              ? `${shortDate(entry.date)} bis ${shortDate(entry.endDate)}`
              : `Nur ${shortDate(entry.date)}`}
          />
          {entry.note && <Row label="Notiz" value={entry.note} />}
        </ul>

        {photos.length > 0 && (
          <div className="px-6">
            <PhotoStrip existing={photos} />
          </div>
        )}
      </main>
    );
  }

  // ── Arbeits-Ansicht ───────────────────────────────────────────────────────
  const min = workMinutes(entry);

  return (
    <main className="on-dark min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
      <header className="px-6 safe-top pt-3 flex items-center justify-between">
        <Link to="/" className="h-mono text-ink-2 text-[12px]">← Zurück</Link>
        <Link to={`/entry?date=${date}`} className="h-mono text-copper text-[12px]">Bearbeiten →</Link>
      </header>

      <section className="surface-steel px-6 pt-4 pb-6 mt-3">
        <div className="dd-eyebrow text-copper-bright">{dayLabel}</div>
        {site?.projectNumber && (
          <div className="font-mono text-steel text-[11px] mt-1">Auftrag {site.projectNumber}</div>
        )}
        <h1 className="font-display font-black uppercase text-3xl text-white mt-1 leading-tight">
          {site?.name ?? "Baustelle (gelöscht)"}
        </h1>
        {site && (
          <p className="font-sans text-steel text-[12px] mt-1">{site.street} · {site.city}</p>
        )}
        <div className="font-display font-black text-6xl text-white mt-3 tabular-nums">
          {fmtHours(min)}<span className="text-copper-bright text-3xl">h</span>
        </div>
      </section>

      <ul className="px-6 py-4 divide-y divide-ink/10">
        <Row label="Tätigkeit" value={entry.discipline} sub={DISCIPLINE_NAME[entry.discipline]} />
        <Row
          label="Zeit"
          value={`${fmtTime(entry.startMin)} bis ${fmtTime(attendanceEndMin(entry))}`}
          sub={effectivePauseMin(entry) > 0
            ? `${fmtHours(min)} h bezahlt · inkl. ${effectivePauseMin(entry)} min Pause (unbezahlt, §4 ArbZG)`
            : `${fmtHours(min)} h bezahlt · keine Pause (≤ 6 h)`}
        />
        {entry.weather && (
          <Row label="Wetter" value={WEATHER_LABEL[entry.weather]} sub={entry.note ?? "keine Notiz"} />
        )}
        <Row
          label="Standort"
          value={entry.geoVerified ? "GPS bestätigt" : "Manuell eingetragen"}
          sub={entry.geoVerified ? "± wenige Meter" : "Kein Geo-Match"}
        />
      </ul>

      {photos.length > 0 && (
        <div className="px-6">
          <PhotoStrip existing={photos} />
        </div>
      )}
    </main>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <li className="grid grid-cols-[80px_1fr] gap-3 py-3">
      <span className="h-mono text-copper text-[12px]">{label}</span>
      <div>
        <div className="font-medium">{value}</div>
        {sub && <div className="h-mono text-ink-2 text-[11px] mt-0.5">{sub}</div>}
      </div>
    </li>
  );
}

const DISCIPLINE_NAME = {
  PFL: "Pflasterarbeiten", GTN: "Gartenarbeiten", ZAU: "Zaunbau",
  VWG: "Verwaltung", KUN: "Kunststoff-Vermahlung"
} as const;
const WEATHER_LABEL = { sun: "Sonnig", cloud: "Bewölkt", rain: "Regen", snow: "Schnee" } as const;

const ABSENCE_META = {
  sick:     { emoji: "🏥", title: "Krankheit", sub: "Krankschreibung" },
  vacation: { emoji: "🏖", title: "Urlaub",    sub: "Geplant oder spontan" },
  holiday:  { emoji: "🎉", title: "Feiertag",  sub: "Gesetzlicher Feiertag" }
} as const;
