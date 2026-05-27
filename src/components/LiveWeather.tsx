// LiveWeather · zeigt aktuelle Wetterdaten + 3-Tage-Forecast für gegebene
// GPS-Koordinaten. Quelle: /api/weather (Buienradar-Proxy, nächste Station
// Haversine-basiert). Wird im Admin (zentral Weener) und im SiteDetail
// (pro Baustellen-GPS) verwendet.
//
// Props: lat/lng optional, default Weener.

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
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
      </div>

      {/* 3-Tage-Forecast */}
      <div className="flex gap-2 mb-2">
        {data.forecast.slice(0, 4).map((day, idx) => (
          <div
            key={day.date}
            className={`flex-1 text-center py-2 rounded-md border ${
              idx === 0 ? "border-copper bg-copper/8" : "border-steel-line/40 bg-bg-3/40"
            }`}
          >
            <div className={`font-mono text-[9.5px] tracking-wider uppercase ${idx === 0 ? "text-copper font-bold" : "text-ink-mute"}`}>
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
          </div>
        ))}
      </div>

      <div className="font-mono text-[9.5px] tracking-wider text-ink-mute uppercase">
        Buienradar · {data.station.name} ({data.station.distanceKm} km) · {new Date(data.current.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
      </div>
    </div>
  );
}
