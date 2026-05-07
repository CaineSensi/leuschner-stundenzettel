import { Link, useParams } from "react-router-dom";
import { CURRENT_WORKER, ENTRIES } from "../lib/mockData";
import { fmtHours, fmtTime, shortDate, siteById, workMinutes } from "../lib/utils";
import { isWorkEntry } from "../lib/types";

export default function Day() {
  const { date } = useParams<{ date: string }>();
  const entry = ENTRIES.find((e) => e.workerId === CURRENT_WORKER.id && e.date === date);

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
          <span className="h-mono text-paper/55 text-[12px]">Bearbeiten</span>
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

        <ul className="px-6 py-4 divide-y divide-ink/5">
          <Row label="Typ" value={meta.title} sub={meta.sub} />
          <Row label="Zeitraum" value={entry.endDate ? `${shortDate(entry.date)} – ${shortDate(entry.endDate)}` : `Nur ${shortDate(entry.date)}`} />
          {entry.note && <Row label="Notiz" value={entry.note} />}
        </ul>

        <div className="mt-auto px-6 grid grid-cols-2 gap-2">
          <button className="btn-ghost">Foto hinzufügen</button>
          <button className="btn-primary">Bestätigen</button>
        </div>
      </main>
    );
  }

  // Work entry
  const site = siteById(entry.siteId)!;
  const min = workMinutes(entry);

  return (
    <main className="min-h-screen flex flex-col safe-bottom max-w-md mx-auto">
      <header className="px-6 safe-top pt-3 flex items-center justify-between">
        <Link to="/" className="h-mono text-paper/55 text-[12px]">← Zurück</Link>
        <span className="h-mono text-paper/55 text-[12px]">Bearbeiten</span>
      </header>

      <section className="px-6 pt-4 pb-6 bg-gradient-to-br from-copper/15 to-transparent border-b border-ink/10">
        <div className="h-mono text-copper text-[12px] uppercase">{dayLabel}</div>
        <h1 className="h-display text-3xl mt-1">{site.name}</h1>
        <p className="h-mono text-paper/55 text-[12px] mt-1">{site.street} · {site.city}</p>
        <div className="h-display text-6xl mt-3">
          {fmtHours(min)}<span className="text-copper text-3xl">h</span>
        </div>
      </section>

      <ul className="px-6 py-4 divide-y divide-ink/5">
        <Row label="Tätigkeit" value={entry.discipline} sub={DISCIPLINE_NAME[entry.discipline]} />
        <Row label="Zeit" value={`${fmtTime(entry.startMin)} – ${fmtTime(entry.endMin)}`} sub={`${entry.pauseMin} min Pause · ${fmtHours(min)} h netto`} />
        {entry.weather && <Row label="Wetter" value={WEATHER_LABEL[entry.weather]} sub={entry.note ?? "—"} />}
        <Row label="Standort" value={entry.geoVerified ? "GPS bestätigt" : "Manuell eingetragen"} sub={entry.geoVerified ? "± wenige Meter" : "Kein Geo-Match"} />
      </ul>

      <div className="mt-auto px-6 grid grid-cols-2 gap-2">
        <button className="btn-ghost">Foto hinzufügen</button>
        <button className="btn-primary">Bestätigen</button>
      </div>
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
