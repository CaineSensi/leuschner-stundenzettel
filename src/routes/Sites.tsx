import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  archiveSite, createSite, listAllSites, unarchiveSite, updateSite
} from "../lib/api";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import { withTimeout } from "../lib/utils";
import SiteEditor from "../components/SiteEditor";
import BackButton from "../components/BackButton";
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
      const data = await withTimeout(listAllSites(true), 8000, "Baustellen");
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
  // Auth-Session war beim ersten Fetch evtl. noch nicht da → nachladen, sobald sie kommt
  useRefreshOnAuth(refresh);

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
      <header className="sticky top-0 z-30 surface-steel px-5 lg:px-10 xl:px-14 pt-4 pb-4 safe-top">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright">Stammdaten</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">Baustellen</h1>
            <span className="font-sans text-[12px] text-steel mt-1 block">
              {activeCount} aktiv{archivedCount > 0 ? ` · ${archivedCount} archiviert` : ""}
            </span>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="btn-primary !min-h-[44px] text-[12px]"
          >
            ＋ Neue Baustelle
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen: Name, Auftragsnr., Adresse …"
            className="flex-1 min-w-[200px] px-3.5 py-2.5 bg-white/[0.08] border-[1.5px] border-white/20 rounded-lg text-sm text-white placeholder:text-steel focus:outline-none focus:border-copper-bright"
          />
          <div className="flex gap-1.5 text-[11px]">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1.5 rounded-full font-mono uppercase ${!showArchived ? "bg-copper-bright text-bg-deep font-bold" : "border border-white/20 text-steel hover:text-white"}`}
            >
              Aktiv
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1.5 rounded-full font-mono uppercase ${showArchived ? "bg-copper-bright text-bg-deep font-bold" : "border border-white/20 text-steel hover:text-white"} disabled:opacity-40`}
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
          <div className="text-center py-16 h-mono text-ink-2 text-[12px]">Wird geladen …</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="h-mono text-ink-2 text-[12px]">
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
                onOpen={() => navigate(`/admin/sites/${site.id}`)}
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
  site, onOpen, onEdit, onArchive, onUnarchive, onToggleStar
}: {
  site: SiteRow;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={`dd-card is-click p-4 ${site.archived ? "opacity-60" : ""}`}
      style={{ ["--c" as any]: site.archived ? "#A9AEB3" : site.starred ? "#DC6E2D" : "#8B9197" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {site.projectNumber && (
            <div className="h-mono text-copper text-[11px]">Auftrag {site.projectNumber}</div>
          )}
          <div className="font-display text-lg uppercase tracking-tight leading-tight">{site.name}</div>
          {(site.street || site.city) && (
            <div className="h-mono text-ink-2 text-[11px] mt-1">
              {site.street}{site.city ? ` · ${site.city}` : ""}
            </div>
          )}
          {site.geo && (
            <div className="h-mono text-ink-mute text-[10px] mt-1">
              GPS · {site.geo.lat.toFixed(4)}, {site.geo.lng.toFixed(4)}
            </div>
          )}
        </div>
        {!site.archived && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
            className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-lg ${site.starred ? "text-copper" : "text-ink-mute hover:text-ink-2"}`}
            title={site.starred ? "Stern entfernen" : "Als Favorit markieren"}
          >
            {site.starred ? "★" : "☆"}
          </button>
        )}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-ink/10" onClick={(e) => e.stopPropagation()}>
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

