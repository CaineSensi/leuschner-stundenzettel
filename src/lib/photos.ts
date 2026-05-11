// Foto-Belege pro Eintrag.
//
// Workflow beim Upload:
//   1) Original-Datei einlesen (HEIC/JPEG/PNG)
//   2) EXIF parsen (Datum, GPS) — falls vorhanden
//   3) Auf max 2000 px verkleinern (Canvas → JPEG q=0.85)
//   4) Stamped-Version rendern (Datum + GPS + Baustellen­name unten-rechts)
//   5) Beide nach Supabase Storage hochladen
//   6) Row in entry_photos anlegen
//
// HEIC: Wird vom Browser nicht nativ decoded (außer Safari). Workaround:
// `<input accept="image/*">` schickt auf modernen iPhones automatisch JPEG.
// Wenn doch HEIC kommt, schlägt der Image-Decode fehl → klare Fehlermeldung.

import exifr from "exifr";
import { supabase, isBackendConnected } from "./supabase";
import type { EntryPhoto } from "./types";

const BUCKET = "entry-photos";
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

/**
 * Holt die company_id des eingeloggten Users — entweder aus dem localStorage-Worker
 * oder als Fallback per DB-Query. Für Bestands-Sessions die ohne companyId angemeldet
 * wurden.
 */
export async function getCurrentCompanyId(): Promise<string | null> {
  if (!supabase) return null;
  const sb: any = supabase;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("workers")
    .select("company_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data?.company_id ?? null;
}

export interface PhotoMeta {
  takenAt?: Date;
  geo?: { lat: number; lng: number };
  width: number;
  height: number;
}

export interface StampContext {
  siteName?: string;
  projectNumber?: string;
}

// ============================================================
// Image-Decode + EXIF
// ============================================================

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Foto konnte nicht decodiert werden (vermutlich HEIC). Bitte als JPEG aufnehmen oder umwandeln."));
      img.src = url;
    });
    return img;
  } finally {
    // Nicht sofort revoken — die Image-Quelle wird noch von Canvas gelesen.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

async function extractExif(file: File): Promise<{ takenAt?: Date; geo?: { lat: number; lng: number } }> {
  try {
    const exif = await exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] });
    if (!exif) return {};
    const takenAt =
      exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal
      : exif.CreateDate instanceof Date ? exif.CreateDate
      : undefined;
    const geo = (typeof exif.latitude === "number" && typeof exif.longitude === "number")
      ? { lat: exif.latitude, lng: exif.longitude }
      : undefined;
    return { takenAt, geo };
  } catch (err) {
    console.warn("[photos] EXIF parse fehlgeschlagen", err);
    return {};
  }
}

// ============================================================
// Resize + Stamp
// ============================================================

function fitInto(width: number, height: number, max: number) {
  if (width <= max && height <= max) return { w: width, h: height };
  const scale = max / Math.max(width, height);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas → Blob fehlgeschlagen")),
      "image/jpeg",
      quality
    );
  });
}

async function resizeToJpeg(img: HTMLImageElement): Promise<{ blob: Blob; width: number; height: number }> {
  const { w, h } = fitInto(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await canvasToJpeg(canvas, JPEG_QUALITY);
  return { blob, width: w, height: h };
}

function fmtCoord(value: number, axis: "lat" | "lng"): string {
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
  return `${Math.abs(value).toFixed(5)}°${hemi}`;
}

function fmtStampDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function stampJpeg(
  img: HTMLImageElement,
  meta: { takenAt: Date; geo?: { lat: number; lng: number } },
  ctx: StampContext
): Promise<Blob> {
  const { w, h } = fitInto(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.drawImage(img, 0, 0, w, h);

  // Stamp-Text aufbauen
  const lines: string[] = [];
  lines.push(fmtStampDate(meta.takenAt));
  if (meta.geo) lines.push(`${fmtCoord(meta.geo.lat, "lat")} ${fmtCoord(meta.geo.lng, "lng")}`);
  if (ctx.siteName) {
    lines.push(ctx.projectNumber ? `${ctx.siteName} · ${ctx.projectNumber}` : ctx.siteName);
  }

  // Font-Größe proportional zur Bildbreite
  const fontSize = Math.max(14, Math.round(w / 60));
  const lineHeight = Math.round(fontSize * 1.35);
  const padding = Math.round(fontSize * 0.9);

  c.font = `600 ${fontSize}px -apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif`;
  c.textBaseline = "top";

  // Linke untere Ecke
  const widths = lines.map((l) => c.measureText(l).width);
  const boxW = Math.max(...widths) + padding * 2;
  const boxH = lines.length * lineHeight + padding * 1.4;
  const x = padding;
  const y = h - boxH - padding;

  // Halbtransparenter dunkler Hintergrund
  c.fillStyle = "rgba(0, 0, 0, 0.55)";
  c.fillRect(x, y, boxW, boxH);

  // Orange Akzent-Linie links (Leuschner-Brand)
  c.fillStyle = "#DC6E2D";
  c.fillRect(x, y, Math.round(fontSize / 5), boxH);

  // Text weiß
  c.fillStyle = "#FFFFFF";
  lines.forEach((line, i) => {
    c.fillText(line, x + padding * 1.4, y + padding * 0.7 + i * lineHeight);
  });

  return canvasToJpeg(canvas, JPEG_QUALITY);
}

// ============================================================
// Upload-Pipeline
// ============================================================

export interface UploadResult {
  photo: EntryPhoto;
}

/**
 * Komplette Upload-Pipeline für ein einzelnes Foto.
 * Nimmt eine Datei aus einem File-Input, verarbeitet sie und legt
 * Storage-Objekte + entry_photos-Row an.
 */
export async function uploadEntryPhoto(args: {
  file: File;
  entryId: string;
  workerId: string;
  companyId: string;
  stampContext?: StampContext;
  position?: number;
}): Promise<UploadResult> {
  if (!isBackendConnected() || !supabase) {
    throw new Error("Backend nicht verbunden");
  }
  const sb: any = supabase;

  // 1) EXIF parsen
  const { takenAt: exifTaken, geo } = await extractExif(args.file);
  const takenAt = exifTaken ?? new Date();

  // 2) Bild laden
  const img = await loadImage(args.file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  // 3) Resize → raw
  const raw = await resizeToJpeg(img);

  // 4) Stamp → stamped
  let stampedBlob: Blob | null = null;
  try {
    stampedBlob = await stampJpeg(img, { takenAt, geo }, args.stampContext ?? {});
  } catch (err) {
    console.warn("[photos] Stamp fehlgeschlagen, lade nur Raw hoch", err);
  }

  // 5) Photo-ID + Storage-Pfade festlegen
  const photoId = crypto.randomUUID();
  const basePath = `${args.companyId}/${args.entryId}/${photoId}`;
  const rawPath = `${basePath}.jpg`;
  const stampedPath = stampedBlob ? `${basePath}_s.jpg` : null;

  // 6) Storage-Uploads
  const uploadRaw = sb.storage.from(BUCKET).upload(rawPath, raw.blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false
  });
  const uploadStamped = stampedBlob
    ? sb.storage.from(BUCKET).upload(stampedPath!, stampedBlob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false
      })
    : Promise.resolve({ error: null });

  const [{ error: rawErr }, { error: stampErr }] = await Promise.all([uploadRaw, uploadStamped]);
  if (rawErr) throw rawErr;
  if (stampErr) {
    console.warn("[photos] Stamped-Upload fehlgeschlagen", stampErr);
  }

  // 7) DB-Row
  const row = {
    id: photoId,
    entry_id: args.entryId,
    worker_id: args.workerId,
    company_id: args.companyId,
    raw_path: rawPath,
    stamped_path: stampErr ? null : stampedPath,
    taken_at: takenAt.toISOString(),
    geo_lat: geo?.lat ?? null,
    geo_lng: geo?.lng ?? null,
    width_px: naturalW,
    height_px: naturalH,
    bytes_raw: raw.blob.size,
    bytes_stamped: stampedBlob?.size ?? null,
    position: args.position ?? 0
  };
  const { data, error } = await sb
    .from("entry_photos")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    // Storage-Objekte wieder weg, sonst Waisen
    await sb.storage.from(BUCKET).remove([rawPath, stampedPath].filter(Boolean) as string[]);
    throw error;
  }
  return { photo: rowToPhoto(data) };
}

// ============================================================
// Read / Delete
// ============================================================

export async function listEntryPhotos(entryId: string): Promise<EntryPhoto[]> {
  if (!isBackendConnected() || !supabase) return [];
  const { data, error } = await supabase
    .from("entry_photos")
    .select("*")
    .eq("entry_id", entryId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map(rowToPhoto);
}

/**
 * Signed URL für die Anzeige eines privaten Storage-Objekts.
 * `kind = 'stamped'` fällt automatisch auf `raw` zurück wenn kein
 * Stamped existiert.
 */
export async function photoUrl(photo: EntryPhoto, kind: "raw" | "stamped" = "stamped", expiresIn = 3600): Promise<string | null> {
  if (!supabase) return null;
  const sb: any = supabase;
  const path = kind === "stamped" && photo.stampedPath ? photo.stampedPath : photo.rawPath;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) {
    console.warn("[photos] signed URL fehlgeschlagen", error);
    return null;
  }
  return data.signedUrl;
}

export async function deleteEntryPhoto(photo: EntryPhoto): Promise<void> {
  if (!supabase) return;
  const sb: any = supabase;
  // Erst Storage (kann auch fehlschlagen ohne dass die DB-Row verwaist bleibt — RLS verhindert verwaiste Storage-Reads)
  const paths = [photo.rawPath, photo.stampedPath].filter(Boolean) as string[];
  await sb.storage.from(BUCKET).remove(paths).catch((err: any) => {
    console.warn("[photos] Storage-delete fehlgeschlagen", err);
  });
  const { error } = await sb.from("entry_photos").delete().eq("id", photo.id);
  if (error) throw error;
}

// ============================================================
// Mapping
// ============================================================

function rowToPhoto(r: any): EntryPhoto {
  return {
    id: r.id,
    entryId: r.entry_id,
    workerId: r.worker_id,
    rawPath: r.raw_path,
    stampedPath: r.stamped_path ?? undefined,
    takenAt: r.taken_at ?? undefined,
    geo: (typeof r.geo_lat === "number" && typeof r.geo_lng === "number") ? { lat: r.geo_lat, lng: r.geo_lng } : undefined,
    width: r.width_px ?? undefined,
    height: r.height_px ?? undefined,
    bytesRaw: r.bytes_raw ?? undefined,
    bytesStamped: r.bytes_stamped ?? undefined,
    position: r.position ?? 0,
    createdAt: r.created_at
  };
}
