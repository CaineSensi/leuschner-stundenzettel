import { useEffect, useState } from "react";
import { photoUrl } from "../lib/photos";
import type { EntryPhoto } from "../lib/types";

/**
 * Horizontale Thumbnail-Reihe für Fotos eines Eintrags.
 * Zeigt:
 *  • bereits gespeicherte Fotos (existing) mit signed URL
 *  • lokal ausgewählte, noch nicht hochgeladene Fotos (pending) mit object-URL
 *  • "+"-Button zum Aufnehmen / Auswählen
 *
 * Tap → Lightbox (Fullscreen, Swipe-Navigation, Lösch-Aktion).
 */
export default function PhotoStrip({
  existing,
  pending = [],
  onAddFiles,
  onRemovePending,
  onDeleteExisting,
  disabled,
  busy
}: {
  existing: EntryPhoto[];
  pending?: File[];
  onAddFiles?: (files: File[]) => void;
  onRemovePending?: (index: number) => void;
  onDeleteExisting?: (photo: EntryPhoto) => Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [lightbox, setLightbox] = useState<{ kind: "existing" | "pending"; index: number } | null>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length && onAddFiles) onAddFiles(files);
    e.target.value = ""; // sodass das gleiche File erneut auswählbar wäre
  }

  const totalCount = existing.length + pending.length;
  const readOnly = !onAddFiles;

  return (
    <section className="mt-6">
      <div className="h-mono text-copper text-[12px] mb-2 flex items-center justify-between">
        <span>— Fotos {totalCount > 0 && <span className="text-paper/55">· {totalCount}</span>}</span>
        {busy && <span className="text-paper/55 text-[11px]">lädt hoch …</span>}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-6 px-6 snap-x">
        {/* Bestehende Fotos */}
        {existing.map((p, i) => (
          <ExistingThumb
            key={p.id}
            photo={p}
            onTap={() => setLightbox({ kind: "existing", index: i })}
          />
        ))}

        {/* Pending Fotos */}
        {pending.map((f, i) => (
          <PendingThumb
            key={`p-${i}-${f.name}`}
            file={f}
            onTap={() => setLightbox({ kind: "pending", index: i })}
            onRemove={() => onRemovePending?.(i)}
          />
        ))}

        {/* + Foto Button — nur wenn nicht read-only */}
        {!readOnly && (
          <label
            className={`flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-[0.97] transition-transform snap-start ${
              disabled
                ? "border-ink/10 text-paper/30 cursor-not-allowed"
                : "border-copper/40 text-copper hover:bg-copper/5"
            }`}
          >
            <span className="text-3xl leading-none">+</span>
            <span className="h-mono text-[10px] uppercase tracking-wide">Foto</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={disabled}
              onChange={handlePick}
              className="sr-only"
            />
          </label>
        )}
      </div>

      {totalCount === 0 && !readOnly && (
        <p className="h-mono text-paper/45 text-[11px] mt-1">
          Optional · Wetterschaden, Vorher/Nachher, Material …
        </p>
      )}

      {lightbox && (
        <Lightbox
          existing={existing}
          pending={pending}
          start={lightbox}
          onClose={() => setLightbox(null)}
          onDeleteExisting={onDeleteExisting}
          onRemovePending={onRemovePending ?? (() => { })}
        />
      )}
    </section>
  );
}

// ============================================================
// Thumbnails
// ============================================================

function ExistingThumb({ photo, onTap }: { photo: EntryPhoto; onTap: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    photoUrl(photo, "stamped").then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [photo.id]);

  return (
    <button
      onClick={onTap}
      className="flex-shrink-0 w-24 h-24 rounded-xl bg-bg-3 overflow-hidden border border-ink/10 active:scale-[0.97] transition-transform snap-start"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-paper/30 text-xl">⋯</div>
      )}
    </button>
  );
}

function PendingThumb({
  file, onTap, onRemove
}: {
  file: File;
  onTap: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="relative flex-shrink-0 snap-start">
      <button
        onClick={onTap}
        className="block w-24 h-24 rounded-xl bg-bg-3 overflow-hidden border border-copper/40 active:scale-[0.97] transition-transform"
      >
        {url && <img src={url} alt="" className="w-full h-full object-cover opacity-90" />}
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-copper text-bg-deep font-mono font-bold text-[9px] uppercase rounded">
          neu
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-rust text-bg-deep font-bold text-sm flex items-center justify-center shadow-md"
        aria-label="Entfernen"
      >
        ×
      </button>
    </div>
  );
}

// ============================================================
// Lightbox
// ============================================================

interface LightboxItem {
  kind: "existing" | "pending";
  url: string | null;
  photo?: EntryPhoto;
  index: number;
}

function Lightbox({
  existing, pending, start, onClose, onDeleteExisting, onRemovePending
}: {
  existing: EntryPhoto[];
  pending: File[];
  start: { kind: "existing" | "pending"; index: number };
  onClose: () => void;
  onDeleteExisting?: (photo: EntryPhoto) => Promise<void>;
  onRemovePending: (i: number) => void;
}) {
  const [items, setItems] = useState<LightboxItem[]>([]);
  const [current, setCurrent] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingItems: LightboxItem[] = await Promise.all(
        existing.map(async (p, i) => ({
          kind: "existing" as const,
          url: await photoUrl(p, "stamped"),
          photo: p,
          index: i
        }))
      );
      const pendingUrls = pending.map((f) => URL.createObjectURL(f));
      const pendingItems: LightboxItem[] = pendingUrls.map((u, i) => ({
        kind: "pending" as const,
        url: u,
        index: i
      }));
      if (cancelled) {
        pendingUrls.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      const all = [...existingItems, ...pendingItems];
      setItems(all);
      const startIdx = start.kind === "existing"
        ? start.index
        : existing.length + start.index;
      setCurrent(Math.min(startIdx, all.length - 1));
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent((i) => Math.min(items.length - 1, i + 1));
      if (e.key === "ArrowLeft") setCurrent((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  const item = items[current];
  if (!item) {
    return (
      <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center text-white">
        <button onClick={onClose} className="absolute top-4 right-4 text-3xl">×</button>
        <span className="h-mono text-white/60">lädt …</span>
      </div>
    );
  }

  const total = items.length;
  const meta = item.kind === "existing" && item.photo ? item.photo : null;
  const takenLabel = meta?.takenAt
    ? new Date(meta.takenAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
    : null;
  const geoLabel = meta?.geo
    ? `${meta.geo.lat.toFixed(4)}°N ${meta.geo.lng.toFixed(4)}°E`
    : null;

  async function handleDelete() {
    if (item.kind === "pending") {
      onRemovePending(item.index);
      if (total === 1) onClose();
      else setCurrent((i) => Math.max(0, i - 1));
      return;
    }
    if (!item.photo || !onDeleteExisting) return;
    if (!confirm("Dieses Foto wirklich löschen?")) return;
    setDeleting(true);
    try {
      await onDeleteExisting(item.photo);
      if (total === 1) onClose();
      else setCurrent((i) => Math.max(0, i - 1));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-white safe-top">
        <span className="font-mono text-sm">{current + 1} / {total}</span>
        <button onClick={onClose} className="text-3xl leading-none" aria-label="Schließen">×</button>
      </header>

      <div className="flex-1 flex items-center justify-center overflow-hidden touch-pan-x">
        {item.url ? (
          <img
            src={item.url}
            alt=""
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-white/60">lädt …</span>
        )}
      </div>

      {/* Meta + Navigation */}
      <footer className="px-4 py-3 text-white text-[12px] safe-bottom flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {item.kind === "pending" ? (
            <span className="text-copper font-mono">noch nicht hochgeladen</span>
          ) : (
            <>
              {takenLabel && <div className="font-mono">{takenLabel}</div>}
              {geoLabel && <div className="font-mono text-white/55 text-[11px]">{geoLabel}</div>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            disabled={current === 0}
            onClick={() => setCurrent((i) => Math.max(0, i - 1))}
            className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold"
            aria-label="Vorheriges"
          >‹</button>
          <button
            disabled={current === total - 1}
            onClick={() => setCurrent((i) => Math.min(total - 1, i + 1))}
            className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold"
            aria-label="Nächstes"
          >›</button>
          {(item.kind === "pending" || onDeleteExisting) && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="ml-2 px-3 h-9 rounded-full bg-rust/90 text-white font-mono text-[11px] uppercase tracking-wide disabled:opacity-50"
            >
              {deleting ? "…" : "Löschen"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
