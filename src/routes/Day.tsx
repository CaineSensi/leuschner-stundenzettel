import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listEntries, listSites } from "../lib/api";
import { listEntryPhotos } from "../lib/photos";
import { useRefreshOnVisible } from "../lib/realtime";
import { currentUser } from "../lib/auth";
import PhotoStrip from "../components/PhotoStrip";
import { fmtHours, fmtTime, shortDate, workMinutes } from "../lib/utils";
import { isWorkEntry, type Entry, type EntryPhoto, type Site } from "../lib/types";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Zeitüberschreitung: ${label}`)), ms)
    )
  ]);
}

export default function Day() {
  const { date } = useParams<{ date: string }>();
  const me = currentUser();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [photos, setPhotos] = useState<EntryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!me || !date) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      console.log("[day] load start", date);
      try {
        const [entries, sites] = await Promise.all([
          withTimeout(listEntries(me.id, date, date), 6000, "Eintrag laden")
            .catch((e) => { console.warn("[day] entries fail", e); return [] as Entry[]; }),
          withTimeout(listSites(), 6000, "Baustellen")
            .catch((e) => { console.warn("[day] sites fail", e); return [] as Site[]; })
        ]);
        if (cancelled) return;
        const e = entries[0] ?? null;
        setEntry(e);
        if (e && isWorkEntry(e)) {
          setSite(sites.find((s) => s.id === e.siteId) ?? null);
        } else {
          setSite(null);
        }
        // Fotos für diesen Eintrag laden
        if (e) {
          listEntryPhotos(e.id)
            .then((ps) => { if (!cancelled) setPhotos(ps); })
            .catch((err) => console.warn("[day] photos fail", err));
        }
        console.log("[day] load ok", { hasEntry: !!e });
      } catch (err: any) {
        console.error("[day] load FAIL", err);
        if (!cancelled) setError(err?.message ?? "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, me?.id, refreshKey]);

  useRefreshOnVisible(() => setRefreshKey((k) => k + 1));

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="h-mono text-paper/55 text-[12px]">Wird geladen …</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto">
        <p className="text-rust text-sm">{error}</p>
        <Link to="/" className="btn-ghost mt-4">Zurück zur Woche</Link>
      </main>
    );
  }

  if (!entry || !date) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto">
        <p className="h-mono text-paper/55">Kein Eintrag für diesen Tag.</p>
        <Link to="/" className="btn-ghost mt-4">Zurück zur Woche</Link>
      </main>
    );
  }

  const d = new Date(date);
  const dayLabel = d.toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
  });

  if (!isWorkEntry(entry)) {
    const meta = ABSENCE_META[entry.type];
    return (
      <main className="min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
        <header className="px-6 safe-top pt-3 flex items-center justify-between">
          <Link to="/" className="h-mono text-paper/55 text-[12px]">← Zurück</Link>
          <Link to={`/entry?date=${date}`} className="h-mono text-copper text-[12px]">Bearbeiten →</Link>
        </header>

        <section className={`px-6 pt-6 pb-8 ${meta.gradient} border-b border-ink/10`}>
          <div className="text-5xl mb-3">{meta.emoji}</div>
          <div className="h-mono text-copper text-[12px] uppercase">{dayLabel}</div>
          <h1 className="h-display text-3xl mt-1">{meta.title}</h1>
          {entry.endDate && entry.endDate !== entry.date && (
            <p className="h-mono text-paper/65 text-[12px] mt-1">
              bis {shortDate(entry.endDate)}
            </p>
          )}
        </section>

        <ul className="px-6 py-4 divide-y divide-ink/10">
          <Row label="Typ" value={meta.title} sub={meta.sub} />
          <Row label="Zeitraum" value={entry.endDate ? `${shortDate(entry.date)} – ${shortDate(entry.endDate)}` : `Nur ${shortDate(entry.date)}`} />
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

  // Work entry
  const min = workMinutes(entry);

  return (
    <main className="min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
      <header className="px-6 safe-top pt-3 flex items-center justify-between">
        <Link to="/" className="h-mono text-paper/55 text-[12px]">← Zurück</Link>
        <Link to={`/entry?date=${date}`} className="h-mono text-copper text-[12px]">Bearbeiten →</Link>
      </header>

      <section className="px-6 pt-4 pb-6 bg-gradient-to-br from-copper/15 to-transparent border-b border-ink/10">
        <div className="h-mono text-copper text-[12px] uppercase">{dayLabel}</div>
        {site?.projectNumber && (
          <div className="h-mono text-paper/55 text-[11px] mt-1">— Auftrag {site.projectNumber}</div>
        )}
        <h1 className="h-display text-3xl mt-1">{site?.name ?? "Baustelle (gelöscht)"}</h1>
        {site && (
          <p className="h-mono text-paper/55 text-[12px] mt-1">{site.street} · {site.city}</p>
        )}
        <div className="h-display text-6xl mt-3">
          {fmtHours(min)}<span className="text-copper text-3xl">h</span>
        </div>
      </section>

      <ul className="px-6 py-4 divide-y divide-ink/10">
        <Row label="Tätigkeit" value={entry.discipline} sub={DISCIPLINE_NAME[entry.discipline]} />
        <Row label="Zeit" value={`${fmtTime(entry.startMin)} – ${fmtTime(entry.endMin)}`} sub={`${entry.pauseMin} min Pause · ${fmtHours(min)} h netto`} />
        {entry.weather && <Row label="Wetter" value={WEATHER_LABEL[entry.weather]} sub={entry.note ?? "—"} />}
        <Row label="Standort" value={entry.geoVerified ? "GPS bestätigt" : "Manuell eingetragen"} sub={entry.geoVerified ? "± wenige Meter" : "Kein Geo-Match"} />
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
        {sub && <div className="h-mono text-paper/55 text-[11px] mt-0.5">{sub}</div>}
      </div>
    </li>
  );
}

const DISCIPLINE_NAME = { PFL: "Pflasterarbeiten", GTN: "Gartenarbeiten", ZAU: "Zaunbau" } as const;
const WEATHER_LABEL = { sun: "Sonnig", cloud: "Bewölkt", rain: "Regen", snow: "Schnee" } as const;

const ABSENCE_META = {
  sick:     { emoji: "🏥", title: "Krankheit", sub: "Krankschreibung",       gradient: "bg-gradient-to-br from-rust/20 to-transparent" },
  vacation: { emoji: "🏖", title: "Urlaub",    sub: "Geplant oder spontan",  gradient: "bg-gradient-to-br from-moss/25 to-transparent" },
  holiday:  { emoji: "🎉", title: "Feiertag",  sub: "Gesetzlicher Feiertag", gradient: "bg-gradient-to-br from-bronze/20 to-transparent" }
} as const;
