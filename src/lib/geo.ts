import type { Site } from "./types";
import { distanceMeters } from "./utils";

export interface ResolvedAddress {
  display: string;
  road?: string;
  houseNumber?: string;
  postcode?: string;
  city?: string;
}

export interface SiteWithDistance {
  site: Site;
  distance: number;
}

export interface GeoResult {
  position: { lat: number; lng: number };
  accuracy: number;
  address: ResolvedAddress | null;
  nearbySites: SiteWithDistance[];
}

export type GeoError =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported";

export async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  if (!("geolocation" in navigator)) {
    throw "unsupported" satisfies GeoError;
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy)
      }),
      (err) => {
        if (err.code === 1) reject("permission_denied" satisfies GeoError);
        else if (err.code === 2) reject("position_unavailable" satisfies GeoError);
        else reject("timeout" satisfies GeoError);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30_000 }
    );
  });
}

/**
 * Reverse-Geocoding via Nominatim (OpenStreetMap).
 * Kein API-Key nötig. Bei Rate-Limit (1 req/s) gibt's Stille.
 * Wir akzeptieren das, weil pro Eintrag genau einer ausgelöst wird.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ResolvedAddress | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18&accept-language=de`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address ?? {};
    const road = a.road ?? a.pedestrian ?? a.path ?? a.footway;
    const houseNumber = a.house_number;
    const postcode = a.postcode;
    const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb;
    const parts: string[] = [];
    if (road) parts.push(houseNumber ? `${road} ${houseNumber}` : road);
    if (postcode || city) parts.push([postcode, city].filter(Boolean).join(" "));
    return {
      display: parts.join(", ") || (data.display_name ?? "Adresse unbekannt"),
      road,
      houseNumber,
      postcode,
      city
    };
  } catch {
    return null;
  }
}

/**
 * Sortiert alle Sites mit GPS-Koordinaten nach Distanz zur aktuellen Position.
 * Sites ohne `geo` werden ignoriert.
 */
export function findNearbySites(
  position: { lat: number; lng: number },
  sites: Site[]
): SiteWithDistance[] {
  return sites
    .filter((s): s is Site & { geo: { lat: number; lng: number } } => Boolean(s.geo))
    .map((site) => ({
      site,
      distance: Math.round(distanceMeters(position, site.geo))
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Ein-Aufruf-Helper: Position holen, Adresse + nahe Sites parallel ermitteln.
 */
export async function resolveCurrentLocation(sites: Site[]): Promise<GeoResult> {
  const pos = await getCurrentPosition();
  const [address] = await Promise.all([
    reverseGeocode(pos.lat, pos.lng)
  ]);
  return {
    position: { lat: pos.lat, lng: pos.lng },
    accuracy: pos.accuracy,
    address,
    nearbySites: findNearbySites({ lat: pos.lat, lng: pos.lng }, sites)
  };
}

/**
 * UI-freundliche Distanz-Formatierung.
 * < 1000 m → "350 m"
 * sonst   → "1,2 km"
 */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}
