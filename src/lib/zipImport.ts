// ZIP-Import-Helfer für Anfragen-Medien.
//
// Unterstützt:
//  • Beliebige ZIPs mit Bildern und Videos
//  • WhatsApp-Chatexporte (ZIP mit _chat.txt / "WhatsApp Chat mit …txt" + Medien)
//
// Ablauf:
//  1. extractZipMedia(file) → { images, videos, chatText, zipName, stats }
//  2. Caller lädt Dateien hoch, optional chatText in rawText speichern

import JSZip from "jszip";

export interface ZipExtractResult {
  images: File[];
  videos: File[];
  chatText: string | null;   // vollständiger WhatsApp-Exporttext (oder null)
  whatsApp: boolean;         // erkannter WA-Export?
  zipName: string;
  stats: {
    total: number;           // Dateien gesamt in ZIP
    skipped: number;         // ignoriert (Audio, Dokumente, zu groß …)
  };
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "3gp", "webm", "m4v", "ts"]);
const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // 150 MB

function ext(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// WhatsApp-Medien haben feste Namenskonvention: IMG-YYYYMMDD-WANNNNN.jpg
// Wir extrahieren das Datum daraus für die Sortierung.
function waDateFromName(name: string): number {
  const m = name.match(/[-_](\d{8})[-_]/);
  if (!m) return 0;
  // YYYYMMDD → timestamp
  const s = m[1];
  return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`).getTime();
}

function sortKey(name: string): number {
  // WhatsApp-Format bevorzugt, sonst alphabetisch
  const d = waDateFromName(name);
  if (d) return d;
  // Fallback: alphabetisch via charCode-Summe
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  return h >>> 0;
}

export async function extractZipMedia(file: File): Promise<ZipExtractResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const images: File[] = [];
  const videos: File[] = [];
  let chatText: string | null = null;
  let skipped = 0;
  let total = 0;

  const entries: Array<{ name: string; jzFile: JSZip.JSZipObject }> = [];
  zip.forEach((relPath, jzFile) => {
    if (!jzFile.dir) entries.push({ name: relPath, jzFile });
  });

  total = entries.length;

  // Erst Chat-Text suchen (WhatsApp-Export-Erkennung)
  for (const { name, jzFile } of entries) {
    const base = name.split("/").pop() ?? name;
    if (
      base.toLowerCase() === "_chat.txt" ||
      base.toLowerCase() === "chat.txt" ||
      /whatsapp.chat.*\.txt$/i.test(base)
    ) {
      chatText = await jzFile.async("text");
      break;
    }
  }

  // Alle Medien-Dateien extrahieren + sortieren
  const mediaEntries = entries
    .filter(({ name }) => {
      const base = name.split("/").pop() ?? name;
      const e = ext(base);
      return IMAGE_EXTS.has(e) || VIDEO_EXTS.has(e);
    })
    .sort((a, b) => sortKey(a.name) - sortKey(b.name));

  for (const { name, jzFile } of mediaEntries) {
    const base = name.split("/").pop() ?? name;
    const e = ext(base);

    if (IMAGE_EXTS.has(e)) {
      const buf = await jzFile.async("arraybuffer");
      const mime = e === "png" ? "image/png" : e === "gif" ? "image/gif" : e === "webp" ? "image/webp" : "image/jpeg";
      images.push(new File([buf], base, { type: mime }));
    } else if (VIDEO_EXTS.has(e)) {
      const size = (jzFile as any)._data?.uncompressedSize ?? 0;
      if (size > MAX_VIDEO_BYTES) { skipped++; continue; }
      const buf = await jzFile.async("arraybuffer");
      const mime = e === "mov" ? "video/quicktime" : e === "avi" ? "video/x-msvideo" : e === "mkv" ? "video/x-matroska" : e === "3gp" ? "video/3gpp" : e === "webm" ? "video/webm" : "video/mp4";
      videos.push(new File([buf], base, { type: mime }));
    } else {
      skipped++;
    }
  }

  // Nicht-Medien-Dateien (außer Chat-Text) zählen als übersprungen
  skipped += entries.length - mediaEntries.length - (chatText !== null ? 1 : 0);

  const whatsApp = chatText !== null || entries.some(({ name }) =>
    /^(IMG|VID|PTT|AUD|STK)-\d{8}-WA\d+\./i.test((name.split("/").pop() ?? ""))
  );

  return {
    images,
    videos,
    chatText,
    whatsApp,
    zipName: file.name,
    stats: { total, skipped: Math.max(0, skipped) },
  };
}

// ── WhatsApp-Text-Parser ─────────────────────────────────────────────────────
// Erkennt die üblichen WA-Exportformate:
//   [12.06.26, 10:30:00] Name: Nachricht
//   12.06.26, 10:30 - Name: Nachricht

export interface WaMessage {
  at: string;   // ISO date string
  sender: string;
  text: string;
}

export interface WaChatMeta {
  participants: string[];
  dateRange: { from: string; to: string };
  messageCount: number;
  mediaCount: number;
  messages: WaMessage[];
}

const WA_LINE_RE = [
  // [DD.MM.YY, HH:MM:SS] Sender: text
  /^\[(\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s+(\d{2}:\d{2}(?::\d{2})?)\]\s+([^:]+):\s*(.*)/,
  // DD.MM.YY, HH:MM - Sender: text
  /^(\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s+(\d{2}:\d{2}(?::\d{2})?)\s+-\s+([^:]+):\s*(.*)/,
];

function parseWaDate(dateStr: string, timeStr: string): string {
  // normalise: DD.MM.YY → YYYY-MM-DD
  const [d, m, y] = dateStr.replace(/\//g, ".").split(".");
  const year = y.length === 2 ? `20${y}` : y;
  const month = m.padStart(2, "0");
  const day = d.padStart(2, "0");
  return `${year}-${month}-${day}T${timeStr.padEnd(8, ":00")}`;
}

export function parseWhatsAppText(text: string): WaChatMeta {
  const lines = text.split(/\r?\n/);
  const messages: WaMessage[] = [];
  const participants = new Set<string>();
  let mediaCount = 0;
  let current: WaMessage | null = null;

  for (const line of lines) {
    let matched = false;
    for (const re of WA_LINE_RE) {
      const m = line.match(re);
      if (m) {
        if (current) messages.push(current);
        const iso = parseWaDate(m[1], m[2]);
        current = { at: iso, sender: m[3].trim(), text: m[4] };
        participants.add(m[3].trim());
        if (/omitted|weggelassen|<Medien|<Media/i.test(m[4])) mediaCount++;
        matched = true;
        break;
      }
    }
    if (!matched && current) {
      // Mehrzeilige Nachricht
      current.text += "\n" + line;
    }
  }
  if (current) messages.push(current);

  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  return {
    participants: [...participants].filter(
      (p) => !["System", "WhatsApp"].includes(p)
    ),
    dateRange: {
      from: sorted[0]?.at ?? "",
      to: sorted[sorted.length - 1]?.at ?? "",
    },
    messageCount: messages.length,
    mediaCount,
    messages: sorted,
  };
}

// Baut einen kompakten Text-Summary für rawText (erste 4000 Zeichen des Chats
// + Metadaten-Zeile). Volltext zu groß → DB würde leer laufen.
export function whatsAppSummary(meta: WaChatMeta, fullText: string): string {
  const header = [
    `📱 WhatsApp-Gesprächsexport`,
    `Teilnehmer: ${meta.participants.join(", ")}`,
    `Zeitraum: ${meta.dateRange.from.slice(0,10)} – ${meta.dateRange.to.slice(0,10)}`,
    `Nachrichten: ${meta.messageCount} · Medien: ${meta.mediaCount}`,
    ``,
    `── Gesprächsverlauf ──`,
  ].join("\n");
  const body = fullText.slice(0, 4000);
  return header + "\n" + body + (fullText.length > 4000 ? "\n[…gekürzt]" : "");
}
