import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { listAllSites, listWorkers, updateSite } from "../lib/api";
import { currentUser } from "../lib/auth";
import {
  deleteEntryPhoto, getCurrentCompanyId, listPhotosForSite, listSiteMedia, mediaUrl, photoUrl, uploadSitePhoto,
  type SiteMedia
} from "../lib/photos";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import { supabase, isBackendConnected } from "../lib/supabase";
import { geocodeAddress } from "../lib/geocode";
import {
  listSiteMaterials, createSiteMaterial, updateSiteMaterialStatus, deleteSiteMaterial,
  MATERIAL_STATUS_META,
  type SiteMaterial, type MaterialStatus,
} from "../lib/siteMaterials";
import {
  listSiteQuestions, createSiteQuestion, updateSiteQuestion, deleteSiteQuestion,
  KIND_META as Q_KIND_META, STATUS_META as Q_STATUS_META,
  type SiteQuestion, type QuestionKind, type QuestionStatus,
} from "../lib/siteQuestions";
import { LiveWeather } from "../components/LiveWeather";
import { withTimeout } from "../lib/utils";
import SiteEditor from "../components/SiteEditor";
import BackButton from "../components/BackButton";
import ImageWithFallback from "../components/ImageWithFallback";
import type { PhotoWithContext, Site, Worker, WorkEntry } from "../lib/types";
import type { PipelinePosition } from "../lib/pipeline";
import { SOURCE_ICON, SOURCE_LABEL } from "../lib/inquiries";

/* ────────────────────────────────────────────────────────────────────────
   SiteDetail · Mockup-Variante 14 „Modal-Trigger · Quick-Access-Cards"
   Hero mit Karte + Side-Panel, vier Quick-Cards (Positionen · Stunden ·
   Rechnungen · Fotos), Modale mit Vollansicht.
   ──────────────────────────────────────────────────────────────────────── */

type SiteRow = Site & { archived?: boolean };

interface InvoiceRow { id: string; invoiceNumber: string; invoiceDate: string; status: string; netEur: number; grossEur: number | null; paidAt: string | null }
interface OrderRef   { id: string; orderNumber: string; positions: PipelinePosition[]; sumNet: number | null }

type ModalKind = "positions" | "hours" | "invoices" | "photos" | "materials" | "media" | "inquiry" | "aufmass" | null;

interface InquiryRef {
  id: string;
  source: "mail" | "phone" | "whatsapp" | "letter" | "in_person" | "web" | "other";
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  city: string | null;
  description: string | null;
  rawText: string;
  notesLog: { at: string; by: string; kind: string; text: string }[];
  status: string;
  priority: string;
  createdAt: string;
  pipelineStage: string | null;
  pipelineCardId: string | null;
}

export default function SiteDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [site, setSite] = useState<SiteRow | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [photos, setPhotos] = useState<PhotoWithContext[]>([]);
  const [media, setMedia] = useState<SiteMedia[]>([]);
  const [inquiry, setInquiry] = useState<InquiryRef | null>(null);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [orderRef, setOrderRef] = useState<OrderRef | null>(null);
  const [notes, setNotes] = useState<string>("");  // operative Vor-Ort-Bemerkungen (sites.notes)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  const [mapView, setMapView] = useState<"satellite" | "map">("map");
  const [materials, setMaterials] = useState<SiteMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [questions, setQuestions] = useState<SiteQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  // Auto-Geocoding wenn die Baustelle nur Adresse hat, keine GPS-Koordinaten
  const [geocoded, setGeocoded] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  async function refresh() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [allSites, allWorkers, sitePhotos, siteMedia, eRows, iRows, cRows, inqRow, nRow] = await Promise.all([
        withTimeout(listAllSites(true), 8000, "Baustellen"),
        withTimeout(listWorkers(), 8000, "Mitarbeiter").catch(() => [] as Worker[]),
        withTimeout(listPhotosForSite(id), 8000, "Fotos").catch(() => [] as PhotoWithContext[]),
        withTimeout(listSiteMedia(id), 8000, "Anhänge").catch(() => [] as SiteMedia[]),
        withTimeout(loadEntriesForSite(id), 8000, "Stunden").catch(() => [] as WorkEntry[]),
        withTimeout(loadInvoicesForSite(id), 8000, "Rechnungen").catch(() => [] as InvoiceRow[]),
        withTimeout(loadPipelineCardForSite(id), 8000, "Pipeline-Karte").catch(() => null as OrderRef | null),
        withTimeout(loadInquiryForSite(id), 8000, "Anfrage").catch(() => null as InquiryRef | null),
        withTimeout((async () => {
          if (!isBackendConnected() || !supabase) return "";
          const sb: any = supabase;
          const { data } = await sb.from("sites").select("notes").eq("id", id).maybeSingle();
          return (data?.notes as string) ?? "";
        })(), 8000, "Bemerkungen").catch(() => ""),
      ]);
      const found = allSites.find((s) => s.id === id) ?? null;
      setSite(found);
      setWorkers(allWorkers);
      setPhotos(sitePhotos);
      setMedia(siteMedia);
      setEntries(eRows);
      setInvoices(iRows);
      setOrderRef(cRows);
      setInquiry(inqRow);
      setNotes(nRow);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useRealtime(`site-detail-${id}`, ["entry_photos", "entries", "sites", "site_invoices", "pipeline_cards", "inquiries"], refresh);
  useRefreshOnVisible(refresh);
  useRefreshOnAuth(refresh);

  /** Speichert die operativen Vor-Ort-Bemerkungen (sites.notes). */
  async function saveNotes(text: string) {
    if (!isBackendConnected() || !supabase || !id) return;
    const sb: any = supabase;
    const clean = text.trim();
    const { error } = await sb.from("sites").update({ notes: clean || null }).eq("id", id);
    if (error) throw error;
    setNotes(clean);
  }

  // Material-Liste separat laden (kann sich unabhängig ändern)
  async function refreshMaterials() {
    if (!id) return;
    setMaterialsLoading(true);
    try {
      const list = await listSiteMaterials(id);
      setMaterials(list);
    } catch { /* still — Material-Sektion bleibt leer */ }
    finally { setMaterialsLoading(false); }
  }
  useEffect(() => { refreshMaterials(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useRealtime(`site-materials-${id}`, ["site_materials"], refreshMaterials);

  // Klärpunkte
  async function refreshQuestions() {
    if (!id) return;
    setQuestionsLoading(true);
    try {
      const list = await listSiteQuestions(id);
      setQuestions(list);
    } catch { /* still */ }
    finally { setQuestionsLoading(false); }
  }
  useEffect(() => { refreshQuestions(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useRealtime(`site-questions-${id}`, ["site_questions"], refreshQuestions);

  // Auto-Geocoding: wenn keine GPS-Koordinaten in der DB sind, aber eine
  // Adresse da ist, fragen wir Nominatim und persistieren das Ergebnis.
  useEffect(() => {
    if (!site || site.geo) { setGeocoded(null); return; }
    if (!site.street && !site.city) return;
    let cancelled = false;
    setGeocoding(true);
    geocodeAddress({ street: site.street, zip: (site as any).zip, city: site.city })
      .then(async (hit) => {
        if (cancelled || !hit) return;
        setGeocoded({ lat: hit.lat, lng: hit.lng });
        // Persistieren — schlägt nichts an der UI an, schreibt nur zurück
        if (isBackendConnected() && supabase) {
          const sb: any = supabase;
          await sb.from("sites")
            .update({ geo_lat: hit.lat, geo_lng: hit.lng })
            .eq("id", site.id)
            .then((r: any) => r.error && console.warn("geocode persist", r.error));
        }
      })
      .finally(() => { if (!cancelled) setGeocoding(false); });
    return () => { cancelled = true; };
  }, [site?.id, site?.geo, site?.street, site?.city]);

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
  // Aufmaß-Positionen (vom Tablet erfasst) separat. Keine useMemo-Hook hier,
  // da diese Stelle hinter bedingten Returns liegt (Hooks-Regeln).
  const aufmassPositions = (orderRef?.positions ?? []).filter((p) => p.source === "aufmass");
  const latestPhoto = photos[0];
  const mapAddr = [site.street, site.city].filter(Boolean).join(", ");

  // Effektive Koordinaten: explizit gesetzt oder via Geocoding ermittelt
  const effectiveGeo = site.geo ?? geocoded;

  // OSM-iframe-Bbox um den Mittelpunkt — 0.03° = ~3 km radius
  const mapSrc = effectiveGeo
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${effectiveGeo.lng-0.03}%2C${effectiveGeo.lat-0.02}%2C${effectiveGeo.lng+0.03}%2C${effectiveGeo.lat+0.02}&layer=mapnik&marker=${effectiveGeo.lat}%2C${effectiveGeo.lng}`
    : mapAddr
      ? `https://www.openstreetmap.org/export/embed.html?bbox=6.5%2C53.0%2C7.5%2C53.4&layer=mapnik`
      : null;


  return (
    <div className="min-h-screen safe-bottom">
      {/* App-Bar — Stahl, sticky */}
      <header className="sticky top-0 z-[1100] surface-steel px-5 lg:px-10 xl:px-14 pt-4 pb-4 safe-top">
        <BackButton to="/admin/sites" label="Zur Baustellen-Liste" title="Zurück zur Übersicht aller Baustellen" />
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
          <div className="flex flex-col gap-2">
            {/* Toggle Karte / Satellit / Google Earth · links oben, AUSSERHALB der Karte */}
            {effectiveGeo && (
              <div className="self-start bg-bg-deep rounded-md flex overflow-hidden text-[10.5px] font-mono uppercase tracking-wider shadow-md">
                <button
                  onClick={() => setMapView("map")}
                  className={`px-3 py-1.5 transition-colors ${mapView === "map" ? "bg-copper text-white" : "text-white/70 hover:text-white"}`}
                >🗺 Karte</button>
                <button
                  onClick={() => setMapView("satellite")}
                  className={`px-3 py-1.5 transition-colors ${mapView === "satellite" ? "bg-copper text-white" : "text-white/70 hover:text-white"}`}
                >🛰 Satellit</button>
                <a
                  href={`https://earth.google.com/web/@${effectiveGeo.lat},${effectiveGeo.lng},250a,500d,35y,0h,45t,0r`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="px-3 py-1.5 transition-colors text-white/70 hover:text-white"
                  title="In Google Earth öffnen (neuer Tab)"
                >🌍 Google Earth ↗</a>
              </div>
            )}

            <div className="relative rounded-2xl overflow-hidden border border-steel-line/45 bg-bg-3 min-h-[240px]">
            {mapView === "satellite" && effectiveGeo ? (
              <LeafletSatellite
                lat={effectiveGeo.lat}
                lng={effectiveGeo.lng}
                label={site.name}
                className="w-full h-full min-h-[280px]"
                onMove={async (la, ln) => {
                  setGeocoded({ lat: la, lng: ln });
                  if (isBackendConnected() && supabase) {
                    const sb: any = supabase;
                    await sb.from("sites").update({ geo_lat: la, geo_lng: ln }).eq("id", site.id);
                  }
                }}
              />
            ) : mapSrc ? (
              <iframe src={mapSrc} loading="lazy" className="w-full h-full min-h-[240px] block border-0" title={`Karte ${site.name}`} />
            ) : (
              <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-ink-2 text-center px-4">
                Adresse oder GPS-Koordinaten in der Baustelle fehlen<br />— Karte kann nicht angezeigt werden
              </div>
            )}

            {/* Geocoding-Hinweis */}
            {geocoding && (
              <div className="absolute inset-x-0 top-0 z-[1100] bg-copper/90 text-white text-center font-mono text-[10.5px] uppercase tracking-wider py-1.5 shadow">
                Adresse wird auf der Karte gesucht …
              </div>
            )}
            {!effectiveGeo && !geocoding && (site.street || site.city) && (
              <div className="absolute inset-0 z-[1100] grid place-items-center bg-bg-3/95 font-mono text-[11px] text-ink-2 text-center px-4">
                Adresse <b className="text-ink">{[site.street, site.city].filter(Boolean).join(", ")}</b><br />
                konnte nicht auf der Karte gefunden werden — bitte GPS-Koordinaten manuell eintragen.
              </div>
            )}

            <div className="absolute left-3 bottom-3 z-[1100] bg-bg-deep/95 backdrop-blur text-white px-3 py-1.5 rounded-md font-mono text-[10.5px] tracking-wider flex items-center gap-2 shadow-lg">
              <span className="text-copper">⌖</span> <b className="text-copper">{site.name}</b>
              {effectiveGeo && (
                <span className="text-steel">
                  · {effectiveGeo.lat.toFixed(4)}, {effectiveGeo.lng.toFixed(4)}
                  {!site.geo && geocoded && <span className="ml-1 text-copper-bright">(geocoded)</span>}
                </span>
              )}
            </div>
            </div>
          </div>

          <aside className="bg-white border border-steel-line/45 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {orderRef?.orderNumber && orderRef.orderNumber !== "—" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-copper/15 text-copper font-mono text-[10.5px] uppercase tracking-wider w-fit">
                  <span className="w-1.5 h-1.5 rounded-full bg-copper" /> {orderRef.orderNumber}
                </span>
              )}
              {inquiry && (
                <button
                  onClick={() => setOpenModal("inquiry")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-good/15 text-good hover:bg-good/25 transition-colors font-mono text-[10.5px] uppercase tracking-wider w-fit"
                  title={`Anfrage-Verlauf öffnen (${inquiry.source}, ${fmtShort(inquiry.createdAt.slice(0,10))})`}
                >
                  {SOURCE_ICON[inquiry.source] ?? "✉"} {SOURCE_LABEL[inquiry.source] ?? inquiry.source}-Anfrage · {fmtShort(inquiry.createdAt.slice(0,10))}
                </button>
              )}
              {inquiry?.pipelineStage && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-steel/15 text-ink-2 font-mono text-[10.5px] uppercase tracking-wider w-fit">
                  Stage: {inquiry.pipelineStage}
                </span>
              )}
            </div>
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

        {/* AUFTRAG & ZAHLEN (live aus sevDesk) + VOR-ORT-BEMERKUNGEN */}
        <AuftragNotizBlock
          site={site}
          orderRef={orderRef}
          invoices={invoices}
          volumeNet={posSum}
          notes={notes}
          onSaveNotes={saveNotes}
          onOpenInvoices={() => setOpenModal("invoices")}
          onOpenPositions={() => { if (orderRef) setOpenModal("positions"); }}
        />

        {/* WETTER VOR ORT · wenn GPS bekannt */}
        {effectiveGeo && (
          <section className="mt-4 bg-white border border-steel-line/45 rounded-lg overflow-hidden">
            <LiveWeather lat={effectiveGeo.lat} lng={effectiveGeo.lng} variant="card" label={`Wetter vor Ort · ${site.city || site.name}`} />
          </section>
        )}

        {/* KLÄRPUNKTE — direkt sichtbar, weil handlungsrelevant */}
        <section className="mt-4 bg-white border border-steel-line/45 rounded-lg p-4">
          <QuestionsPanel
            siteId={site.id}
            questions={questions}
            loading={questionsLoading}
            onChange={refreshQuestions}
          />
        </section>

        {/* QUICK-ACCESS · 8 Cards (Positionen · Aufmaß · Stunden · Rechnungen · Material · Fotos · Anhaenge · Garten-Skizze) */}
        <section className="grid gap-3 mt-4 grid-cols-2 lg:grid-cols-8">
          <QuickCard
            label="Positionen"
            value={posCount === 0 ? "—" : `${posCount} · ${eur(posSum)}`}
            icon="📋"
            disabled={posCount === 0}
            onClick={() => setOpenModal("positions")}
          />
          <QuickCard
            label="Aufmaß"
            value={aufmassPositions.length === 0 ? "—" : `${aufmassPositions.length} vom Tablet`}
            icon="📐"
            disabled={aufmassPositions.length === 0}
            onClick={() => setOpenModal("aufmass")}
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
            label="Material"
            value={materials.length === 0
              ? (materialsLoading ? "lädt …" : "—")
              : (() => {
                  const installed = materials.filter((m) => m.status === "installed").length;
                  const active = materials.filter((m) => m.status !== "returned").length;
                  return `${installed}/${active} verbaut`;
                })()}
            icon="🧱"
            onClick={() => setOpenModal("materials")}
          />
          <QuickCard
            label="Fotos"
            value={photos.length === 0 ? "—" : `${photos.length} · neuestes ${latestPhoto?.date ? fmtShort(latestPhoto.date) : ""}`}
            iconPhoto={latestPhoto ?? undefined}
            onClick={() => setOpenModal("photos")}
          />
          <QuickCard
            label="Anhänge"
            value={media.length === 0 ? "—" : (() => {
              const v = media.filter((m) => m.kind === "video").length;
              const a = media.filter((m) => m.kind === "audio").length;
              return [v ? `${v} Video${v === 1 ? "" : "s"}` : null, a ? `${a} Audio` : null].filter(Boolean).join(" · ");
            })()}
            icon="🎬"
            disabled={media.length === 0}
            onClick={() => setOpenModal("media")}
          />
          <QuickCard
            label="Garten-Skizze"
            value="Planer öffnen"
            icon="🌿"
            onClick={() => navigate(`/admin/garten?site=${id}`)}
          />
        </section>
      </main>

      {/* Modals */}
      {openModal === "positions" && orderRef && (
        <Modal title={`${orderRef.orderNumber} · Positionen`} onClose={() => setOpenModal(null)}>
          <PositionsBody positions={orderRef.positions} sum={posSum} />
        </Modal>
      )}
      {openModal === "aufmass" && (
        <Modal title={`Aufmaß · ${site.name}`} onClose={() => setOpenModal(null)} wide>
          <AufmassBody positions={aufmassPositions} photos={photos} />
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
      {openModal === "media" && (
        <Modal title={`Anhänge · ${media.length} ${media.length === 1 ? "Datei" : "Dateien"}`} onClose={() => setOpenModal(null)} wide>
          <MediaBody media={media} />
        </Modal>
      )}
      {openModal === "inquiry" && inquiry && (
        <Modal title={`${SOURCE_LABEL[inquiry.source] ?? inquiry.source}-Anfrage · ${inquiry.customerName ?? "—"}`} onClose={() => setOpenModal(null)} wide>
          <InquiryBody inquiry={inquiry} />
        </Modal>
      )}
      {openModal === "materials" && (
        <Modal title={`Material · ${site.name}`} onClose={() => setOpenModal(null)} wide>
          <MaterialsBody
            siteId={site.id}
            materials={materials}
            loading={materialsLoading}
            onChange={refreshMaterials}
          />
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
      <div className="fixed inset-0 bg-black/60 z-[1200]" onClick={onClose} />
      <div
        role="dialog" aria-modal="true"
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1201] bg-white rounded-2xl shadow-2xl border border-steel-line/45 overflow-hidden flex flex-col w-[94vw] ${wide ? "max-w-[1080px]" : "max-w-[760px]"} max-h-[88vh]`}
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

function AufmassBody({ positions, photos }: { positions: PipelinePosition[]; photos: PhotoWithContext[] }) {
  if (positions.length === 0) return <Empty>Noch kein Aufmaß vom Tablet erfasst. Sobald draußen gemessen wird, erscheinen die Positionen samt Skizze hier.</Empty>;
  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] text-ink-mute uppercase tracking-wide">
        {positions.length} Position{positions.length === 1 ? "" : "en"} vom Aufmaß-Tablet · Mengen fließen ins Angebot, Preise ergänzt das Büro
      </p>
      {positions.map((p, i) => {
        const photo = p.meta?.photo_id ? photos.find((ph) => ph.id === p.meta!.photo_id) : undefined;
        const isGps = p.meta?.method === "gps";
        const isSketch = p.meta?.method === "skizze";
        return (
          <div key={i} className="flex gap-4 items-center border border-steel-line/35 rounded-lg p-3 bg-bg-2/30">
            {photo
              ? <AufmassThumb photo={photo} />
              : <div className="w-[150px] h-[107px] rounded-md bg-bg-3 grid place-items-center text-ink-mute text-[10px] font-mono shrink-0">kein Bild</div>}
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-wider text-copper">
                {isGps ? "📍 GPS-Begehung" : isSketch ? "✏ Finger-Skizze" : "Aufmaß"}
              </div>
              <div className="font-display font-extrabold uppercase text-ink text-[15px] leading-tight mt-0.5 truncate">{p.name}</div>
              <div className="font-mono text-[22px] text-ink font-bold mt-1 tabular-nums">{p.quantity}</div>
              <div className="font-mono text-[11px] text-ink-mute mt-1 flex flex-wrap gap-x-3">
                {isGps && p.meta?.worstAccM != null && p.meta.worstAccM < 9999 && (
                  <span>Genauigkeit ±{p.meta.worstAccM.toFixed(1).replace(".", ",")} m</span>
                )}
                {isSketch && p.meta?.edges_m && <span>{p.meta.edges_m.length} Kanten bemaßt</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AufmassThumb({ photo }: { photo: PhotoWithContext }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    photoUrl(photo, "raw").then((u) => { if (!cancelled) setUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [photo.id]);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer"
      className="w-[150px] h-[107px] rounded-md overflow-hidden bg-bg-deep shrink-0 border border-steel-line/40 block">
      {url && <img src={url} alt="Aufmaß-Beleg" className="w-full h-full object-contain" />}
    </a>
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

function MediaBody({ media }: { media: SiteMedia[] }) {
  if (media.length === 0) return <Empty>Keine Anhänge.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {media.map((m) => <MediaTile key={m.id} media={m} />)}
    </div>
  );
}

function InquiryBody({ inquiry }: { inquiry: InquiryRef }) {
  const log = [...inquiry.notesLog].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="flex flex-col gap-4">
      {/* Kopfzeile mit Kontaktdaten */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
        {inquiry.customerName && <KV label="Kunde" value={inquiry.customerName} />}
        {inquiry.customerPhone && <KV label="Telefon" value={inquiry.customerPhone} />}
        {inquiry.customerEmail && <KV label="E-Mail" value={inquiry.customerEmail} />}
        {inquiry.city && <KV label="Ort" value={inquiry.city} />}
        <KV label="Quelle" value={`${SOURCE_ICON[inquiry.source] ?? ""} ${SOURCE_LABEL[inquiry.source] ?? inquiry.source}`} />
        <KV label="Eingang" value={fmtShort(inquiry.createdAt.slice(0, 10))} />
        <KV label="Status" value={inquiry.status} />
        <KV label="Priorität" value={inquiry.priority} />
      </div>

      {/* Beschreibung */}
      {inquiry.description && (
        <div className="card-steel p-3">
          <div className="dd-eyebrow text-ink-2 mb-1.5">Was der Kunde will</div>
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{inquiry.description}</div>
        </div>
      )}

      {/* Timeline-Verlauf */}
      {log.length > 0 && (
        <div className="card-steel p-3">
          <div className="dd-eyebrow text-ink-2 mb-2">Verlauf · {log.length} Eintrag{log.length === 1 ? "" : "e"}</div>
          <ol className="flex flex-col gap-2">
            {log.map((e, i) => (
              <li key={i} className="grid grid-cols-[110px_1fr] gap-2 text-[12px] border-l-2 border-copper/40 pl-3 py-0.5">
                <span className="font-mono text-[11px] text-ink-2 tabular-nums">{e.at.slice(0,10)} {e.at.slice(11,16)}</span>
                <div>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-copper mr-2">{e.by} · {e.kind}</span>
                  <span className="text-ink">{e.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Roh-Verlauf zum Aufklappen */}
      {inquiry.rawText && (
        <details className="card-steel p-3">
          <summary className="cursor-pointer dd-eyebrow text-ink-2">Original-Nachricht ({inquiry.rawText.length.toLocaleString("de")} Zeichen)</summary>
          <pre className="mt-2 text-[11.5px] leading-relaxed whitespace-pre-wrap font-mono text-ink-2 max-h-[400px] overflow-auto">{inquiry.rawText}</pre>
        </details>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="dd-eyebrow text-ink-2">{label}</div>
      <div className="text-ink font-medium">{value}</div>
    </div>
  );
}

function MediaTile({ media }: { media: SiteMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    mediaUrl(media).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [media.id]);
  const kb = media.bytes ? `${(media.bytes / 1024).toFixed(0)} kB` : "";
  const taken = media.takenAt ? fmtShort(media.takenAt.slice(0, 10)) : "";
  return (
    <div className="card-steel p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{media.kind === "video" ? "🎬" : "🎙"}</span>
          <span className="font-mono text-[12px] text-ink-2 uppercase tracking-wider">{media.kind} · {media.mimeType.split("/").pop()}</span>
        </div>
        <div className="font-mono text-[11px] text-ink-2 tabular-nums">{taken} · {kb}</div>
      </div>
      {url ? (
        media.kind === "video"
          ? <video src={url} controls preload="metadata" className="w-full max-h-[480px] rounded bg-black" />
          : <audio src={url} controls preload="metadata" className="w-full" />
      ) : (
        <div className="text-ink-2 text-[12px] py-4 text-center">lädt …</div>
      )}
    </div>
  );
}

/* ── Klärpunkte-Panel ─────────────────────────────────────────────────── */
function QuestionsPanel({
  siteId, questions, loading, onChange,
}: {
  siteId: string;
  questions: SiteQuestion[];
  loading: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addKind, setAddKind] = useState<QuestionKind>("sonstiges");
  const [addOwner, setAddOwner] = useState("");
  const [adding, setAdding] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const offen     = questions.filter((q) => q.status === "offen");
  const wartet    = questions.filter((q) => q.status === "wartet");
  const erledigt  = questions.filter((q) => q.status === "erledigt");
  const verworfen = questions.filter((q) => q.status === "verworfen");

  async function add() {
    if (!addTitle.trim()) return;
    setAdding(true);
    try {
      await createSiteQuestion({ siteId, title: addTitle.trim(), kind: addKind, owner: addOwner.trim() || undefined });
      setAddTitle(""); setAddOwner(""); setAddKind("sonstiges"); setAddOpen(false);
      await onChange();
    } catch (e: any) { alert("Fehler: " + (e?.message ?? e)); }
    finally { setAdding(false); }
  }

  async function setStatus(q: SiteQuestion, status: QuestionStatus) {
    try { await updateSiteQuestion(q.id, { status }); await onChange(); }
    catch (e: any) { alert("Status: " + (e?.message ?? e)); }
  }
  async function del(q: SiteQuestion) {
    if (!confirm(`Klärpunkt "${q.title}" löschen?`)) return;
    try { await deleteSiteQuestion(q.id); await onChange(); }
    catch (e: any) { alert("Löschen: " + (e?.message ?? e)); }
  }

  const visible = [...offen, ...wartet, ...(showResolved ? [...erledigt, ...verworfen] : [])];

  return (
    <div>
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="font-display font-extrabold uppercase text-[16px] tracking-wide text-ink leading-none">
            Klärpunkte
          </h2>
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-mute mt-1">
            {offen.length} offen · {wartet.length} warten · {erledigt.length} erledigt
            {loading && <span className="ml-2">· lädt …</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(erledigt.length + verworfen.length > 0) && (
            <button
              onClick={() => setShowResolved((s) => !s)}
              className="font-mono text-[10.5px] uppercase tracking-wider text-ink-mute hover:text-copper underline-offset-2 hover:underline"
            >
              {showResolved ? "Erledigte ausblenden" : `Erledigte (${erledigt.length + verworfen.length}) anzeigen`}
            </button>
          )}
          <button
            onClick={() => setAddOpen((o) => !o)}
            className="btn-primary !min-h-[34px] !px-3 text-[11.5px]"
          >
            {addOpen ? "Abbrechen" : "+ Klärpunkt"}
          </button>
        </div>
      </div>

      {/* Add-Formular (klappt auf) */}
      {addOpen && (
        <div className="bg-bg-2 border border-steel-line/45 rounded-md p-3 mb-3 grid grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
          <div>
            <label className="dd-eyebrow text-ink-2 block mb-1">Titel</label>
            <input
              autoFocus
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="z.B. Naturstein oder Beton bei Beeteinfassung?"
              className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[13px] font-sans"
            />
          </div>
          <div>
            <label className="dd-eyebrow text-ink-2 block mb-1">Art</label>
            <select
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as QuestionKind)}
              className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2 py-1.5 text-[13px] font-mono"
            >
              {(Object.entries(Q_KIND_META) as [QuestionKind, typeof Q_KIND_META[QuestionKind]][]).map(([k, m]) => (
                <option key={k} value={k}>{m.icon} {m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="dd-eyebrow text-ink-2 block mb-1">Owner</label>
            <input
              value={addOwner}
              onChange={(e) => setAddOwner(e.target.value)}
              placeholder="Rick / Udo / WW"
              className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[13px] font-sans"
            />
          </div>
          <button
            onClick={add}
            disabled={!addTitle.trim() || adding}
            className="btn-primary !min-h-[34px] !px-3 text-[11.5px] disabled:opacity-50"
          >
            {adding ? "…" : "Anlegen"}
          </button>
        </div>
      )}

      {/* Liste */}
      {visible.length === 0 ? (
        <p className="font-mono text-[12px] text-ink-mute py-2">
          Keine offenen Klärpunkte. Wenn aus einer Anfrage Material-Alternativen kommen, landen sie hier automatisch.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((q) => {
            const kind = Q_KIND_META[q.kind];
            const status = Q_STATUS_META[q.status];
            const isDone = q.status === "erledigt" || q.status === "verworfen";
            return (
              <li
                key={q.id}
                className={`border rounded-md px-3 py-2 flex items-start gap-3 ${isDone ? "border-steel-line/30 bg-bg-3/40 opacity-70" : "border-steel-line/45 bg-white"}`}
              >
                <span className="text-[16px] leading-none mt-0.5" title={kind.label}>{kind.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-sans text-[13.5px] leading-snug ${isDone ? "line-through text-ink-mute" : "text-ink"}`}>
                    {q.title}
                  </div>
                  <div className="font-mono text-[10.5px] text-ink-mute mt-0.5">
                    <span style={{ color: status.color, fontWeight: 700 }}>{status.label}</span>
                    {q.owner && <span className="ml-2">· {q.owner}</span>}
                    {q.dueAt && <span className="ml-2">· bis {q.dueAt}</span>}
                    {q.sourceInquiryId && <span className="ml-2 text-copper">· aus Anfrage</span>}
                    {q.resolutionNote && <span className="ml-2">· „{q.resolutionNote}"</span>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {q.status === "offen" && (
                    <>
                      <button onClick={() => setStatus(q, "wartet")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wider hover:bg-amber/15" style={{ color: "#B45309", border: "1px solid rgba(180,83,9,0.4)" }}>wartet</button>
                      <button onClick={() => setStatus(q, "erledigt")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wider hover:bg-moss/15" style={{ color: "#15803D", border: "1px solid rgba(21,128,61,0.4)" }}>✓ erledigt</button>
                    </>
                  )}
                  {q.status === "wartet" && (
                    <button onClick={() => setStatus(q, "erledigt")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wider hover:bg-moss/15" style={{ color: "#15803D", border: "1px solid rgba(21,128,61,0.4)" }}>✓ erledigt</button>
                  )}
                  {isDone && (
                    <button onClick={() => setStatus(q, "offen")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wider text-ink-mute hover:text-copper border border-steel-line/45 hover:border-copper">↶ wieder öffnen</button>
                  )}
                  <button onClick={() => del(q)} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wider text-ink-mute hover:text-rust border border-steel-line/45 hover:border-rust" title="Löschen">✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Material-Body ────────────────────────────────────────────────────── */
function MaterialsBody({
  siteId, materials, loading, onChange,
}: {
  siteId: string;
  materials: SiteMaterial[];
  loading: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [addName, setAddName] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addUnit, setAddUnit] = useState("Stk");
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      await createSiteMaterial({
        siteId,
        name: addName.trim(),
        quantity: addQty ? parseFloat(addQty.replace(",", ".")) || undefined : undefined,
        unit: addUnit || undefined,
      });
      setAddName(""); setAddQty("");
      await onChange();
    } catch (e: any) { alert("Fehler: " + (e?.message ?? e)); }
    finally { setAdding(false); }
  }

  async function changeStatus(m: SiteMaterial, next: MaterialStatus) {
    try {
      await updateSiteMaterialStatus(m.id, next);
      await onChange();
    } catch (e: any) { alert("Status-Update fehlgeschlagen: " + (e?.message ?? e)); }
  }

  async function del(m: SiteMaterial) {
    if (!confirm(`Material "${m.name}" wirklich löschen?`)) return;
    try { await deleteSiteMaterial(m.id); await onChange(); }
    catch (e: any) { alert("Löschen fehlgeschlagen: " + (e?.message ?? e)); }
  }

  const grouped = useMemo(() => {
    const byStatus = new Map<MaterialStatus, SiteMaterial[]>();
    materials.forEach((m) => {
      const list = byStatus.get(m.status) ?? [];
      list.push(m);
      byStatus.set(m.status, list);
    });
    // Reihenfolge: planned → ordered → delivered → installed → returned
    return (["planned", "ordered", "delivered", "installed", "returned"] as MaterialStatus[])
      .map((s) => ({ status: s, items: byStatus.get(s) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [materials]);

  const total = materials.filter((m) => m.status !== "returned").length;
  const installed = materials.filter((m) => m.status === "installed").length;

  return (
    <div className="font-sans">
      {/* Zähler */}
      <div className="px-2 pb-3 border-b border-steel-line/40 flex items-baseline justify-between">
        <div className="font-mono text-[11px] tracking-wider uppercase text-ink-mute">
          {installed} von {total} verbaut · {materials.filter((m) => m.status === "ordered").length} bestellt · {materials.filter((m) => m.status === "delivered").length} angeliefert
        </div>
        {loading && <span className="font-mono text-[10px] text-ink-mute">lädt …</span>}
      </div>

      {/* Hinzufügen */}
      <div className="mt-3 mb-4 grid grid-cols-[1fr_80px_70px_auto] gap-2 items-end">
        <div>
          <label className="dd-eyebrow text-ink-2 block mb-1">Material / Position</label>
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="z.B. Doppelstabmatte 183 anthrazit"
            className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[13px] font-sans"
          />
        </div>
        <div>
          <label className="dd-eyebrow text-ink-2 block mb-1">Menge</label>
          <input
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            placeholder="—"
            inputMode="decimal"
            className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[13px] font-mono text-right"
          />
        </div>
        <div>
          <label className="dd-eyebrow text-ink-2 block mb-1">Einheit</label>
          <select
            value={addUnit}
            onChange={(e) => setAddUnit(e.target.value)}
            className="w-full border-[1.5px] border-steel-line/45 rounded-md px-2 py-1.5 text-[13px] font-mono"
          >
            <option>Stk</option><option>m</option><option>m²</option><option>m³</option><option>lfm</option><option>kg</option><option>t</option><option>Sack</option><option>pausch.</option>
          </select>
        </div>
        <button
          onClick={add}
          disabled={!addName.trim() || adding}
          className="btn-primary !min-h-[36px] !px-4 text-[12px] disabled:opacity-50"
        >
          {adding ? "…" : "+ Hinzu"}
        </button>
      </div>

      {/* Listen pro Status */}
      {materials.length === 0 && !loading ? (
        <Empty>Noch keine Materialien erfasst. Lege oben das erste an.</Empty>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ status, items }) => {
            const meta = MATERIAL_STATUS_META[status];
            return (
              <div key={status}>
                <div className="font-display font-extrabold uppercase text-[11px] tracking-wide mb-1.5 flex items-baseline gap-2" style={{ color: meta.color }}>
                  <span className="text-[14px]">{meta.icon}</span>
                  {meta.label} <span className="text-ink-mute font-mono">· {items.length}</span>
                </div>
                <ul className="space-y-1">
                  {items.map((m) => (
                    <li key={m.id} className="bg-bg-2 border border-steel-line/40 rounded-md px-3 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-sans text-[13px] text-ink leading-snug">{m.name}</div>
                        <div className="font-mono text-[10.5px] text-ink-mute mt-0.5">
                          {m.quantity != null && <span>{m.quantity}{m.unit ? " " + m.unit : ""}</span>}
                          {m.supplier && <span className="ml-2">· {m.supplier}</span>}
                          {m.orderedAt && <span className="ml-2">· bestellt {m.orderedAt}</span>}
                          {m.deliveredAt && <span className="ml-2">· geliefert {m.deliveredAt}</span>}
                        </div>
                      </div>
                      {/* Status-Buttons je nach aktueller Stufe nur sinnvolle Schritte anzeigen */}
                      <div className="flex gap-1 flex-shrink-0">
                        {status === "planned" && (
                          <button onClick={() => changeStatus(m, "ordered")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wide bg-amber/15 text-amber-deep hover:bg-amber/25 border border-amber/40">→ bestellt</button>
                        )}
                        {status === "ordered" && (
                          <button onClick={() => changeStatus(m, "delivered")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wide bg-info/15 text-info hover:bg-info/25 border border-info/40" style={{ color: "#1E40AF", borderColor: "rgba(30,64,175,0.4)", background: "rgba(30,64,175,0.1)" }}>→ geliefert</button>
                        )}
                        {status === "delivered" && (
                          <button onClick={() => changeStatus(m, "installed")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wide bg-moss/15 text-moss hover:bg-moss/25 border border-moss/40" style={{ color: "#15803D", borderColor: "rgba(21,128,61,0.4)", background: "rgba(21,128,61,0.1)" }}>→ verbaut</button>
                        )}
                        {status !== "returned" && status !== "installed" && (
                          <button onClick={() => changeStatus(m, "returned")} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wide text-ink-mute hover:text-rust border border-steel-line/45 hover:border-rust">retour</button>
                        )}
                        <button onClick={() => del(m)} className="px-2 py-1 rounded text-[10.5px] font-mono uppercase tracking-wide text-ink-mute hover:text-rust border border-steel-line/45 hover:border-rust" title="Löschen">✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
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

async function loadInquiryForSite(siteId: string): Promise<InquiryRef | null> {
  if (!isBackendConnected() || !supabase) return null;
  const sb: any = supabase;
  // Schritt 1: Pipeline-Card der Baustelle holen
  const { data: cards } = await sb
    .from("pipeline_cards")
    .select("id, stage")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(1);
  const card = cards?.[0];
  if (!card) return null;
  // Schritt 2: Inquiry der Card holen
  const { data: inq } = await sb
    .from("inquiries")
    .select("id, source, customer_name, customer_phone, customer_email, city, description, raw_text, notes_log, status, priority, created_at, pipeline_card_id")
    .eq("pipeline_card_id", card.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const r = inq?.[0];
  if (!r) return null;
  return {
    id: r.id,
    source: r.source,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    city: r.city,
    description: r.description,
    rawText: r.raw_text ?? "",
    notesLog: Array.isArray(r.notes_log) ? r.notes_log : [],
    status: r.status,
    priority: r.priority,
    createdAt: r.created_at,
    pipelineStage: card.stage,
    pipelineCardId: card.id,
  };
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

/* ── Leaflet-Satelliten-Karte (Pan + Wheel-Zoom + Marker) ───────────────── */

function LeafletSatellite({
  lat, lng, label, className, onMove
}: {
  lat: number; lng: number; label: string; className?: string;
  onMove?: (lat: number, lng: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // onMove über Ref, damit der einmalige Init-Effekt nicht neu rendern muss
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  // Map einmalig initialisieren
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      center: [lat, lng],
      zoom: 18,
      minZoom: 4,
      maxZoom: 19,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true,
    });

    // Amtliches Luftbild Niedersachsen (LGLN DOP20, 20 cm, CC BY 4.0) als
    // Standard — schaerfer + aktueller fuer NI als Esri. Esri World Imagery
    // bleibt als umschaltbare Alternative (z.B. fuer Grenzgebiete).
    const dopNI = L.tileLayer.wms(
      "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms",
      {
        layers: "ni_dop20",
        format: "image/jpeg",
        version: "1.3.0",
        attribution: "Luftbild &copy; LGLN (CC BY 4.0)",
        maxZoom: 20,
      } as any
    );
    const esri = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
        maxNativeZoom: 19,
        maxZoom: 19,
      }
    );
    dopNI.addTo(map);
    L.control.layers(
      { "Luftbild · LGLN": dopNI, "Satellit · Esri": esri },
      {},
      { position: "topright", collapsed: true }
    ).addTo(map);

    // Orangener Crosshair-Marker, draggable
    const icon = L.divIcon({
      className: "leuschner-marker",
      html: `<div style="color:#DC6E2D;font-size:28px;line-height:1;text-shadow:0 2px 4px rgba(0,0,0,0.7);cursor:grab;">⌖</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    const marker = L.marker([lat, lng], { icon, draggable: true, autoPan: true })
      .addTo(map)
      .bindTooltip(`${label} · ziehen, um Position zu korrigieren`, { direction: "top", offset: [0, -28] });
    marker.on("dragend", () => {
      const ll = marker.getLatLng();
      onMoveRef.current?.(ll.lat, ll.lng);
    });
    markerRef.current = marker;

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auf Koordinaten-Änderung von außen: Marker + View nachziehen
  // (NICHT triggern durch eigenen dragend, sonst Endlos-Loop)
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    const cur = markerRef.current.getLatLng();
    if (Math.abs(cur.lat - lat) < 1e-7 && Math.abs(cur.lng - lng) < 1e-7) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.setView([lat, lng]);
  }, [lat, lng]);

  // Label-Änderung (z. B. Site umbenannt)
  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setTooltipContent(`${label} · ziehen, um Position zu korrigieren`);
  }, [label]);

  return <div ref={ref} className={className} />;
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
      {url === null ? (
        <div className="w-full h-full grid place-items-center text-ink-mute text-xl">⋯</div>
      ) : (
        <ImageWithFallback
          src={url}
          className="w-full h-full object-cover"
          fallbackClassName="w-full h-full flex items-center justify-center bg-bg-deep"
          loading="lazy"
        />
      )}
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
    <div className="fixed inset-0 bg-black/95 z-[1300] flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-white safe-top">
        <div>
          <div className="font-mono text-sm">{index + 1} / {photos.length}</div>
          {worker && <div className="font-mono text-white/55 text-[11px]">{worker.firstName} {worker.lastName}</div>}
        </div>
        <button onClick={onClose} className="text-3xl leading-none" aria-label="Schließen">×</button>
      </header>
      <div className="flex-1 flex items-center justify-center overflow-hidden touch-pan-x">
        {url === null ? (
          <span className="text-white/60">lädt …</span>
        ) : (
          <ImageWithFallback
            src={url}
            className="max-w-full max-h-full object-contain"
            fallbackClassName="w-40 h-40 flex items-center justify-center bg-bg-deep rounded-2xl"
            draggable={false}
          />
        )}
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

/* ── Variante 5 · Dark Hero-Band (kaufmännisch, live) + helle Notiz-Karte
   (operative Vor-Ort-Bemerkungen). Trennt sauber: Zahlen kommen live aus dem
   verknüpften Vorgang/sevDesk, das Notizfeld bleibt frei für die Baustelle. ── */
function AuftragNotizBlock({
  site, orderRef, invoices, volumeNet, notes, onSaveNotes, onOpenInvoices, onOpenPositions
}: {
  site: SiteRow;
  orderRef: OrderRef | null;
  invoices: InvoiceRow[];
  volumeNet: number;
  notes: string;
  onSaveNotes: (text: string) => Promise<void>;
  onOpenInvoices: () => void;
  onOpenPositions: () => void;
}) {
  const open = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
  const paidSum = invoices.filter((i) => i.status === "paid").reduce((t, i) => t + (i.netEur ?? 0), 0);
  const openSum = open.reduce((t, i) => t + (i.netEur ?? 0), 0);
  const an = orderRef?.orderNumber && orderRef.orderNumber !== "—" ? orderRef.orderNumber : null;
  const hasCommercial = !!an || volumeNet > 0 || invoices.length > 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDraft(notes); }, [notes]);

  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean);

  async function save() {
    setBusy(true); setErr(null);
    try { await onSaveNotes(draft); setEditing(false); }
    catch (e: any) { setErr(e?.message ?? "Speichern fehlgeschlagen"); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-4 rounded-xl overflow-hidden shadow-sm border border-steel-line/45">
      {hasCommercial && (
        <div className="surface-steel px-5 lg:px-6 py-4" style={{ borderBottom: "3px solid #DC6E2D" }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper-bright mb-1">Auftrag &amp; Zahlen · live aus sevDesk</div>
              <div className="font-display font-black uppercase text-[20px] text-white leading-tight">
                {site.name}{an ? <span className="text-steel"> · {an}</span> : null}
              </div>
              {(site.street || site.city) && (
                <div className="font-mono text-[11.5px] text-steel mt-1">{[site.street, site.city].filter(Boolean).join(" · ")}</div>
              )}
              {open.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {open.slice(0, 3).map((i) => (
                    <span key={i.id} className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-mono"
                      style={{ background: "rgba(201,133,47,.18)", color: "#F5B45A", border: "1px solid rgba(245,180,90,.3)" }}>
                      {i.invoiceNumber} offen
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2.5 flex-wrap">
              {volumeNet > 0 && <HeroKpi label="Volumen netto" value={eur(volumeNet)} accent="copper" />}
              {paidSum > 0 && <HeroKpi label="Bezahlt" value={eur(paidSum)} accent="green" />}
              {openSum > 0 && <HeroKpi label="Offen" value={eur(openSum)} accent="amber" />}
            </div>
          </div>
          <div className="flex gap-4 mt-3">
            {an && <button onClick={onOpenPositions} className="font-mono text-[11px] text-copper-bright hover:text-white">→ Positionen</button>}
            {invoices.length > 0 && <button onClick={onOpenInvoices} className="font-mono text-[11px] text-copper-bright hover:text-white">→ Rechnungen ({invoices.length})</button>}
          </div>
        </div>
      )}

      <div className="bg-white px-5 lg:px-6 py-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[15px] text-copper">✎</span>
            <div>
              <div className="font-display font-extrabold uppercase text-[12px] tracking-widest text-ink">Vor-Ort-Bemerkungen</div>
              <div className="font-sans text-[11px] text-ink-mute">Hinweise für die Mitarbeiter auf der Baustelle</div>
            </div>
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)} className="btn-ghost !min-h-[36px] !px-3 text-[11px]">
              {lines.length ? "✎ Bearbeiten" : "+ Bemerkung"}
            </button>
          )}
        </div>

        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              placeholder="z. B. Zufahrt über Feldweg · Schlüssel beim Nachbarn Nr. 4 · Ansprechpartner Herr … 0171 … · Schotter-Lager an der Garage · Achtung: Wasserleitung im Vorgarten"
              className="w-full px-3 py-2.5 border border-steel rounded-lg text-[13px] font-sans text-ink-body leading-relaxed focus:outline-none focus:border-copper resize-y"
            />
            <div className="font-sans text-[11px] text-ink-mute mt-1">Eine Bemerkung pro Zeile. Wörter wie „Achtung/Wasserleitung/Strom/Hund" werden hervorgehoben.</div>
            {err && <div className="font-sans text-[12px] text-rust mt-1">⚠ {err}</div>}
            <div className="flex gap-2 mt-2">
              <button onClick={save} disabled={busy} className="btn-primary !min-h-[40px] text-[12px] disabled:opacity-50">{busy ? "Speichert …" : "Speichern"}</button>
              <button onClick={() => { setDraft(notes); setEditing(false); setErr(null); }} disabled={busy} className="btn-ghost !min-h-[40px] text-[12px]">Abbrechen</button>
            </div>
          </div>
        ) : lines.length ? (
          <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5">
            {lines.map((l, idx) => {
              const warn = /achtung|vorsicht|gefahr|wasserleitung|strom|hund|gas/i.test(l);
              return (
                <li key={idx} className="flex items-start gap-2 text-[13px] font-sans leading-snug">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: warn ? "#C9852F" : "#8B9197" }} />
                  <span className={warn ? "text-bronze font-semibold" : "text-ink-body"}>{l}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-4 font-sans text-[12.5px] text-ink-mute">
            Noch keine Vor-Ort-Bemerkungen. <button onClick={() => setEditing(true)} className="text-copper hover:text-copper-bright font-semibold">+ jetzt hinzufügen</button>
          </div>
        )}
      </div>
    </section>
  );
}

function HeroKpi({ label, value, accent }: { label: string; value: string; accent: "copper" | "green" | "amber" }) {
  const col = accent === "green" ? "#22C55E" : accent === "amber" ? "#F5B45A" : "#E8853F";
  return (
    <div className="flex flex-col items-center gap-0.5 px-3.5 py-2 rounded-lg min-w-[80px]"
      style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.14)" }}>
      <span className="font-mono font-extrabold text-[16px] tabular-nums" style={{ color: col }}>{value}</span>
      <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-steel">{label}</span>
    </div>
  );
}
