// LiveWeather · zeigt aktuelle Wetterdaten + 3-Tage-Forecast für gegebene
// GPS-Koordinaten. Quelle: /api/weather (Buienradar-Proxy, nächste Station
// Haversine-basiert). Wird im Admin (zentral Weener) und im SiteDetail
// (pro Baustellen-GPS) verwendet.
//
// Klick auf einen Forecast-Tag → Detailpanel direkt darunter.
// Props: lat/lng optional, default Weener.

import { useState, useEffect } from "react";

interface WeatherCurrent {
  temperature: number; feelsLike: number;
  windSpeed: number; windBft: number; windDirection: string;
  humidity: number; precipitation: number;
  weather: string; emoji: string; iconCode: string;
  timestamp: string;
}
interface WeatherDayItem {
  date: string; minT: number; maxT: number;
  rainChance: number; sunChance: number; windBft: number; windDirection: string;
  rainMmMin: number; rainMmMax: number;
  weather: string; emoji: string; iconCode: string;
}
export interface WeatherPayload {
  station: { name: string; lat: number; lng: number; distanceKm: number };
  current: WeatherCurrent;
  forecast: WeatherDayItem[];
  summary: string;
  fetchedAt: string;
}

interface Props {
  lat?: number;
  lng?: number;
  /** Visuelle Variante: 'card' = bündige Karten-Optik (für Quick-Cards im
   *  SiteDetail), 'panel' = pures Inline-Panel (für Admin-Modul-Variante). */
  variant?: "card" | "panel";
  /** Optionale Überschrift; wenn weggelassen, nur Wetter ohne Header. */
  label?: string;
}

export function LiveWeather({ lat = 53.17, lng = 7.36, variant = "card", label }: Props) {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setSelectedDay(null);
    fetch(`/api/weather?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d as WeatherPayload); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [lat, lng]);

  const dayLabel = (iso: string, idx: number): string => {
    if (idx === 0) return "Heute";
    if (idx === 1) return "Morgen";
    const d = new Date(iso);
    return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
  };

  const fullDayLabel = (iso: string): string => {
    return new Date(iso).toLocaleDateString("de-DE", {
      weekday: "long", day: "2-digit", month: "long"
    });
  };

  if (error && !data) {
    return (
      <div className={variant === "card" ? "px-4 py-3" : ""}>
        <p className="font-mono text-[11px] text-rust">Wetter-API nicht erreichbar ({error})</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={variant === "card" ? "px-4 py-3" : ""}>
        <p className="font-mono text-[11px] text-ink-mute">Lade Wetter …</p>
      </div>
    );
  }

  const days = data.forecast.slice(0, 4);
  const detail = selectedDay !== null ? days[selectedDay] : null;

  return (
    <div className={variant === "card" ? "px-4 lg:px-5 pb-3 pt-3" : ""}>
      {label && (
        <div className="dd-eyebrow text-ink-2 mb-2">{label}</div>
      )}

      {/* Aktuell prominent */}
      <div className="flex items-center gap-3 mb-2.5">
        <span className="text-3xl leading-none" title={data.current.weather}>{data.current.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-black text-2xl leading-none tabular-nums">
            {Math.round(data.current.temperature)}°
            <span className="text-[12px] text-ink-mute font-mono ml-1.5">gefühlt {Math.round(data.current.feelsLike)}°</span>
          </div>
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-mute mt-0.5 truncate">
            {data.current.weather} · Wind {data.current.windDirection} {data.current.windBft} Bft
          </div>
        </div>
        {/* Luftfeuchtigkeit + Niederschlag aktuell */}
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-[10px] text-ink-mute">{data.current.humidity}% 💧</div>
          {data.current.precipitation > 0 && (
            <div className="font-mono text-[10px] text-copper">{data.current.precipitation} mm</div>
          )}
        </div>
      </div>

      {/* 4-Tage-Forecast — anklickbar */}
      <div className="flex gap-2 mb-2">
        {days.map((day, idx) => {
          const isSelected = selectedDay === idx;
          return (
            <button
              key={day.date}
              onClick={() => setSelectedDay(isSelected ? null : idx)}
              className={[
                "flex-1 text-center py-2 rounded-md border transition-all duration-150",
                "active:scale-[0.97] cursor-pointer select-none",
                isSelected
                  ? "border-copper bg-copper/15 ring-1 ring-copper/40"
                  : idx === 0
                    ? "border-copper bg-copper/8 hover:bg-copper/12"
                    : "border-steel-line/40 bg-bg-3/40 hover:bg-bg-3/80",
              ].join(" ")}
              title={`${fullDayLabel(day.date)} – Details anzeigen`}
            >
              <div className={`font-mono text-[9.5px] tracking-wider uppercase ${isSelected ? "text-copper font-bold" : idx === 0 ? "text-copper font-bold" : "text-ink-mute"}`}>
                {dayLabel(day.date, idx)}
              </div>
              <div className="text-xl mt-1 leading-none" title={day.weather}>{day.emoji}</div>
              <div className="font-display font-black text-[13px] tabular-nums mt-1 leading-none">
                {Math.round(day.minT)}/{Math.round(day.maxT)}°
              </div>
              <div className="font-mono text-[9px] tracking-wide uppercase text-ink-mute mt-1 leading-tight">
                {day.rainChance >= 30
                  ? `${day.rainChance}% Regen`
                  : day.weather.length > 14 ? day.weather.slice(0, 12) + "…" : day.weather}
              </div>
              {/* Pfeil-Indikator wenn offen */}
              {isSelected && (
                <div className="font-mono text-[9px] text-copper mt-1">▲</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Detail-Panel — erscheint wenn ein Tag ausgewählt ist */}
      {detail && (
        <div className="mt-1 mb-2 rounded-lg border border-copper/30 bg-copper/5 px-3 py-3 animate-in fade-in duration-150">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-mono text-[10px] tracking-wider text-copper uppercase font-bold">
                {fullDayLabel(detail.date)}
              </div>
              <div className="font-display font-black text-lg leading-tight mt-0.5">
                {detail.emoji} {detail.weather}
              </div>
            </div>
            <button
              onClick={() => setSelectedDay(null)}
              className="font-mono text-[11px] text-ink-mute hover:text-ink leading-none mt-0.5"
              title="Schließen"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <DetailRow icon="🌡" label="Temperatur" value={`${Math.round(detail.minT)} – ${Math.round(detail.maxT)} °C`} />
            <DetailRow icon="💨" label="Wind" value={`${detail.windDirection} ${detail.windBft} Bft`} />
            <DetailRow
              icon="🌧"
              label="Regenwahrsch."
              value={detail.rainChance > 0 ? `${detail.rainChance} %` : "—"}
              highlight={detail.rainChance >= 60}
            />
            <DetailRow
              icon="☀"
              label="Sonne"
              value={detail.sunChance > 0 ? `${detail.sunChance} %` : "—"}
            />
            {(detail.rainMmMin > 0 || detail.rainMmMax > 0) && (
              <DetailRow
                icon="💧"
                label="Niederschlag"
                value={detail.rainMmMin === detail.rainMmMax
                  ? `${detail.rainMmMin} mm`
                  : `${detail.rainMmMin}–${detail.rainMmMax} mm`}
              />
            )}
          </div>

          {/* Ampel-Hinweis für Baustelle */}
          {(detail.rainChance >= 70 || detail.windBft >= 6) && (
            <div className="mt-2.5 px-2.5 py-2 rounded bg-rust/10 border border-rust/25">
              <p className="font-mono text-[10px] text-rust uppercase tracking-wider font-bold">
                ⚠ Baustellen-Hinweis
              </p>
              <p className="font-mono text-[10px] text-ink-mute mt-0.5 leading-snug">
                {detail.rainChance >= 70 && detail.windBft >= 6
                  ? "Starker Regen + Wind — Außenarbeiten einschränken"
                  : detail.rainChance >= 70
                    ? "Hohe Regenwahrscheinlichkeit — witterungsabhängige Arbeiten einplanen"
                    : "Starker Wind — Pflasterarbeiten und Aufbauten prüfen"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Summary-Text (gekürzt) */}
      {data.summary && (
        <details className="group mb-2">
          <summary className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase cursor-pointer list-none flex items-center gap-1 hover:text-ink">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
            Wettertext
          </summary>
          <p className="font-mono text-[10px] text-ink-mute leading-relaxed mt-1 pl-3">
            {data.summary.slice(0, 300)}{data.summary.length > 300 ? " …" : ""}
          </p>
        </details>
      )}

      <div className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase">
        Buienradar · {data.station.name} ({data.station.distanceKm} km) · {new Date(data.current.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
      </div>
    </div>
  );
}

function DetailRow({
  icon, label, value, highlight = false
}: {
  icon: string; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] leading-none w-4">{icon}</span>
      <div className="min-w-0">
        <div className="font-mono text-[9px] tracking-wider text-ink-mute uppercase leading-none">{label}</div>
        <div className={`font-mono text-[11px] font-bold mt-0.5 ${highlight ? "text-rust" : "text-ink"}`}>{value}</div>
      </div>
    </div>
  );
}
