// Geocoding via OpenStreetMap Nominatim (kostenlos, keine API-Keys).
// Nominatim-Policy: max. 1 Request/Sekunde, User-Agent setzen.
// Wir cachen Treffer im localStorage, damit gleiche Adresse nicht mehrfach gefragt wird.

export interface GeocodeHit {
  lat: number;
  lng: number;
  displayName: string;
}

const CACHE_KEY = "geocode-cache-v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

type CacheEntry = { hit: GeocodeHit | null; ts: number };
type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Cache;
  } catch { return {}; }
}

function saveCache(c: Cache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

function cacheKey(parts: { street?: string; zip?: string; city?: string; country?: string }): string {
  return [parts.street, parts.zip, parts.city, parts.country ?? "de"]
    .map((p) => (p ?? "").trim().toLowerCase())
    .join("|");
}

export async function geocodeAddress(parts: {
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
}): Promise<GeocodeHit | null> {
  const addrParts = [parts.street, parts.zip, parts.city].filter((p) => p && p.trim()).map((p) => p!.trim());
  if (addrParts.length === 0) return null;

  const key = cacheKey(parts);
  const cache = loadCache();
  const cached = cache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.hit;
  }

  const q = [...addrParts, parts.country === "de" || !parts.country ? "Deutschland" : parts.country].join(", ");
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;

  try {
    const r = await fetch(url, {
      headers: {
        // Nominatim verlangt einen aussagekräftigen User-Agent oder Referer.
        // Da Browser den UA-Header oft nicht überschreiben lassen, reicht ein Identifier-Param.
        "Accept": "application/json"
      }
    });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    const data = await r.json() as Array<{ lat: string; lon: string; display_name: string }>;
    const hit: GeocodeHit | null = data[0]
      ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name }
      : null;
    cache[key] = { hit, ts: Date.now() };
    saveCache(cache);
    return hit;
  } catch (e) {
    console.warn("[geocode] fail", e);
    return null;
  }
}
