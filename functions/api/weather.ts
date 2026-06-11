// Wetter-Proxy für das Admin-Dashboard.
//
// Quelle: Buienradar (https://data.buienradar.nl/2.0/feed/json) — niederländische
// Wetterdaten inkl. der DE/NL-Grenz-Stationen. Für Weener ist die Station
// Nieuw Beerta (~10 km westlich) die naheste. Wetter zieht meistens aus
// Westen rein, also liefert Nieuw Beerta sogar bessere Vorschau als eine
// Station östlich der Grenze.
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
// Hinweis: Buienradar hat im Mai 2026 die API-Felder auf PascalCase umgestellt.

interface BuienStation {
  StationId: number;
  StationName: string;
  Latitude: number;
  Longitude: number;
  Region?: string;
  Timestamp: string;
  WeatherDescription?: string;
  IconUrl?: string;
  FullIconUrl?: string;
  WindDirection?: number | string;
  AirPressure?: number;
  Temperature?: number;
  GroundTemperature?: number;
  FeelTemperature?: number;
  Visibility?: number;
  WindGusts?: number;
  Windspeed?: number;
  WindspeedBeaufort?: number;
  Humidity?: number;
  Precipitation?: number;
  Sunpower?: number;
  RainfallLast24Hour?: number;
  RainfallLastHour?: number;
  WindDirectionDegrees?: number;
}

interface BuienForecastDay {
  Day: string;
  MinTemperature?: number;
  MaxTemperature?: number;
  MinTemperatureMax?: number;
  MaxTemperatureMax?: number;
  RainChance?: number;
  SunChance?: number;
  WindDirection?: string;
  WindBeaufort?: number;
  RainMinMm?: number;
  RainMaxMm?: number;
  WeatherDescription?: string;
  IconUrl?: string;
  FullIconUrl?: string;
}

interface BuienFeed {
  Actual?: { WeatherStationMeasurements?: BuienStation[]; Sunrise?: string; Sunset?: string };
  Forecast?: {
    FiveDayForecast?: BuienForecastDay[];
    WeatherReport?: { Summary?: string; Title?: string };
  };
}

// Bekannte KNMI-Stationskoordinaten (Buienradar liefert seit 2026 keine GPS-Daten mehr)
const STATION_COORDS: Record<number, { lat: number; lng: number }> = {
  6275: { lat: 51.9700, lng: 5.8980 }, // Arnhem
  6249: { lat: 52.6430, lng: 4.9800 }, // Berkhout
  6260: { lat: 52.1010, lng: 5.1770 }, // De Bilt
  6235: { lat: 52.9240, lng: 4.7820 }, // Den Helder
  6370: { lat: 51.4520, lng: 5.3770 }, // Eindhoven
  6377: { lat: 51.1980, lng: 5.7620 }, // Ell
  6350: { lat: 51.5670, lng: 4.9310 }, // Gilze Rijen
  6323: { lat: 51.5270, lng: 3.8900 }, // Goes
  6283: { lat: 52.0650, lng: 6.6570 }, // Groenlo-Hupsel
  6280: { lat: 53.1250, lng: 6.5750 }, // Groningen
  6278: { lat: 52.4330, lng: 6.2590 }, // Heino
  6356: { lat: 51.8590, lng: 5.1450 }, // Herwijnen
  6330: { lat: 51.9920, lng: 4.1200 }, // Hoek van Holland
  6279: { lat: 52.7340, lng: 6.5160 }, // Hoogeveen
  6251: { lat: 53.3910, lng: 5.3460 }, // Hoorn Terschelling
  6392: { lat: 51.4500, lng: 6.1980 }, // Horst
  6258: { lat: 52.6390, lng: 5.4050 }, // Houtribdijk
  6225: { lat: 52.4640, lng: 4.5550 }, // IJmuiden
  6277: { lat: 53.4090, lng: 6.2000 }, // Lauwersoog
  6270: { lat: 53.2240, lng: 5.7520 }, // Leeuwarden
  6269: { lat: 52.4580, lng: 5.5200 }, // Lelystad
  6348: { lat: 51.9700, lng: 4.9260 }, // Lopik-Cabauw
  6380: { lat: 50.9060, lng: 5.7620 }, // Maastricht
  6273: { lat: 52.7020, lng: 5.8880 }, // Marknesse
  6286: { lat: 53.1983, lng: 7.1497 }, // Nieuw Beerta (nächste zu Weener)
  6344: { lat: 51.9550, lng: 4.4440 }, // Rotterdam
  6343: { lat: 51.8870, lng: 4.3420 }, // Rotterdam Geulhaven
  6240: { lat: 52.3080, lng: 4.7810 }, // Schiphol
  6267: { lat: 52.8980, lng: 5.3840 }, // Stavoren
  6229: { lat: 53.0000, lng: 4.7500 }, // Texelhors
  6290: { lat: 52.2740, lng: 6.8910 }, // Twente
  6242: { lat: 53.2410, lng: 4.9210 }, // Vlieland
  6310: { lat: 51.4420, lng: 3.5960 }, // Vlissingen
  6375: { lat: 51.6560, lng: 5.7070 }, // Volkel
  6215: { lat: 52.1430, lng: 4.4320 }, // Voorschoten
  6319: { lat: 51.2260, lng: 3.8620 }, // Westdorpe
  6248: { lat: 52.6390, lng: 5.1700 }, // Wijdenes
  6257: { lat: 52.5050, lng: 4.6030 }, // Wijk aan Zee
  6340: { lat: 51.4490, lng: 4.3420 }, // Woensdrecht
  6239: { lat: 54.8560, lng: 4.7320 }, // Zeeplatform F-3
};

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
// auf deutsche Kurzbeschreibung und Emoji-Icon mappen.
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

// Windrichtungs-Abkürzung (Buchstabe wie "w", "nw", "zzw") auf deutsch
function windDirDe(dir?: number | string): string {
  if (!dir) return '';
  const s = String(dir).toLowerCase().trim();
  const map: Record<string, string> = {
    n: 'N', no: 'NO', o: 'O', zo: 'SO', z: 'S', zw: 'SW', w: 'W', nw: 'NW',
    zzw: 'SSW', znzo: 'SSO', nno: 'NNO', nnw: 'NNW',
    ozo: 'OSO', onno: 'ONO', wzw: 'WSW', wnw: 'WNW',
    10: 'N', 20: 'NNO', 30: 'NNO', 40: 'NO', 50: 'NO', 60: 'ONO', 70: 'ONO', 80: 'O',
    90: 'O', 180: 'S', 270: 'W', 360: 'N',
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
    windSpeed: number;       // km/h
    windBft: number;
    windDirection: string;
    humidity: number;
    precipitation: number;   // mm in der letzten Stunde
    weather: string;         // deutsche Kurzfassung
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
  const lat = parseFloat(url.searchParams.get('lat') ?? '53.17');   // Weener default
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

    const stations = feed.Actual?.WeatherStationMeasurements ?? [];
    if (stations.length === 0) {
      return new Response(JSON.stringify({ error: 'no-stations' }), {
        status: 502, headers: { 'content-type': 'application/json' },
      });
    }

    // Nächste Station zur Anfrage-Position finden — Koordinaten aus Lookup-Tabelle
    let nearest = stations[0];
    let nearestDist = Infinity;
    for (const s of stations) {
      const coords = STATION_COORDS[s.StationId];
      if (!coords) continue;
      const d = distanceKm({ lat, lng }, coords);
      if (d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }
    // Fallback: Station 6286 Nieuw Beerta (nächste zu Weener) direkt wählen
    if (!isFinite(nearestDist)) {
      nearest = stations.find((s) => s.StationId === 6286) ?? stations[0];
      nearestDist = 10;
    }

    const currentMeta = weatherFromIcon(nearest.IconUrl);
    const fc = feed.Forecast?.FiveDayForecast ?? [];
    const forecast = fc.slice(0, 5).map((d) => {
      const meta = weatherFromIcon(d.IconUrl);
      return {
        date: d.Day,
        minT: d.MinTemperatureMax ?? d.MinTemperature ?? 0,
        maxT: d.MaxTemperatureMax ?? d.MaxTemperature ?? 0,
        rainChance: d.RainChance ?? 0,
        sunChance: d.SunChance ?? 0,
        windBft: d.WindBeaufort ?? 0,
        windDirection: windDirDe(d.WindDirection),
        rainMmMin: d.RainMinMm ?? 0,
        rainMmMax: d.RainMaxMm ?? 0,
        weather: meta.de,
        emoji: meta.emoji,
        iconCode: meta.code,
      };
    });

    const nearestCoords = STATION_COORDS[nearest.StationId] ?? { lat: 0, lng: 0 };
    const result: WeatherResponse = {
      station: {
        name: nearest.StationName.replace(/^Meetstation\s+/i, ''),
        lat: nearestCoords.lat,
        lng: nearestCoords.lng,
        distanceKm: Math.round(nearestDist),
      },
      current: {
        temperature: nearest.Temperature ?? 0,
        feelsLike: nearest.FeelTemperature ?? nearest.Temperature ?? 0,
        windSpeed: Math.round((nearest.Windspeed ?? 0) * 3.6), // m/s → km/h
        windBft: nearest.WindspeedBeaufort ?? 0,
        windDirection: windDirDe(nearest.WindDirection),
        humidity: nearest.Humidity ?? 0,
        precipitation: nearest.RainfallLastHour ?? 0,
        weather: currentMeta.de,
        emoji: currentMeta.emoji,
        iconCode: currentMeta.code,
        timestamp: nearest.Timestamp,
      },
      forecast,
      summary: nlToDe(feed.Forecast?.WeatherReport?.Summary ?? ''),
      fetchedAt: new Date().toISOString(),
    };

    const response = new Response(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=600', // 10 min Browser-Cache
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
