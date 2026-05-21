import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listInquiries, updateInquiry, deleteInquiry, type Inquiry, type InquiryStatus } from "../lib/inquiries";
import { isBackendConnected } from "../lib/supabase";

/* Anfragen-Inbox · Liste aller eingegangenen Anfragen mit Statuswechsel. */

const SOURCE_LABEL: Record<string, string> = {
  mail: "Mail", phone: "Telefon", whatsapp: "WhatsApp",
  letter: "Brief", in_person: "persönlich", web: "Web", other: "andere"
};

const STATUS_META: Record<InquiryStatus, { label: string; color: string }> = {
  offen:            { label: "offen",            color: "#DC6E2D" },
  in_arbeit:        { label: "in Arbeit",        color: "#C9852F" },
  wurde_zu_angebot: { label: "→ Angebot",        color: "#1F7A3D" },
  verworfen:        { label: "verworfen",        color: "#6A6E72" }
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) + " " +
         d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export default function Anfragen() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Inquiry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setItems(await listInquiries({ onlyOpen: !showAll }));
    } catch (e: any) {
      setError(e?.message ?? "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { setLoading(true); refresh(); /* eslint-disable-next-line */ }, [showAll]);

  async function setStatus(id: string, status: InquiryStatus) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
    try { await updateInquiry(id, { status }); }
    catch (e: any) { setError(e?.message ?? "Update fehlgeschlagen"); refresh(); }
  }

  async function remove(id: string) {
    if (!confirm("Anfrage wirklich löschen?")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try { await deleteInquiry(id); }
    catch (e: any) { setError(e?.message ?? "Löschen fehlgeschlagen"); refresh(); }
  }

  return (
    <div className="min-h-screen flex flex-col safe-top">
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4">
        <button
          onClick={() => navigate("/admin")}
          className="dd-eyebrow text-steel hover:text-copper-bright transition-colors mb-2 flex items-center gap-2"
        >
          <span aria-hidden>←</span><span>Zurück zum Dashboard</span>
        </button>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Vertrieb · Inbox</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              Anfragen
            </h1>
            <span className={`font-mono text-[11.5px] mt-1.5 block tracking-wide ${isBackendConnected() ? "text-moss-bright" : "text-steel"}`}>
              {isBackendConnected() ? `● ${items.length} ${showAll ? "gesamt" : "offen / in Arbeit"}` : "○ Demo-Modus"}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="btn-ghost !min-h-[44px] !px-4 text-[12px] whitespace-nowrap"
            >
              {showAll ? "Nur offene zeigen" : "Alle zeigen"}
            </button>
            <Link
              to="/admin/anfrage-neu"
              className="btn-primary !min-h-[44px] text-[12px] whitespace-nowrap flex items-center"
            >
              ＋ Neue Anfrage
            </Link>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust font-sans">
          {error}
        </div>
      )}

      <main className="flex-1 px-4 lg:px-8 py-5 max-w-[1180px] w-full mx-auto">
        {loading ? (
          <div className="font-mono text-ink-2 text-[13px]">Wird geladen …</div>
        ) : items.length === 0 ? (
          <div className="bg-bg-2 border border-steel-line/45 rounded-xl px-6 py-10 text-center">
            <p className="font-display font-bold uppercase text-[16px] text-ink mb-2">
              {showAll ? "Noch keine Anfragen erfasst" : "Keine offenen Anfragen"}
            </p>
            <p className="font-sans text-[13px] text-ink-2 mb-4">
              Eine neue Kunden-Anfrage per Mail/Telefon/WhatsApp? Hier reinpasten, App strukturiert + legt eine Pipeline-Karte an.
            </p>
            <Link to="/admin/anfrage-neu" className="btn-primary !min-h-[44px] text-[12px] inline-flex items-center">
              ＋ Anfrage anlegen
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((i) => {
              const meta = STATUS_META[i.status];
              return (
                <li key={i.id} className="bg-white border border-steel-line/45 rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className="font-mono text-[10px] uppercase font-bold px-2 py-0.5 rounded-full"
                        style={{ background: meta.color, color: "#fff" }}
                      >
                        {meta.label}
                      </span>
                      <span className="font-mono text-[10.5px] text-ink-2">
                        {fmtDate(i.createdAt)} · {SOURCE_LABEL[i.source] ?? i.source}
                      </span>
                    </div>
                    <div className="font-sans font-bold text-[14px] text-ink truncate">
                      {i.customerName || <span className="text-ink-2 italic">ohne Namen</span>}
                    </div>
                    {i.description && (
                      <div className="font-sans text-[12.5px] text-ink-2 line-clamp-2">{i.description}</div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap md:flex-nowrap">
                    {i.status === "offen" && (
                      <button
                        onClick={() => setStatus(i.id, "in_arbeit")}
                        className="btn-ghost !min-h-[36px] !px-3 text-[11px]"
                      >
                        in Arbeit
                      </button>
                    )}
                    {i.status !== "verworfen" && i.status !== "wurde_zu_angebot" && (
                      <button
                        onClick={() => setStatus(i.id, "verworfen")}
                        className="btn-ghost !min-h-[36px] !px-3 text-[11px]"
                      >
                        verwerfen
                      </button>
                    )}
                    <button
                      onClick={() => remove(i.id)}
                      className="btn-ghost !min-h-[36px] !px-3 text-[11px] text-rust"
                      title="Anfrage löschen"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
