import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listAllSites, listWorkers, updateSite } from "../lib/api";
import { currentUser } from "../lib/auth";
import {
  deleteEntryPhoto, getCurrentCompanyId, listPhotosForSite, photoUrl, uploadSitePhoto
} from "../lib/photos";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import SiteEditor from "../components/SiteEditor";
import type { PhotoWithContext, Site, Worker } from "../lib/types";

type SiteRow = Site & { archived?: boolean };

export default function SiteDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [site, setSite] = useState<SiteRow | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [photos, setPhotos] = useState<PhotoWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterWorker, setFilterWorker] = useState<string>("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const [editing, setEditing] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [allSites, allWorkers, sitePhotos] = await Promise.all([
        listAllSites(true),
        listWorkers().catch(() => [] as Worker[]),
        listPhotosForSite(id, {
          workerId: filterWorker || undefined,
          dateFrom: filterFrom || undefined,
          dateTo: filterTo || undefined
        }).catch((e) => {
          console.warn("[site-detail] photos fail", e);
          return [] as PhotoWithContext[];
        })
      ]);
      const found = allSites.find((s) => s.id === id) ?? null;
      setSite(found);
      setWorkers(allWorkers);
      setPhotos(sitePhotos);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, filterWorker, filterFrom, filterTo]);

  useRealtime(`site-detail-${id}`, ["entry_photos", "entries", "sites"], refresh);
  useRefreshOnVisible(refresh);

  const workerMap = useMemo(() => {
    const m = new Map<string, Worker>();
    workers.forEach((w) => m.set(w.id, w));
    return m;
  }, [workers]);

  async function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !site) return;
    const me = currentUser();
    if (!me) return;
    setUploading(true);
    setUploadError(null);
    try {
      const companyId = me.companyId ?? await getCurrentCompanyId();
      if (!companyId) {
        setUploadError("Konnte company_id nicht ermitteln, bitte neu anmelden");
        return;
      }
      const stampContext = {
        siteName: site.name,
        projectNumber: site.projectNumber
      };
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        try {
          await uploadSitePhoto({
            file: files[i],
            siteId: site.id,
            workerId: me.id,
            companyId,
            stampContext,
            position: photos.length + i
          });
        } catch (err) {
          console.warn("[site-detail] upload failed", err);
          failed++;
        }
      }
      if (failed > 0) setUploadError(`${failed} von ${files.length} Fotos konnten nicht hochgeladen werden`);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  if (loading && !site) {
    return (
      <main className="min-h-screen flex items-center justify-center text-ink-2 h-mono text-[12px]">
        Wird geladen …
      </main>
    );
  }

  if (!site) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-3">
        <p className="text-rust text-sm">{error ?? "Baustelle nicht gefunden"}</p>
        <button onClick={() => navigate("/admin/sites")} className="btn-ghost">Zurück zur Liste</button>
      </main>
    );
  }

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT">
      <header className="sticky top-0 z-30 bg-bg-DEFAULT border-b border-ink/10 px-5 lg:px-10 xl:px-14 pt-4 pb-3 safe-top">
        <button
          onClick={() => navigate("/admin/sites")}
          className="h-mono text-ink-2 text-[11px] hover:text-copper transition-colors mb-3 flex items-center gap-2"
        >
          <span>←</span><span>Zurück zur Baustellen-Liste</span>
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            {site.projectNumber && (
              <div className="h-mono text-copper text-[11px]">Auftrag {site.projectNumber}</div>
            )}
            <h1 className="h-display text-2xl lg:text-3xl mt-1 uppercase tracking-tight">{site.name}</h1>
            {(site.street || site.city) && (
              <p className="h-mono text-ink-2 text-[12px] mt-1">
                {site.street}{site.city ? ` · ${site.city}` : ""}
              </p>
            )}
            {site.geo && (
              <p className="h-mono text-ink-mute text-[10px] mt-0.5">
                GPS · {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0 items-center">
            <label className={`btn-primary text-[12px] cursor-pointer ${uploading ? "opacity-60" : ""}`}>
              {uploading ? "Lädt hoch …" : "+ Fotos"}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading}
                onChange={handlePickFiles}
                className="sr-only"
              />
            </label>
            <button onClick={() => setEditing(true)} className="btn-ghost text-[12px]">Bearbeiten</button>
          </div>
        </div>
      </header>

      <main className="px-5 lg:px-10 xl:px-14 py-6">
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
            {error}
          </div>
        )}
        {uploadError && (
          <div className="mb-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
            {uploadError}
          </div>
        )}

        <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="h-mono text-copper text-[12px]">
              Fotos · {photos.length}{(filterWorker || filterFrom || filterTo) ? " (gefiltert)" : ""}
            </h2>
            <div className="flex gap-2 flex-wrap items-center text-[11px]">
              <select
                value={filterWorker}
                onChange={(e) => setFilterWorker(e.target.value)}
                className="px-2.5 py-1.5 bg-bg-2 border border-ink/15 rounded-md text-[12px] focus:outline-none focus:border-copper"
              >
                <option value="">Alle Mitarbeiter</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName.charAt(0)}.
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="px-2.5 py-1.5 bg-bg-2 border border-ink/15 rounded-md text-[12px] focus:outline-none focus:border-copper"
                title="Von"
              />
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="px-2.5 py-1.5 bg-bg-2 border border-ink/15 rounded-md text-[12px] focus:outline-none focus:border-copper"
                title="Bis"
              />
              {(filterWorker || filterFrom || filterTo) && (
                <button
                  onClick={() => { setFilterWorker(""); setFilterFrom(""); setFilterTo(""); }}
                  className="h-mono text-ink-2 hover:text-copper text-[11px]"
                >
                  Filter zurücksetzen
                </button>
              )}
            </div>
          </div>

          {photos.length === 0 ? (
            <div className="text-center py-16 h-mono text-ink-2 text-[12px]">
              {(filterWorker || filterFrom || filterTo)
                ? "Keine Fotos im gewählten Filter"
                : "Noch keine Fotos für diese Baustelle"}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {photos.map((p, i) => (
                <PhotoTile
                  key={p.id}
                  photo={p}
                  worker={workerMap.get(p.workerId) ?? null}
                  onTap={() => setLightboxIdx(i)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {editing && (
        <SiteEditor
          title="Baustelle bearbeiten"
          initial={site}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await updateSite(site.id, input);
            setEditing(false);
            refresh();
          }}
        />
      )}

      {lightboxIdx !== null && (
        <PhotoLightbox
          photos={photos}
          workers={workerMap}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onDelete={async (photo) => {
            await deleteEntryPhoto(photo);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Foto-Kachel
// ============================================================

function PhotoTile({
  photo, worker, onTap
}: {
  photo: PhotoWithContext;
  worker: Worker | null;
  onTap: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    photoUrl(photo, "stamped").then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [photo.id]);

  const dateLabel = photo.date
    ? new Date(photo.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "";

  return (
    <button
      onClick={onTap}
      className="relative aspect-square rounded-lg overflow-hidden bg-bg-3 border border-ink/10 active:scale-[0.97] transition-transform group"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ink-mute text-xl">⋯</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2 py-1.5">
        <div className="font-mono font-bold text-white text-[10px] tracking-wide flex items-center justify-between gap-1">
          <span>{dateLabel}</span>
          {worker && (
            <span className="px-1 bg-copper/90 text-bg-deep rounded text-[9px]">
              {worker.initials}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================
// Lightbox · für Site-Galerie
// ============================================================

function PhotoLightbox({
  photos, workers, startIndex, onClose, onDelete
}: {
  photos: PhotoWithContext[];
  workers: Map<string, Worker>;
  startIndex: number;
  onClose: () => void;
  onDelete: (photo: PhotoWithContext) => Promise<void>;
}) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const photo = photos[index];

  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    setUrl(null);
    photoUrl(photo, "stamped").then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [photo?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(photos.length - 1, i + 1));
      if (e.key === "ArrowLeft")  setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  if (!photo) {
    onClose();
    return null;
  }

  const worker = workers.get(photo.workerId);
  const dateLabel = photo.date
    ? new Date(photo.date).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })
    : "";
  const geoLabel = photo.geo
    ? `${photo.geo.lat.toFixed(4)}°N ${photo.geo.lng.toFixed(4)}°E`
    : null;

  async function handleDelete() {
    if (!confirm("Dieses Foto wirklich löschen?")) return;
    setDeleting(true);
    try {
      await onDelete(photo);
      if (photos.length <= 1) onClose();
      else setIndex((i) => Math.max(0, i - 1));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-white safe-top">
        <div>
          <div className="font-mono text-sm">{index + 1} / {photos.length}</div>
          {worker && (
            <div className="h-mono text-white/55 text-[11px]">
              {worker.firstName} {worker.lastName}
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-3xl leading-none" aria-label="Schließen">×</button>
      </header>

      <div className="flex-1 flex items-center justify-center overflow-hidden touch-pan-x">
        {url ? (
          <img src={url} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
        ) : (
          <span className="text-white/60">lädt …</span>
        )}
      </div>

      <footer className="px-4 py-3 text-white text-[12px] safe-bottom flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {dateLabel && <div className="font-mono">{dateLabel}</div>}
          {geoLabel && <div className="font-mono text-white/55 text-[11px]">{geoLabel}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold"
            aria-label="Vorheriges"
          >‹</button>
          <button
            disabled={index === photos.length - 1}
            onClick={() => setIndex((i) => Math.min(photos.length - 1, i + 1))}
            className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold"
            aria-label="Nächstes"
          >›</button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="ml-2 px-3 h-9 rounded-full bg-rust/90 text-white font-mono text-[11px] uppercase tracking-wide disabled:opacity-50"
          >
            {deleting ? "…" : "Löschen"}
          </button>
        </div>
      </footer>
    </div>
  );
}
