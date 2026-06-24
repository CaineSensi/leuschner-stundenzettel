// Wetter-Proxy für das Admin-Dashboard.
//
// Quelle: Buienradar (https://data.buienradar.nl/2.0/feed/json) — niederländische
// Wetterdaten inkl. der DE/NL-Grenz-Stationen. Für Weener ist die Station
// Nieuw Beerta (~10 km westlich) die naheste.
//
// Schnittstelle (GET /api/weather?lat=53.17&lng=7.36):
//   {
//     station: { name, lat, lng, distanceKm },
//     current: { temperature, feelsLike, windSpeed, windBft, windDirection,
//                humidity, precipitation, weather, iconCode, timestamp },
//     forecast: [ { date, minT, maxT, rainChance, sunChance, windBft,
//                   weather, iconCode } ] (5 Tage),
//     summary: string  // deutsche Kurzfassung (übersetzt aus NL)
//   }
//
// Cache: 10 Minuten Edge-Cache (waitUntil + Cache API). Buienradar
// aktualisiert ~jede 10 Minuten, mehr Polling bringt nichts.
//
// API-Format Stand Juni 2026: lowercase/camelCase (Buienradar hat Mitte 2026
// auf lowercase umgestellt; Stationen liefern lat/lon jetzt direkt mit).

interface BuienStation {
  stationid: number;
  stationname: string;
  lat: number;
  lon: number;
  regio?: string;
  timestamp: string;
  weatherdescription?: string;
  iconurl?: string;
  fullIconUrl?: string;
  winddirection?: number | string;
  airpressure?: number;
  temperature?: number;
  groundtemperature?: number;
  feeltemperature?: number;
  visibility?: number;
  windgusts?: number;
  windspeed?: number;
  windspeedBft?: number;
  humidity?: number;
  precipitation?: number;
  sunpower?: number;
  rainFallLast24Hour?: number;
  rainFallLastHour?: number;
  winddirectiondegrees?: number;
}

interface BuienForecastDay {
  day: string;
  mintemperature?: string | number;
  maxtemperature?: string | number;
  mintemperatureMin?: number;
  mintemperatureMax?: number;
  maxtemperatureMin?: number;
  maxtemperatureMax?: number;
  rainChance?: number;
  sunChance?: number;
  windDirection?: string;
  wind?: number;
  mmRainMin?: number;
  mmRainMax?: number;
  weatherdescription?: string;
  iconurl?: string;
  fullIconUrl?: string;
}

interface BuienFeed {
  actual?: { stationmeasurements?: BuienStation[]; sunrise?: string; sunset?: string };
  forecast?: {
    fivedayforecast?: BuienForecastDay[];
    weatherreport?: { summary?: string; title?: string };
  };
}

// Haversine-Entfernung in km
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Wetter-Code aus Buienradar-Icon-URL (Single-Letter wie "a", "b", "f", "n")
function weatherFromIcon(iconUrl?: string): { de: string; emoji: string; code: string } {
  if (!iconUrl) return { de: 'unklar', emoji: '◯', code: '?' };
  const m = iconUrl.match(/\/([a-z])\.png/i);
  const code = (m?.[1] ?? '').toLowerCase();
  switch (code) {
    case 'a': return { de: 'sonnig',                       emoji: '☀',  code };
    case 'b': return { de: 'leicht bewölkt',               emoji: '🌤', code };
    case 'c': return { de: 'wolkig',                       emoji: '⛅',  code };
    case 'd': return { de: 'bewölkt',                      emoji: '☁',  code };
    case 'e': return { de: 'nebelig',                      emoji: '🌫', code };
    case 'f': return { de: 'leichter Regen',               emoji: '🌦', code };
    case 'g': return { de: 'Gewitter',                     emoji: '⛈', code };
    case 'h': return { de: 'Schneeregen',                  emoji: '🌨', code };
    case 'i': return { de: 'Sonne + leichter Regen',       emoji: '🌦', code };
    case 'j': return { de: 'leicht bewölkt mit Schauer',   emoji: '🌦', code };
    case 'k': return { de: 'sonnig + Schauer möglich',     emoji: '🌦', code };
    case 'l': return { de: 'Regen',                        emoji: '🌧', code };
    case 'm': return { de: 'Starkregen',                   emoji: '🌧', code };
    case 'n': return { de: 'nebelig (Nacht)',              emoji: '🌫', code };
    case 'o': return { de: 'leicht bewölkt + sonnig',      emoji: '🌤', code };
    case 'p': return { de: 'bewölkt',                      emoji: '☁',  code };
    case 'q': return { de: 'kräftiger Regen',              emoji: '🌧', code };
    case 'r': return { de: 'wolkig (Nacht)',               emoji: '☁',  code };
    case 's': return { de: 'Gewitter mit Hagel',           emoji: '⛈', code };
    case 't': return { de: 'Schnee',                       emoji: '🌨', code };
    case 'u': return { de: 'Schneeschauer',                emoji: '🌨', code };
    case 'v': return { de: 'leichter Schneefall',          emoji: '🌨', code };
    case 'w': return { de: 'Schneeregen-Schauer',          emoji: '🌨', code };
    default:  return { de: 'unklar',                       emoji: '◯',  code };
  }
}

// Windrichtungs-Abkürzung (Buienradar-NL-Codes) auf deutsch
function windDirDe(dir?: number | string): string {
  if (!dir) return '';
  const s = String(dir).toLowerCase().trim();
  const map: Record<string, string> = {
    n: 'N', no: 'NO', o: 'O', zo: 'SO', z: 'S', zw: 'SW', w: 'W', nw: 'NW',
    zzw: 'SSW', zzo: 'SSO', nno: 'NNO', nnw: 'NNW',
    ozo: 'OSO', ono: 'ONO', wzw: 'WSW', wnw: 'WNW',
  };
  return map[s] ?? s.toUpperCase();
}

// Niederländische Wetter-Beschreibung grob auf deutsch mappen (für summary)
function nlToDe(nl: string): string {
  return nl
    .replace(/\bvrijwel onbewolkt\b/gi, 'fast wolkenlos')
    .replace(/\b(zonnig|helder)\b/gi, 'sonnig')
    .replace(/\bbewolkt\b/gi, 'bewölkt')
    .replace(/\bopklaringen\b/gi, 'Aufheiterungen')
    .replace(/\bmiddelbare of lage bewolking\b/gi, 'mittlere oder niedrige Bewölkung')
    .replace(/\bregen\b/gi, 'Regen')
    .replace(/\bbuien\b/gi, 'Schauer')
    .replace(/\bonweer\b/gi, 'Gewitter')
    .replace(/\bsneeuw\b/gi, 'Schnee')
    .replace(/\bmist\b/gi, 'Nebel')
    .replace(/\bwind\b/gi, 'Wind')
    .replace(/\bnoord\b/gi, 'Nord')
    .replace(/\boost\b/gi, 'Ost')
    .replace(/\bzuid\b/gi, 'Süd')
    .replace(/\bwest\b/gi, 'West')
    .replace(/\bavond\b/gi, 'Abend')
    .replace(/\bochtend\b/gi, 'Morgen')
    .replace(/\bmiddag\b/gi, 'Mittag')
    .replace(/\bnacht\b/gi, 'Nacht')
    .replace(/\bvandaag\b/gi, 'heute')
    .replace(/\bmorgen\b/gi, 'morgen')
    .replace(/\bwoensdag\b/gi, 'Mittwoch')
    .replace(/\bdonderdag\b/gi, 'Donnerstag')
    .replace(/\bvrijdag\b/gi, 'Freitag')
    .replace(/\bzaterdag\b/gi, 'Samstag')
    .replace(/\bzondag\b/gi, 'Sonntag')
    .replace(/\bmaandag\b/gi, 'Montag')
    .replace(/\bdinsdag\b/gi, 'Dienstag');
}

interface WeatherResponse {
  station: { name: string; lat: number; lng: number; distanceKm: number };
  current: {
    temperature: number;
    feelsLike: number;
    windSpeed: number;
    windBft: number;
    windDirection: string;
    humidity: number;
    precipitation: number;
    weather: string;
    emoji: string;
    iconCode: string;
    timestamp: string;
  };
  forecast: Array<{
    date: string;
    minT: number;
    maxT: number;
    rainChance: number;
    sunChance: number;
    windBft: number;
    windDirection: string;
    rainMmMin: number;
    rainMmMax: number;
    weather: string;
    emoji: string;
    iconCode: string;
  }>;
  summary: string;
  fetchedAt: string;
}

type Ctx = { request: Request; waitUntil?: (p: Promise<any>) => void };

export const onRequestGet = async ({ request, waitUntil }: Ctx) => {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat') ?? '53.17');
  const lng = parseFloat(url.searchParams.get('lng') ?? '7.36');

  const cacheKey = `weather-${lat.toFixed(2)}-${lng.toFixed(2)}`;
  const cache = (caches as any).default as Cache | undefined;
  const cacheReq = new Request(`https://internal-cache/${cacheKey}`);
  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) return hit;
  }

  try {
    const upstream = await fetch('https://data.buienradar.nl/2.0/feed/json', {
      cf: { cacheTtl: 300, cacheEverything: true } as any,
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'upstream-failed', status: upstream.status }), {
        status: 502, headers: { 'content-type': 'application/json' },
      });
    }
    const feed = (await upstream.json()) as BuienFeed;

    const stations = feed.actual?.stationmeasurements ?? [];
    if (stations.length === 0) {
      return new Response(JSON.stringify({ error: 'no-stations' }), {
        status: 502, headers: { 'content-type': 'application/json' },
      });
    }

    // Nächste Station zur Anfrage-Position — lat/lon jetzt direkt im Feed
    let nearest = stations[0];
    let nearestDist = Infinity;
    for (const s of stations) {
      if (!s.lat || !s.lon) continue;
      const d = distanceKm({ lat, lng }, { lat: s.lat, lng: s.lon });
      if (d < nearestDist) { nearest = s; nearestDist = d; }
    }
    // Fallback: Station 6286 Nieuw Beerta (nächste zu Weener)
    if (!isFinite(nearestDist)) {
      nearest = stations.find((s) => s.stationid === 6286) ?? stations[0];
      nearestDist = 10;
    }

    const currentMeta = weatherFromIcon(nearest.iconurl);
    const fc = feed.forecast?.fivedayforecast ?? [];
    const forecast = fc.slice(0, 5).map((d) => {
      const meta = weatherFromIcon(d.iconurl);
      return {
        date: d.day,
        minT: d.mintemperatureMax ?? Number(d.mintemperature ?? 0),
        maxT: d.maxtemperatureMax ?? Number(d.maxtemperature ?? 0),
        rainChance: d.rainChance ?? 0,
        sunChance: d.sunChance ?? 0,
        windBft: d.wind ?? 0,
        windDirection: windDirDe(d.windDirection),
        rainMmMin: d.mmRainMin ?? 0,
        rainMmMax: d.mmRainMax ?? 0,
        weather: meta.de,
        emoji: meta.emoji,
        iconCode: meta.code,
      };
    });

    const result: WeatherResponse = {
      station: {
        name: nearest.stationname.replace(/^Meetstation\s+/i, ''),
        lat: nearest.lat,
        lng: nearest.lon,
        distanceKm: Math.round(nearestDist),
      },
      current: {
        temperature: nearest.temperature ?? 0,
        feelsLike: nearest.feeltemperature ?? nearest.temperature ?? 0,
        windSpeed: Math.round((nearest.windspeed ?? 0) * 3.6),
        windBft: nearest.windspeedBft ?? 0,
        windDirection: windDirDe(nearest.winddirection),
        humidity: nearest.humidity ?? 0,
        precipitation: nearest.rainFallLastHour ?? 0,
        weather: currentMeta.de,
        emoji: currentMeta.emoji,
        iconCode: currentMeta.code,
        timestamp: nearest.timestamp,
      },
      forecast,
      summary: nlToDe(feed.forecast?.weatherreport?.summary ?? ''),
      fetchedAt: new Date().toISOString(),
    };

    const response = new Response(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=600',
      },
    });
    if (cache && waitUntil) {
      const toCache = response.clone();
      toCache.headers.set('cache-control', 'public, max-age=600');
      waitUntil(cache.put(cacheReq, toCache));
    }
    return response;
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'fetch-failed', message: String(err?.message ?? err).slice(0, 200) }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }
};
