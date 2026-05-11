import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  archiveSite, createSite, listAllSites, type SiteInput, unarchiveSite, updateSite
} from "../lib/api";
import { useRealtime, useRefreshOnVisible } from "../lib/realtime";
import type { Site } from "../lib/types";

type SiteRow = Site & { archived?: boolean };

export default function Sites() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listAllSites(true);
      setSites(data);
    } catch (err: any) {
      setError(err?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Echtzeit-Updates bei Änderungen an Baustellen
  useRealtime("sites-admin", ["sites"], refresh);
  useRefreshOnVisible(refresh);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sites.filter((s) => {
      if (!showArchived && s.archived) return false;
      if (showArchived && !s.archived) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.street.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        (s.projectNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [sites, search, showArchived]);

  const activeCount = sites.filter((s) => !s.archived).length;
  const archivedCount = sites.filter((s) => s.archived).length;

  return (
    <div className="min-h-screen safe-bottom bg-bg-DEFAULT">
      <header className="sticky top-0 z-30 bg-bg-DEFAULT border-b border-ink/10 px-5 lg:px-10 xl:px-14 pt-4 pb-3 safe-top">
        <button
          onClick={() => navigate("/admin")}
          className="h-mono text-paper/55 text-[11px] hover:text-copper transition-colors mb-3 flex items-center gap-2"
        >
          <span>←</span><span>Zurück zum Dashboard</span>
        </button>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="h-mono text-copper text-[11px]">— Stammdaten</span>
            <h1 className="h-display text-2xl lg:text-3xl mt-1">Baustellen</h1>
            <span className="text-[12px] text-paper/65 mt-1 block">
              {activeCount} aktiv{archivedCount > 0 ? ` · ${archivedCount} archiviert` : ""}
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="btn-primary text-[12px]"
          >
            ＋ Neue Baustelle
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen — Name, Auftragsnr., Adresse …"
            className="flex-1 min-w-[200px] px-3.5 py-2 bg-bg-2 border-2 border-ink/15 rounded-lg text-sm focus:outline-none focus:border-copper"
          />
          <div className="flex gap-1.5 text-[11px]">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1.5 rounded-full h-mono ${!showArchived ? "bg-copper text-bg-DEFAULT" : "border border-ink/15 text-paper/65"}`}
            >
              Aktiv
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1.5 rounded-full h-mono ${showArchived ? "bg-copper text-bg-DEFAULT" : "border border-ink/15 text-paper/65"}`}
              disabled={archivedCount === 0}
            >
              Archiv ({archivedCount})
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-5 lg:mx-8 mt-4 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">
          {error}
        </div>
      )}

      <main className="px-5 lg:px-10 xl:px-14 py-6">
        {loading ? (
          <div className="text-center py-16 h-mono text-paper/55 text-[12px]">Wird geladen …</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="h-mono text-paper/55 text-[12px]">
              {showArchived ? "Keine archivierten Baustellen" : "Keine Baustelle gefunden"}
            </div>
            {!showArchived && search === "" && (
              <button onClick={() => setCreating(true)} className="btn-primary text-[12px] mt-4">
                Erste Baustelle anlegen
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {filtered.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                onEdit={() => setEditing(site)}
                onArchive={async () => {
                  if (!confirm(`„${site.name}" archivieren? Sie taucht dann nicht mehr im Wochenplan auf.`)) return;
                  await archiveSite(site.id).catch((e) => setError(e?.message));
                  refresh();
                }}
                onUnarchive={async () => {
                  await unarchiveSite(site.id).catch((e) => setError(e?.message));
                  refresh();
                }}
                onToggleStar={async () => {
                  await updateSite(site.id, { starred: !site.starred }).catch((e) => setError(e?.message));
                  refresh();
                }}
              />
            ))}
          </div>
        )}
      </main>

      {creating && (
        <SiteEditor
          title="Neue Baustelle"
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await createSite(input);
            setCreating(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <SiteEditor
          title="Baustelle bearbeiten"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await updateSite(editing.id, input);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SiteCard({
  site, onEdit, onArchive, onUnarchive, onToggleStar
}: {
  site: SiteRow;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      className={`bg-bg-2 border rounded-xl p-4 ${site.archived ? "border-ink/10 opacity-60" : "border-ink/15"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {site.projectNumber && (
            <div className="h-mono text-copper text-[11px]">— Auftrag {site.projectNumber}</div>
          )}
          <div className="font-display text-lg uppercase tracking-tight leading-tight">{site.name}</div>
          {(site.street || site.city) && (
            <div className="h-mono text-paper/65 text-[11px] mt-1">
              {site.street}{site.city ? ` · ${site.city}` : ""}
            </div>
          )}
          {site.geo && (
            <div className="h-mono text-paper/45 text-[10px] mt-1">
              GPS · {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}
            </div>
          )}
        </div>
        {!site.archived && (
          <button
            onClick={onToggleStar}
            className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-lg ${site.starred ? "text-copper" : "text-paper/30 hover:text-paper/55"}`}
            title={site.starred ? "Stern entfernen" : "Als Favorit markieren"}
          >
            {site.starred ? "★" : "☆"}
          </button>
        )}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-ink/10">
        {site.archived ? (
          <button onClick={onUnarchive} className="btn-ghost text-[11px] flex-1">
            Wiederherstellen
          </button>
        ) : (
          <>
            <button onClick={onEdit} className="btn-ghost text-[11px] flex-1">Bearbeiten</button>
            <button onClick={onArchive} className="btn-ghost text-[11px] text-rust">Archivieren</button>
          </>
        )}
      </div>
    </div>
  );
}

function SiteEditor({
  title, initial, onClose, onSave
}: {
  title: string;
  initial?: SiteRow;
  onClose: () => void;
  onSave: (input: SiteInput) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [projectNumber, setProjectNumber] = useState(initial?.projectNumber ?? "");
  const [street, setStreet] = useState(initial?.street ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [geoLat, setGeoLat] = useState<string>(initial?.geo?.lat?.toString() ?? "");
  const [geoLng, setGeoLng] = useState<string>(initial?.geo?.lng?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await Promise.race([
        onSave({
          name: name.trim(),
          projectNumber: projectNumber.trim() || undefined,
          street: street.trim() || undefined,
          city: city.trim() || undefined,
          starred,
          geoLat: geoLat ? Number(geoLat) : undefined,
          geoLng: geoLng ? Number(geoLng) : undefined
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Zeitüberschreitung — Server antwortet nicht")), 8000)
        )
      ]);
    } catch (e: any) {
      console.warn("[sites] save FAIL", e);
      setErr(e?.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-DEFAULT rounded-2xl border-2 border-ink/30 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 my-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="h-display text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="text-paper/55 hover:text-paper text-2xl leading-none px-2">×</button>
        </div>

        {err && (
          <div className="mb-3 px-3 py-2 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">{err}</div>
        )}

        <div className="space-y-3">
          <Field label="Name" required>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Fam. Hoffmann"
              className="input"
            />
          </Field>
          <Field label="Auftragsnummer">
            <input
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value)}
              placeholder="z. B. 2026-042"
              className="input font-mono"
            />
          </Field>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Field label="Straße">
              <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Wilhelmstr. 12" className="input" />
            </Field>
            <Field label="Ort / PLZ">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="26789 Leer" className="input" />
            </Field>
          </div>

          <details className="bg-bg-2 rounded-xl">
            <summary className="px-4 py-2.5 cursor-pointer h-mono text-copper text-[11px]">— GPS-Koordinaten (optional)</summary>
            <div className="px-4 pb-3 pt-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Lat">
                  <input value={geoLat} onChange={(e) => setGeoLat(e.target.value)} placeholder="53.2306" className="input font-mono" />
                </Field>
                <Field label="Lng">
                  <input value={geoLng} onChange={(e) => setGeoLng(e.target.value)} placeholder="7.4577" className="input font-mono" />
                </Field>
              </div>
              <p className="h-mono text-paper/45 text-[10px]">
                Optional — wird später für GPS-Verifizierung der Mitarbeiter-Einträge genutzt
              </p>
            </div>
          </details>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} className="accent-copper w-4 h-4" />
            <span className="text-[13px]">★ Favorit (taucht oben in der Liste auf)</span>
          </label>
        </div>

        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 text-[12px]">Abbrechen</button>
          <button type="submit" disabled={!name.trim() || saving} className="btn-primary flex-1 text-[12px] disabled:opacity-50">
            {saving ? "Speichert …" : initial ? "Speichern" : "Anlegen"}
          </button>
        </div>
      </form>

      <style>{`
        .input {
          width: 100%;
          background: var(--bg-2, #F4F4F5);
          border: 2px solid rgba(0,0,0,0.15);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 14px;
          color: #000;
          outline: none;
        }
        .input:focus { border-color: #DC6E2D; }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="h-mono text-copper text-[11px] block mb-1">
        — {label}{required && <span className="text-rust ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
