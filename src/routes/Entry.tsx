import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SITES } from "../lib/mockData";
import { saveEntryWithSync } from "../lib/sync";
import { currentUser } from "../lib/auth";
import { fmtHours, fmtTime } from "../lib/utils";
import {
  resolveCurrentLocation, fmtDistance,
  type ResolvedAddress, type SiteWithDistance, type GeoError
} from "../lib/geo";
import type { Discipline, EntryType, Site } from "../lib/types";

type Step = "type" | "site" | "activity" | "absence";

const DISCIPLINES: { id: Discipline; label: string; icon: JSX.Element }[] = [
  {
    id: "PFL",
    label: "Pflaster",
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor" className="w-7 h-7">
        <rect x="2" y="2" width="12" height="12" /><rect x="18" y="2" width="12" height="12" />
        <rect x="2" y="18" width="12" height="12" /><rect x="18" y="18" width="12" height="12" />
      </svg>
    )
  },
  {
    id: "GTN",
    label: "Garten",
    icon: (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <path d="M16 4 C 10 10, 10 22, 16 28 C 22 22, 22 10, 16 4 Z" />
        <line x1="16" y1="8" x2="16" y2="26" />
      </svg>
    )
  },
  {
    id: "ZAU",
    label: "Zaun",
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor" className="w-7 h-7">
        <rect x="4" y="6" width="3" height="22" /><rect x="14" y="6" width="3" height="22" /><rect x="24" y="6" width="3" height="22" />
        <rect x="2" y="12" width="28" height="2" /><rect x="2" y="22" width="28" height="2" />
      </svg>
    )
  }
];

const TYPE_OPTIONS: {
  id: EntryType; label: string; sub: string; emoji: string; tone: "primary" | "rust" | "moss" | "neutral";
}[] = [
  { id: "work",     label: "Arbeit",      sub: "Pflaster · Garten · Zaun", emoji: "🛠", tone: "primary" },
  { id: "sick",     label: "Krankheit",   sub: "Krankschreibung",          emoji: "🏥", tone: "rust" },
  { id: "vacation", label: "Urlaub",      sub: "Geplant oder spontan",     emoji: "🏖", tone: "moss" },
  { id: "holiday",  label: "Feiertag",    sub: "Gesetzlicher Feiertag",    emoji: "🎉", tone: "neutral" }
];

export default function Entry() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("type");
  const [type, setType] = useState<EntryType>("work");

  const [siteId, setSiteId] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<Discipline>("PFL");
  const [startMin, setStartMin] = useState(7 * 60);
  const [endMin, setEndMin] = useState(16 * 60 + 30);
  const [pause, setPause] = useState(30);

  const [absStart, setAbsStart] = useState(new Date().toISOString().slice(0, 10));
  const [absEnd, setAbsEnd] = useState("");
  const [absNote, setAbsNote] = useState("");

  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ready" | GeoError>("idle");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [nearbySites, setNearbySites] = useState<SiteWithDistance[]>([]);

  useEffect(() => {
    if (step !== "site") return;
    if (geoStatus !== "idle") return;
    let cancelled = false;
    setGeoStatus("loading");

    resolveCurrentLocation(SITES)
      .then((result) => {
        if (cancelled) return;
        setAccuracy(result.accuracy);
        setAddress(result.address);
        setNearbySites(result.nearbySites);
        setGeoStatus("ready");
      })
      .catch((err: GeoError) => {
        if (cancelled) return;
        setGeoStatus(err);
      });

    return () => { cancelled = true; };
  }, [step, geoStatus]);

  // Top-Treffer (nächste Stamm-Baustelle), wenn unter 500 m
  const nearest = nearbySites[0]?.distance != null && nearbySites[0].distance < 500
    ? nearbySites[0].site
    : null;

  const totalMin = Math.max(0, endMin - startMin - pause);

  function handleTypeSelect(t: EntryType) {
    setType(t);
    setStep(t === "work" ? "site" : "absence");
  }

  async function handleSave() {
    const me = currentUser();
    if (!me) { navigate("/login"); return; }
    const today = new Date().toISOString().slice(0, 10);

    const draft =
      type === "work"
        ? {
            type: "work" as const,
            workerId: me.id,
            date: today,
            siteId: siteId!,
            discipline,
            startMin,
            endMin,
            pauseMin: pause,
            geoVerified: nearest !== null
          }
        : {
            type,
            workerId: me.id,
            date: absStart,
            endDate: absEnd || absStart,
            note: absNote || undefined
          };

    try {
      await saveEntryWithSync(draft);
    } catch (err) {
      console.warn("save failed, but should be queued", err);
    }
    navigate("/", { replace: true });
  }

  if (step === "type") return <TypePicker onPick={handleTypeSelect} />;
  if (step === "absence")
    return (
      <AbsencePicker
        type={type as Exclude<EntryType, "work">}
        startDate={absStart}
        endDate={absEnd}
        note={absNote}
        onStart={setAbsStart}
        onEnd={setAbsEnd}
        onNote={setAbsNote}
        onBack={() => setStep("type")}
        onSave={handleSave}
      />
    );
  if (step === "site")
    return (
      <SitePicker
        geoStatus={geoStatus}
        address={address}
        accuracy={accuracy}
        nearbySites={nearbySites}
        nearest={nearest}
        selectedId={siteId}
        onSelect={setSiteId}
        onBack={() => setStep("type")}
        onNext={() => siteId && setStep("activity")}
      />
    );
  return (
    <ActivityTime
      siteId={siteId!}
      discipline={discipline}
      onDiscipline={setDiscipline}
      startMin={startMin}
      endMin={endMin}
      pause={pause}
      totalMin={totalMin}
      onStart={setStartMin}
      onEnd={setEndMin}
      onPause={setPause}
      onBack={() => setStep("site")}
      onSave={handleSave}
    />
  );
}

function TypePicker({ onPick }: { onPick: (t: EntryType) => void }) {
  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <Link to="/" className="h-mono text-paper/55 text-[12px]">← Zurück</Link>
        <span className="h-mono text-copper">Schritt 0 / 3</span>
      </header>

      <h1 className="h-display text-3xl mt-6">Was war heute?</h1>
      <p className="h-mono text-paper/55 text-[12px] mt-1.5">— Wähle einen Eintrags-Typ</p>

      <div className="grid grid-cols-2 gap-3 mt-8 flex-1 content-start">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onPick(opt.id)}
            className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-3 active:scale-[0.98] transition-transform border ${
              opt.tone === "primary"
                ? "bg-bg-2 border-copper/40"
                : opt.tone === "rust"
                ? "bg-bg-2 border-rust/40"
                : opt.tone === "moss"
                ? "bg-bg-2 border-moss-bright/40"
                : "bg-bg-2 border-ink/10"
            }`}
          >
            <span className="text-4xl">{opt.emoji}</span>
            <div className="text-center">
              <div className="h-display text-xl">{opt.label}</div>
              <div className="h-mono text-paper/45 text-[12px] mt-1 px-2">{opt.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

function AbsencePicker({
  type, startDate, endDate, note, onStart, onEnd, onNote, onBack, onSave
}: {
  type: Exclude<EntryType, "work">;
  startDate: string;
  endDate: string;
  note: string;
  onStart: (s: string) => void;
  onEnd: (s: string) => void;
  onNote: (s: string) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const labels = {
    sick:     { title: "Krankheit", emoji: "🏥", note: "z. B. Arzt-Attest, Hausarzt …" },
    vacation: { title: "Urlaub",    emoji: "🏖", note: "z. B. Brückentag, Familie …" },
    holiday:  { title: "Feiertag",  emoji: "🎉", note: "z. B. Christi Himmelfahrt" }
  };
  const meta = labels[type];
  const days = endDate
    ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
    : 1;

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-paper/55 text-[12px]">← Zurück</button>
        <span className="h-mono text-copper">Schritt 1 / 1</span>
      </header>

      <div className="mt-6 flex items-center gap-4">
        <div className="text-5xl">{meta.emoji}</div>
        <div>
          <h1 className="h-display text-3xl">{meta.title}</h1>
          <p className="h-mono text-paper/55 text-[12px] mt-1">— {days} {days === 1 ? "Tag" : "Tage"}</p>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <DateField label="Von" value={startDate} onChange={onStart} />
        <DateField label="Bis (optional)" value={endDate} onChange={onEnd} placeholder="leer = nur ein Tag" />

        <div>
          <label className="h-mono text-copper text-[12px] block mb-1.5">— Notiz (optional)</label>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={meta.note}
            rows={2}
            className="w-full bg-bg-3 border border-ink/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-copper resize-none"
          />
        </div>
      </div>

      <button onClick={onSave} className="btn-primary w-full mt-auto">
        {meta.title} eintragen · {days} {days === 1 ? "Tag" : "Tage"}
      </button>
    </main>
  );
}

function DateField({
  label, value, onChange, placeholder
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="h-mono text-copper text-[12px] block mb-1.5">— {label}</label>
      <input
        type="date"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-3 border border-ink/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-copper"
      />
    </div>
  );
}

function SitePicker({
  geoStatus, address, accuracy, nearbySites, nearest,
  selectedId, onSelect, onBack, onNext
}: {
  geoStatus: "idle" | "loading" | "ready" | GeoError;
  address: ResolvedAddress | null;
  accuracy: number | null;
  nearbySites: SiteWithDistance[];
  nearest: Site | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const sorted = useMemo(
    () => [...SITES].sort((a, b) =>
      Number(!!b.starred) - Number(!!a.starred) || a.name.localeCompare(b.name, "de")
    ),
    []
  );

  const otherNearby = nearbySites
    .filter((n) => n.site.id !== nearest?.id && n.distance < 2000)
    .slice(0, 3);

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-paper/55 text-[12px]">← Zurück</button>
        <span className="h-mono text-copper">Schritt 1 / 2</span>
      </header>

      <h1 className="h-display text-3xl mt-6">Welche Baustelle?</h1>

      <GeoBanner geoStatus={geoStatus} address={address} accuracy={accuracy} />

      {nearest && (
        <button
          onClick={() => onSelect(nearest.id)}
          className={`mt-3 w-full text-left rounded-xl p-3.5 border ${
            selectedId === nearest.id
              ? "bg-gradient-to-br from-copper/25 to-copper/8 border-copper"
              : "bg-bg-2 border-copper/40"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-copper opacity-25 animate-ping" />
              <span className="relative w-3 h-3 rounded-full bg-copper-bright border-2 border-bg-2" />
            </div>
            <div className="flex-1">
              <div className="h-mono text-copper text-[11px]">
                — Stamm-Baustelle · {fmtDistance(nearbySites[0]?.distance ?? 0)} entfernt
              </div>
              <div className="font-bold text-[15px] mt-0.5">{nearest.name}</div>
              <div className="h-mono text-paper/55 text-[11px]">{nearest.street} · {nearest.city}</div>
            </div>
            <div className={`w-5 h-5 rounded-full ${selectedId === nearest.id ? "bg-copper text-bg-deep" : "border border-copper"} flex items-center justify-center text-[11px] font-bold`}>
              {selectedId === nearest.id ? "✓" : ""}
            </div>
          </div>
        </button>
      )}

      {otherNearby.length > 0 && (
        <>
          <div className="h-mono text-paper/45 text-[11px] mt-4 mb-1.5">— Auch in der Nähe</div>
          <ul className="space-y-1.5">
            {otherNearby.map(({ site, distance }) => (
              <li key={site.id}>
                <button
                  onClick={() => onSelect(site.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 ${
                    selectedId === site.id
                      ? "bg-gradient-to-br from-copper/20 to-bg-3 border border-copper"
                      : "bg-bg-2 border border-ink/10"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-display font-extrabold text-xs ${
                    selectedId === site.id ? "bg-copper text-bg-deep" : "bg-bg-4 text-copper-bright"
                  }`}>
                    {site.name.split(" ").slice(-1)[0].slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13px] leading-tight">{site.name}</div>
                    <div className="h-mono text-paper/50 text-[10px]">
                      {fmtDistance(distance)} · {site.street}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="h-mono text-paper/45 text-[11px] mt-4 mb-2">— Alle Baustellen</div>

      <ul className="space-y-1.5 flex-1 overflow-y-auto pb-4">
        {sorted.map((site) => (
          <li key={site.id}>
            <button
              onClick={() => onSelect(site.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 ${
                selectedId === site.id
                  ? "bg-gradient-to-br from-copper/20 to-bg-3 border border-copper"
                  : "bg-bg-3 border border-transparent"
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-display font-extrabold text-xs ${
                selectedId === site.id ? "bg-copper text-bg-deep" : "bg-bg-4 text-copper-bright"
              }`}>
                {site.name.split(" ").slice(-1)[0].slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] leading-tight">{site.name}</div>
                <div className="h-mono text-paper/50 text-[12px]">{site.street} · {site.city}</div>
              </div>
              {site.starred && <span className="text-copper text-base">★</span>}
            </button>
          </li>
        ))}
      </ul>

      <button
        disabled={!selectedId}
        onClick={onNext}
        className="btn-primary w-full mt-2 disabled:opacity-40 disabled:active:scale-100"
      >
        Weiter · Tätigkeit
      </button>
    </main>
  );
}

function GeoBanner({
  geoStatus, address, accuracy
}: {
  geoStatus: "idle" | "loading" | "ready" | GeoError;
  address: ResolvedAddress | null;
  accuracy: number | null;
}) {
  if (geoStatus === "idle" || geoStatus === "loading") {
    return (
      <div className="mt-4 px-3 py-2.5 bg-bg-2 border border-ink/10 rounded-lg flex items-center gap-3">
        <span className="text-lg animate-pulse">📍</span>
        <div className="h-mono text-paper/55 text-[12px]">Standort wird ermittelt …</div>
      </div>
    );
  }
  if (geoStatus === "permission_denied") {
    return (
      <div className="mt-4 px-3 py-2.5 bg-rust/10 border border-rust/40 rounded-lg">
        <div className="h-mono text-rust text-[11px]">— Standort blockiert</div>
        <p className="text-[12px] text-paper/75 mt-0.5 leading-snug">
          iPhone: Einstellungen → Safari → Standort → Erlauben. Dann diese Seite neu öffnen.
        </p>
      </div>
    );
  }
  if (geoStatus === "position_unavailable" || geoStatus === "timeout" || geoStatus === "unsupported") {
    return (
      <div className="mt-4 px-3 py-2.5 bg-bg-2 border border-ink/15 rounded-lg">
        <div className="h-mono text-paper/55 text-[11px]">— Kein Standort verfügbar</div>
        <p className="text-[12px] text-paper/65 mt-0.5">
          Wähle die Baustelle manuell aus der Liste unten.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 px-3 py-2.5 bg-bg-2 border border-good/40 rounded-lg flex items-start gap-3">
      <span className="text-lg leading-none mt-0.5">📍</span>
      <div className="flex-1 min-w-0">
        <div className="h-mono text-good text-[11px]">
          — Standort {accuracy ? `· ±${accuracy} m` : ""}
        </div>
        <div className="text-[13px] font-semibold mt-0.5 leading-snug">
          {address?.display ?? "Adresse wird gesucht …"}
        </div>
      </div>
    </div>
  );
}

function ActivityTime({
  siteId, discipline, onDiscipline,
  startMin, endMin, pause, totalMin,
  onStart, onEnd, onPause,
  onBack, onSave
}: {
  siteId: string;
  discipline: Discipline;
  onDiscipline: (d: Discipline) => void;
  startMin: number;
  endMin: number;
  pause: number;
  totalMin: number;
  onStart: (m: number) => void;
  onEnd: (m: number) => void;
  onPause: (p: number) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const site = SITES.find((s) => s.id === siteId)!;

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-paper/55 text-[12px]">← Zurück</button>
        <span className="h-mono text-copper">Schritt 2 / 2</span>
      </header>

      <div className="mt-2">
        <div className="h-mono text-paper/55 text-[11px]">— {site.street} · {site.city}</div>
        <h1 className="h-display text-2xl">{site.name}</h1>
      </div>

      <section className="mt-6">
        <div className="h-mono text-copper text-[12px] mb-2">— Was wird gemacht?</div>
        <div className="grid grid-cols-3 gap-2">
          {DISCIPLINES.map((d) => {
            const active = discipline === d.id;
            return (
              <button
                key={d.id}
                onClick={() => onDiscipline(d.id)}
                className={`flex flex-col items-center gap-2 rounded-xl py-4 px-2 border transition-colors ${
                  active
                    ? "bg-copper text-bg-deep border-copper-bright"
                    : "bg-bg-3 border-transparent text-paper"
                }`}
              >
                {d.icon}
                <span className="h-mono text-[12px]">{d.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <div className="h-mono text-copper text-[12px] mb-2">— Wann?</div>
        <div className="bg-bg-3 rounded-xl p-4 text-center">
          <div className="h-display text-3xl">
            {fmtTime(startMin)}<span className="text-copper mx-2">—</span>{fmtTime(endMin)}
          </div>
          <div className="h-mono text-copper text-[11px] mt-2">
            Σ Arbeitszeit · <span className="font-display text-paper text-sm">{fmtHours(totalMin)} h</span>
          </div>
        </div>

        <TimeSlider value={startMin} onChange={onStart} label="Anfang" />
        <TimeSlider value={endMin}   onChange={onEnd}   label="Ende" />

        <div className="bg-bg-3 rounded-xl px-4 py-3 mt-3 flex items-center justify-between">
          <div>
            <div className="h-mono text-paper/60 text-[12px]">— Pause</div>
            <div className="font-semibold">{pause} Minuten</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => onPause(Math.max(0, pause - 15))} className="w-8 h-8 rounded-full bg-bg-2 border border-ink/10 font-bold">−</button>
            <span className="h-display text-xl w-9 text-center">{pause}</span>
            <button onClick={() => onPause(pause + 15)} className="w-8 h-8 rounded-full bg-bg-2 border border-ink/10 font-bold">+</button>
          </div>
        </div>
      </section>

      <button onClick={onSave} className="btn-primary w-full mt-auto">
        Speichern · {fmtHours(totalMin)} h
      </button>
    </main>
  );
}

function TimeSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const min = 6 * 60, max = 18 * 60, step = 15;
  return (
    <div className="mt-3">
      <div className="flex justify-between h-mono text-paper/45 text-[11px] mb-1">
        <span>{label}</span>
        <span>{fmtTime(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-copper"
      />
    </div>
  );
}
