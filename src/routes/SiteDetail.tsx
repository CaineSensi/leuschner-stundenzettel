import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listAllSites, listWorkers, updateSite } from "../lib/api";
import { currentUser } from "../lib/auth";
import {
  deleteEntryPhoto, getCurrentCompanyId, listPhotosForSite, photoUrl, uploadSitePhoto
} from "../lib/photos";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import { supabase, isBackendConnected } from "../lib/supabase";
import SiteEditor from "../components/SiteEditor";
import type { PhotoWithContext, Site, Worker, WorkEntry } from "../lib/types";
import type { PipelinePosition } from "../lib/pipeline";

/* ────────────────────────────────────────────────────────────────────────
   SiteDetail · Mockup-Variante 14 „Modal-Trigger · Quick-Access-Cards"
   Hero mit Karte + Side-Panel, vier Quick-Cards (Positionen · Stunden ·
   Rechnungen · Fotos), Modale mit Vollansicht.
   ──────────────────────────────────────────────────────────────────────── */

type SiteRow = Site & { archived?: boolean };

interface InvoiceRow { id: string; invoiceNumber: string; invoiceDate: string; status: string; netEur: number; grossEur: number | null; paidAt: string | null }
interface OrderRef   { id: string; orderNumber: string; positions: PipelinePosition[]; sumNet: number | null }

type ModalKind = "positions" | "hours" | "invoices" | "photos" | null;

export default function SiteDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [site, setSite] = useState<SiteRow | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [photos, setPhotos] = useState<PhotoWithContext[]>([]);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [orderRef, setOrderRef] = useState<OrderRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<ModalKind>(null);

  async function refresh() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [allSites, allWorkers, sitePhotos, eRows, iRows, cRows] = await Promise.all([
        listAllSites(true),
        listWorkers().catch(() => [] as Worker[]),
        listPhotosForSite(id).catch(() => [] as PhotoWithContext[]),
        loadEntriesForSite(id),
        loadInvoicesForSite(id),
        loadPipelineCardForSite(id),
      ]);
      const found = allSites.find((s) => s.id === id) ?? null;
      setSite(found);
      setWorkers(allWorkers);
      setPhotos(sitePhotos);
      setEntries(eRows);
      setInvoices(iRows);
      setOrderRef(cRows);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useRealtime(`site-detail-${id}`, ["entry_photos", "entries", "sites", "site_invoices", "pipeline_cards"], refresh);
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
    setUploading(true); setUploadError(null);
    try {
      const companyId = me.companyId ?? await getCurrentCompanyId();
      if (!companyId) { setUploadError("Konnte company_id nicht ermitteln, bitte neu anmelden"); return; }
      const stampContext = { siteName: site.name, projectNumber: site.projectNumber };
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        try {
          await uploadSitePhoto({ file: files[i], siteId: site.id, workerId: me.id, companyId, stampContext, position: photos.length + i });
        } catch { failed++; }
      }
      if (failed > 0) setUploadError(`${failed} von ${files.length} Fotos konnten nicht hochgeladen werden`);
      await refresh();
    } finally { setUploading(false); }
  }

  if (loading && !site) {
    return <main className="min-h-screen flex items-center justify-center text-ink-2 font-mono text-[12px]">Wird geladen …</main>;
  }
  if (!site) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-3">
        <p className="text-rust text-sm">{error ?? "Baustelle nicht gefunden"}</p>
        <button onClick={() => navigate("/admin/sites")} className="btn-ghost">Zurück zur Liste</button>
      </main>
    );
  }

  // Karten-Aggregate
  const hoursTotalMin = entries.reduce((t, e) => t + workMinutes(e), 0);
  const workersOnSite = new Set(entries.map((e) => e.workerId)).size;
  const invoicesOpen  = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
  const invoicesSum   = invoices.reduce((t, i) => t + (i.netEur ?? 0), 0);
  const invoicesOpenSum = invoicesOpen.reduce((t, i) => t + (i.netEur ?? 0), 0);
  const posCount = orderRef?.positions.length ?? 0;
  const posSum = orderRef?.sumNet ?? orderRef?.positions.reduce((t, p) => t + (p.sum ?? 0), 0) ?? 0;
  const latestPhoto = photos[0];
  const mapAddr = [site.street, site.city].filter(Boolean).join(", ");

  // OSM-iframe-Bbox um den Mittelpunkt — 0.03° = ~3 km radius
  const mapSrc = site.geo
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${site.geo.lng-0.03}%2C${site.geo.lat-0.02}%2C${site.geo.lng+0.03}%2C${site.geo.lat+0.02}&layer=mapnik&marker=${site.geo.lat}%2C${site.geo.lng}`
    : mapAddr
      ? `https://www.openstreetmap.org/export/embed.html?bbox=6.5%2C53.0%2C7.5%2C53.4&layer=mapnik`
      : null;

  return (
    <div className="min-h-screen safe-bottom">
      {/* App-Bar — Stahl, sticky */}
      <header className="sticky top-0 z-30 surface-steel px-5 lg:px-10 xl:px-14 pt-4 pb-4 safe-top">
        <button onClick={() => navigate("/admin/sites")} className="dd-eyebrow text-steel hover:text-copper-bright transition-colors mb-3 flex items-center gap-2">
          <span aria-hidden>←</span><span>Zurück zur Baustellen-Liste</span>
        </button>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Baustelle · Detail</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white mt-1 leading-none">{site.name}</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <label className={`btn-primary !min-h-[44px] text-[12px] cursor-pointer ${uploading ? "opacity-60" : ""}`}>
              {uploading ? "Lädt hoch …" : "＋ Fotos"}
              <input type="file" accept="image/*" multiple disabled={uploading} onChange={handlePickFiles} className="sr-only" />
            </label>
            <button onClick={() => setEditing(true)} className="btn-ghost !min-h-[44px] text-[12px]">Bearbeiten</button>
          </div>
        </div>
      </header>

      <main className="px-5 lg:px-10 xl:px-14 py-6 max-w-[1380px] mx-auto">
        {error && <div className="mb-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">{error}</div>}
        {uploadError && <div className="mb-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">{uploadError}</div>}

        {/* HERO · Karte + Side-Panel */}
        <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="relative rounded-2xl overflow-hidden border border-steel-line/45 bg-bg-3 min-h-[240px]">
            {mapSrc ? (
              <iframe src={mapSrc} loading="lazy" className="w-full h-full min-h-[240px] block border-0" title={`Karte ${site.name}`} />
            ) : (
              <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-ink-2 text-center px-4">
                Adresse oder GPS-Koordinaten in der Baustelle fehlen<br />— Karte kann nicht angezeigt werden
              </div>
            )}
            <div className="absolute left-3 bottom-3 bg-bg-deep/95 backdrop-blur text-white px-3 py-1.5 rounded-md font-mono text-[10.5px] tracking-wider flex items-center gap-2">
              <span className="text-copper">⌖</span> <b className="text-copper">{site.name}</b>
              {site.geo && <span className="text-steel">· {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}</span>}
            </div>
          </div>

          <aside className="bg-white border border-steel-line/45 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
            {orderRef?.orderNumber && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-copper/15 text-copper font-mono text-[10.5px] uppercase tracking-wider w-fit">
                <span className="w-1.5 h-1.5 rounded-full bg-copper" /> {orderRef.orderNumber}
              </span>
            )}
            <div className="font-display font-black text-[22px] leading-none uppercase">{site.name}</div>
            {(site.street || site.city) && (
              <div className="font-mono text-[12px] text-ink-2 leading-relaxed">
                <span className="text-copper mr-1">⌖</span>
                {site.street}{site.city ? <><br /><span className="ml-4">{site.city}</span></> : null}
              </div>
            )}
            {mapAddr && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddr)}`}
                target="_blank" rel="noopener"
                className="font-mono text-[11px] text-copper hover:text-copper-bright mt-1 inline-flex items-center gap-1"
              >
                in Google Maps öffnen ↗
              </a>
            )}
          </aside>
        </section>

        {/* QUICK-ACCESS · 4 Cards */}
        <section className="grid gap-3 mt-4 grid-cols-2 lg:grid-cols-4">
          <QuickCard
            label="Positionen"
            value={posCount === 0 ? "—" : `${posCount} · ${eur(posSum)}`}
            icon="📋"
            disabled={posCount === 0}
            onClick={() => setOpenModal("positions")}
          />
          <QuickCard
            label="Stunden"
            value={entries.length === 0 ? "—" : `${fmtHm(hoursTotalMin)} · ${workersOnSite} MA`}
            icon="⏱"
            disabled={entries.length === 0}
            onClick={() => setOpenModal("hours")}
          />
          <QuickCard
            label="Rechnungen"
            value={invoices.length === 0 ? "—" : invoicesOpen.length > 0
              ? `${invoices.length} · ${eur(invoicesOpenSum)} offen`
              : `${invoices.length} · ${eur(invoicesSum)} bezahlt`}
            icon="€"
            disabled={invoices.length === 0}
            onClick={() => setOpenModal("invoices")}
          />
          <QuickCard
            label="Fotos"
            value={photos.length === 0 ? "—" : `${photos.length} · neuestes ${latestPhoto?.date ? fmtShort(latestPhoto.date) : ""}`}
            iconPhoto={latestPhoto ?? undefined}
            onClick={() => setOpenModal("photos")}
          />
        </section>
      </main>

      {/* Modals */}
      {openModal === "positions" && orderRef && (
        <Modal title={`${orderRef.orderNumber} · Positionen`} onClose={() => setOpenModal(null)}>
          <PositionsBody positions={orderRef.positions} sum={posSum} />
        </Modal>
      )}
      {openModal === "hours" && (
        <Modal title={`Stunden · ${site.name}`} onClose={() => setOpenModal(null)}>
          <HoursBody entries={entries} workerMap={workerMap} />
        </Modal>
      )}
      {openModal === "invoices" && (
        <Modal title={`Rechnungen · ${site.name}`} onClose={() => setOpenModal(null)}>
          <InvoicesBody invoices={invoices} />
        </Modal>
      )}
      {openModal === "photos" && (
        <Modal title={`Foto-Galerie · ${photos.length} ${photos.length === 1 ? "Aufnahme" : "Aufnahmen"}`} onClose={() => setOpenModal(null)} wide>
          <PhotosBody photos={photos} workerMap={workerMap} onOpen={(i) => { setOpenModal(null); setLightboxIdx(i); }} />
        </Modal>
      )}

      {editing && (
        <SiteEditor
          title="Baustelle bearbeiten"
          initial={site}
          onClose={() => setEditing(false)}
          onSave={async (input) => { await updateSite(site.id, input); setEditing(false); refresh(); }}
        />
      )}

      {lightboxIdx !== null && (
        <PhotoLightbox
          photos={photos}
          workers={workerMap}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onDelete={async (photo) => { await deleteEntryPhoto(photo); await refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Quick-Card ─────────────────────────────────────────────────────────── */

function QuickCard({
  label, value, icon, iconPhoto, disabled, onClick
}: {
  label: string; value: string; icon?: string; iconPhoto?: PhotoWithContext;
  disabled?: boolean; onClick: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!iconPhoto) return;
    let cancelled = false;
    photoUrl(iconPhoto, "stamped").then((u) => { if (!cancelled) setThumbUrl(u); });
    return () => { cancelled = true; };
  }, [iconPhoto?.id]);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-white border-[1.5px] border-steel-line/45 rounded-2xl p-3.5 shadow-sm flex items-center gap-3 text-left hover:border-copper hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-steel-line/45 disabled:hover:shadow-sm"
    >
      <div
        className="w-9 h-9 rounded-xl bg-copper/15 text-copper grid place-items-center flex-shrink-0 overflow-hidden text-[18px]"
        style={iconPhoto ? { background: "#0B0B0C" } : undefined}
      >
        {iconPhoto && thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden>{icon}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] tracking-wider uppercase text-ink-2">{label}</div>
        <div className="font-bold text-[13.5px] text-ink mt-0.5 truncate">{value}</div>
      </div>
    </button>
  );
}

/* ── Modal-Wrapper ──────────────────────────────────────────────────────── */

function Modal({
  title, onClose, children, wide
}: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div
        role="dialog" aria-modal="true"
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[51] bg-white rounded-2xl shadow-2xl border border-steel-line/45 overflow-hidden flex flex-col w-[94vw] ${wide ? "max-w-[1080px]" : "max-w-[760px]"} max-h-[88vh]`}
      >
        <header className="surface-steel px-5 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="font-display font-extrabold uppercase text-[18px] text-white leading-tight">{title}</h2>
          <button onClick={onClose} aria-label="Schließen" className="bg-white/10 border border-white/20 text-white w-8 h-8 rounded-md grid place-items-center hover:bg-white/20 text-[16px]">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </>
  );
}

/* ── Modal-Bodies ───────────────────────────────────────────────────────── */

function PositionsBody({ positions, sum }: { positions: PipelinePosition[]; sum: number }) {
  if (positions.length === 0) return <Empty>Keine Positionen verknüpft. Sobald die Pipeline-Karte ein sevDesk-Angebot hat, erscheinen die Positionen hier.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="bg-bg-deep text-white">
          <tr>
            <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[42px]">#</th>
            <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2">Position</th>
            <th className="text-right font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[80px]">Menge</th>
            <th className="text-right font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[100px]">EP €</th>
            <th className="text-right font-mono text-[10px] uppercase tracking-wider px-3 py-2 w-[120px]">Summe</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.pos} className="border-t border-steel-line/35 even:bg-bg-2/40">
              <td className="text-center font-mono text-ink-2 text-[11px] px-2 py-2">{p.pos}</td>
              <td className="text-ink px-2 py-2 leading-snug">{p.name}</td>
              <td className="text-right font-mono text-[12px] text-ink-2 px-2 py-2 whitespace-nowrap">{p.quantity}</td>
              <td className="text-right font-mono text-[12px] text-ink-2 px-2 py-2 whitespace-nowrap">{p.unitPrice}</td>
              <td className="text-right font-mono font-bold text-[12.5px] text-ink px-3 py-2 whitespace-nowrap tabular-nums">{eur(p.sum)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink">
            <td colSpan={4} className="px-2 py-3 text-right font-display uppercase text-[12px] font-extrabold">Σ netto</td>
            <td className="px-3 py-3 text-right font-mono font-black text-[14px] text-copper tabular-nums">{eur(sum)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function HoursBody({ entries, workerMap }: { entries: WorkEntry[]; workerMap: Map<string, Worker> }) {
  if (entries.length === 0) return <Empty>Noch keine Stunden auf dieser Baustelle erfasst.</Empty>;
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const byWorker = new Map<string, number>();
  entries.forEach((e) => byWorker.set(e.workerId, (byWorker.get(e.workerId) ?? 0) + workMinutes(e)));
  const totalMin = entries.reduce((t, e) => t + workMinutes(e), 0);
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {[...byWorker.entries()].map(([wid, min]) => {
          const w = workerMap.get(wid);
          return (
            <div key={wid} className="bg-bg-2 border border-steel-line/45 rounded-md px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-2">{w ? `${w.firstName} ${w.lastName.charAt(0)}.` : "—"}</div>
              <div className="font-display font-extrabold text-[16px] text-ink mt-0.5">{fmtHm(min)}</div>
            </div>
          );
        })}
        <div className="bg-copper text-white rounded-md px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/80">Σ Gesamt</div>
          <div className="font-display font-black text-[16px] mt-0.5">{fmtHm(totalMin)}</div>
        </div>
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="bg-bg-deep text-white">
          <tr>
            <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[100px]">Datum</th>
            <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2">Mitarbeiter</th>
            <th className="text-right font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[80px]">Stunden</th>
            <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[70px]">Disz.</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const w = workerMap.get(e.workerId);
            return (
              <tr key={e.id} className="border-t border-steel-line/35 even:bg-bg-2/40">
                <td className="font-mono text-[11.5px] text-ink-2 px-2 py-2">{fmtShort(e.date)}</td>
                <td className="text-ink px-2 py-2">{w ? `${w.firstName} ${w.lastName}` : "—"}</td>
                <td className="text-right font-mono text-[12px] text-ink px-2 py-2 tabular-nums">{fmtHm(workMinutes(e))}</td>
                <td className="font-mono text-[11px] text-ink-2 px-2 py-2 uppercase">{e.discipline}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function InvoicesBody({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) return <Empty>Noch keine Rechnungen für diese Baustelle.</Empty>;
  const sorted = [...invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  return (
    <table className="w-full text-[12.5px]">
      <thead className="bg-bg-deep text-white">
        <tr>
          <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2">RE-Nr</th>
          <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[100px]">Datum</th>
          <th className="text-left font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[90px]">Status</th>
          <th className="text-right font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[110px]">Netto</th>
          <th className="text-right font-mono text-[10px] uppercase tracking-wider px-2 py-2 w-[110px]">Brutto</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((i) => (
          <tr key={i.id} className="border-t border-steel-line/35 even:bg-bg-2/40">
            <td className="font-mono font-bold text-ink px-2 py-2">{i.invoiceNumber}</td>
            <td className="font-mono text-[11.5px] text-ink-2 px-2 py-2">{fmtShort(i.invoiceDate)}</td>
            <td className="px-2 py-2">
              <StatusPill status={i.status} />
            </td>
            <td className="text-right font-mono text-[12px] text-ink px-2 py-2 tabular-nums">{eur(i.netEur)}</td>
            <td className="text-right font-mono text-[12px] text-ink-2 px-2 py-2 tabular-nums">{i.grossEur != null ? eur(i.grossEur) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PhotosBody({
  photos, workerMap, onOpen
}: {
  photos: PhotoWithContext[]; workerMap: Map<string, Worker>; onOpen: (i: number) => void;
}) {
  if (photos.length === 0) return <Empty>Noch keine Fotos.</Empty>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {photos.map((p, i) => (
        <PhotoTile key={p.id} photo={p} worker={workerMap.get(p.workerId) ?? null} onTap={() => onOpen(i)} />
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    paid:      { label: "bezahlt",   bg: "#dcfce7", fg: "#15803D" },
    open:      { label: "offen",     bg: "#fef3c7", fg: "#B45309" },
    overdue:   { label: "überfällig",bg: "#fee2e2", fg: "#B91C1C" },
    cancelled: { label: "storniert", bg: "#f4f4f5", fg: "#6A6E72" },
    draft:     { label: "Entwurf",   bg: "#e0e7ff", fg: "#4338ca" },
  };
  const m = map[status] ?? { label: status, bg: "#f4f4f5", fg: "#6A6E72" };
  return (
    <span className="inline-block px-2 py-0.5 rounded-full font-mono text-[10px] uppercase font-bold" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-10 font-mono text-[12px] text-ink-2 max-w-[420px] mx-auto">{children}</div>;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function eur(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function fmtHm(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")} h`;
}
function fmtShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function workMinutes(e: WorkEntry): number {
  const total = (e.endMin ?? 0) - (e.startMin ?? 0);
  return Math.max(0, total - (e.pauseMin ?? 0));
}

async function loadEntriesForSite(siteId: string): Promise<WorkEntry[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("entries")
    .select("id, worker_id, date, type, site_id, discipline, start_min, end_min, pause_min, weather, geo_verified, note")
    .eq("site_id", siteId)
    .eq("type", "work")
    .order("date", { ascending: false });
  if (error) { console.warn("loadEntries", error); return []; }
  return (data ?? []).map((r: any) => ({
    id: r.id, workerId: r.worker_id, date: r.date, type: "work",
    siteId: r.site_id, discipline: r.discipline,
    startMin: r.start_min ?? 0, endMin: r.end_min ?? 0, pauseMin: r.pause_min ?? 0,
    weather: r.weather ?? undefined, geoVerified: r.geo_verified ?? false,
    note: r.note ?? undefined,
  }));
}

async function loadInvoicesForSite(siteId: string): Promise<InvoiceRow[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("site_invoices")
    .select("id, invoice_number, invoice_date, status, net_eur, gross_eur, paid_at")
    .eq("site_id", siteId)
    .order("invoice_date", { ascending: false });
  if (error) { console.warn("loadInvoices", error); return []; }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    status: r.status,
    netEur: Number(r.net_eur ?? 0),
    grossEur: r.gross_eur != null ? Number(r.gross_eur) : null,
    paidAt: r.paid_at ?? null,
  }));
}

async function loadPipelineCardForSite(siteId: string): Promise<OrderRef | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  const { data, error } = await sb
    .from("pipeline_cards")
    .select("doc_number, positions, value_eur, plan_eur")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const r = data[0];
  return {
    id: siteId,
    orderNumber: r.doc_number ?? "—",
    positions: Array.isArray(r.positions) ? r.positions : [],
    sumNet: r.value_eur ?? r.plan_eur ?? null,
  };
}

/* ── PhotoTile + Lightbox (unverändert aus der alten Datei) ─────────────── */

function PhotoTile({ photo, worker, onTap }: { photo: PhotoWithContext; worker: Worker | null; onTap: () => void }) {
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
    <button onClick={onTap} className="relative aspect-square rounded-lg overflow-hidden bg-bg-3 border border-ink/10 active:scale-[0.97] transition-transform">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" /> :
        <div className="w-full h-full grid place-items-center text-ink-mute text-xl">⋯</div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2 py-1.5">
        <div className="font-mono font-bold text-white text-[10px] tracking-wide flex items-center justify-between gap-1">
          <span>{dateLabel}</span>
          {worker && <span className="px-1 bg-copper/90 text-bg-deep rounded text-[9px]">{worker.initials}</span>}
        </div>
      </div>
    </button>
  );
}

function PhotoLightbox({
  photos, workers, startIndex, onClose, onDelete
}: {
  photos: PhotoWithContext[]; workers: Map<string, Worker>; startIndex: number;
  onClose: () => void; onDelete: (photo: PhotoWithContext) => Promise<void>;
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
  if (!photo) { onClose(); return null; }
  const worker = workers.get(photo.workerId);
  const dateLabel = photo.date ? new Date(photo.date).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }) : "";
  const geoLabel = photo.geo ? `${photo.geo.lat.toFixed(4)}°N ${photo.geo.lng.toFixed(4)}°E` : null;
  async function handleDelete() {
    if (!confirm("Dieses Foto wirklich löschen?")) return;
    setDeleting(true);
    try { await onDelete(photo); if (photos.length <= 1) onClose(); else setIndex((i) => Math.max(0, i - 1)); }
    finally { setDeleting(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-white safe-top">
        <div>
          <div className="font-mono text-sm">{index + 1} / {photos.length}</div>
          {worker && <div className="font-mono text-white/55 text-[11px]">{worker.firstName} {worker.lastName}</div>}
        </div>
        <button onClick={onClose} className="text-3xl leading-none" aria-label="Schließen">×</button>
      </header>
      <div className="flex-1 flex items-center justify-center overflow-hidden touch-pan-x">
        {url ? <img src={url} alt="" className="max-w-full max-h-full object-contain" draggable={false} /> : <span className="text-white/60">lädt …</span>}
      </div>
      <footer className="px-4 py-3 text-white text-[12px] safe-bottom flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {dateLabel && <div className="font-mono">{dateLabel}</div>}
          {geoLabel && <div className="font-mono text-white/55 text-[11px]">{geoLabel}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))} className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold">‹</button>
          <button disabled={index === photos.length - 1} onClick={() => setIndex((i) => Math.min(photos.length - 1, i + 1))} className="w-9 h-9 rounded-full bg-white/15 disabled:opacity-30 font-bold">›</button>
          <button onClick={handleDelete} disabled={deleting} className="ml-2 px-3 h-9 rounded-full bg-rust/90 text-white font-mono text-[11px] uppercase tracking-wide disabled:opacity-50">
            {deleting ? "…" : "Löschen"}
          </button>
        </div>
      </footer>
    </div>
  );
}
