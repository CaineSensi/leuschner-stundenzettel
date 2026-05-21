import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  listInquiries, updateInquiry, deleteInquiry, appendNote,
  type Inquiry, type InquiryStatus, type InquirySource, type InquiryPriority
} from "../lib/inquiries";
import { llmStructure, VORGANG_LABEL, VORGANG_COLOR, type Vorgang } from "../lib/llm";
import BackButton from "../components/BackButton";
import { isBackendConnected } from "../lib/supabase";

/* ────────────────────────────────────────────────────────────────────────
   Anfragen-Inbox · die zentrale Eingangsbox.
   Liste links (oder allein auf Mobile), Drawer rechts mit Volldetail.
   Such-/Filter-/Sortier-State in URL (?q=…&status=…&source=…&sort=…).
   ──────────────────────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<InquirySource, string> = {
  mail: "Mail", phone: "Telefon", whatsapp: "WhatsApp",
  letter: "Brief", in_person: "persönlich", web: "Web", other: "andere"
};

const STATUS_META: Record<InquiryStatus, { label: string; color: string }> = {
  offen:            { label: "offen",            color: "#DC6E2D" },
  in_arbeit:        { label: "in Arbeit",        color: "#C9852F" },
  wurde_zu_angebot: { label: "→ Angebot",        color: "#1F7A3D" },
  verworfen:        { label: "verworfen",        color: "#6A6E72" }
};

const PRIORITY_META: Record<InquiryPriority, { label: string; color: string; rank: number }> = {
  hoch:    { label: "hoch",    color: "#B91C1C", rank: 0 },
  normal:  { label: "normal",  color: "#6A6E72", rank: 1 },
  niedrig: { label: "niedrig", color: "#9CA3AF", rank: 2 },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const tDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((tDay.getTime() - dDay.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `heute ${time}`;
  if (diffDays === 1) return `gestern ${time}`;
  if (diffDays < 7)   return `vor ${diffDays} Tg · ${time}`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtFullDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

export default function Anfragen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Inquiry | null>(null);

  const q          = params.get("q") ?? "";
  const fStatus    = params.get("status") ?? "open";  // open = offen+in_arbeit (default)
  const fSource    = params.get("source") ?? "";
  const fPriority  = params.get("priority") ?? "";
  const fVorgang   = params.get("vorgang") ?? "";
  const sort       = params.get("sort") ?? "neu";

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (!v || v === "neu" || (k === "status" && v === "open")) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  }

  async function refresh() {
    setError(null);
    try {
      // Wir holen großzügig — Filter laufen im Client (Skala bleibt klein)
      setItems(await listInquiries({ onlyOpen: false }));
    } catch (e: any) { setError(e?.message ?? "Fehler beim Laden"); }
    finally { setLoading(false); }
  }
  useEffect(() => { setLoading(true); refresh(); }, []);

  // Wenn ein Drawer offen ist und das Item sich ändert: aktualisiere die Item-Referenz
  useEffect(() => {
    if (!detail) return;
    const fresh = items.find((i) => i.id === detail.id);
    if (fresh) setDetail(fresh);
  }, [items, detail?.id]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = items;
    if (fStatus === "open")       arr = arr.filter((i) => i.status === "offen" || i.status === "in_arbeit");
    else if (fStatus && fStatus !== "all") arr = arr.filter((i) => i.status === fStatus);
    if (fSource)   arr = arr.filter((i) => i.source === fSource);
    if (fPriority) arr = arr.filter((i) => i.priority === fPriority);
    if (fVorgang)  arr = arr.filter((i) => i.parsedJson?.vorgang === fVorgang);
    if (needle) {
      arr = arr.filter((i) =>
        (i.customerName ?? "").toLowerCase().includes(needle) ||
        (i.customerEmail ?? "").toLowerCase().includes(needle) ||
        (i.customerPhone ?? "").toLowerCase().includes(needle) ||
        (i.description ?? "").toLowerCase().includes(needle) ||
        (i.rawText ?? "").toLowerCase().includes(needle) ||
        (i.city ?? "").toLowerCase().includes(needle)
      );
    }
    arr = [...arr];
    if (sort === "alt") arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else if (sort === "prio") arr.sort((a, b) => PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank);
    else arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return arr;
  }, [items, q, fStatus, fSource, fPriority, fVorgang, sort]);

  const counts = useMemo(() => {
    const c = { offen: 0, in_arbeit: 0, wurde_zu_angebot: 0, verworfen: 0 };
    items.forEach((i) => { c[i.status]++; });
    return c;
  }, [items]);

  // Keyboard: N = neue Anfrage, Esc = Drawer schließen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && detail) { setDetail(null); return; }
      if (e.key === "n" || e.key === "N") {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        navigate("/admin/anfrage-neu");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, navigate]);

  async function setStatus(i: Inquiry, status: InquiryStatus) {
    setItems((prev) => prev.map((x) => x.id === i.id ? { ...x, status } : x));
    try {
      await updateInquiry(i.id, { status });
      await appendNote(i.id, { kind: "status", text: `Status → ${STATUS_META[status].label}` });
      refresh();
    } catch (e: any) { setError(e?.message); refresh(); }
  }
  async function setPriority(i: Inquiry, priority: InquiryPriority) {
    setItems((prev) => prev.map((x) => x.id === i.id ? { ...x, priority } : x));
    try {
      await updateInquiry(i.id, { priority });
      await appendNote(i.id, { kind: "system", text: `Priorität → ${PRIORITY_META[priority].label}` });
      refresh();
    } catch (e: any) { setError(e?.message); refresh(); }
  }
  async function remove(i: Inquiry) {
    if (!confirm(`Anfrage von „${i.customerName ?? "unbekannt"}" wirklich löschen?`)) return;
    setItems((prev) => prev.filter((x) => x.id !== i.id));
    setDetail(null);
    try { await deleteInquiry(i.id); }
    catch (e: any) { setError(e?.message); refresh(); }
  }

  return (
    <div className="min-h-screen flex flex-col safe-top">
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Vertrieb · Inbox</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
              Anfragen
            </h1>
            <span className={`font-mono text-[11.5px] mt-1.5 block tracking-wide ${isBackendConnected() ? "text-moss-bright" : "text-steel"}`}>
              {isBackendConnected()
                ? `● ${counts.offen + counts.in_arbeit} offen · ${counts.wurde_zu_angebot} zu Angebot · ${counts.verworfen} verworfen`
                : "○ Demo-Modus"}
            </span>
          </div>
          <Link
            to="/admin/anfrage-neu"
            className="btn-primary !min-h-[44px] text-[12px] whitespace-nowrap flex items-center"
          >
            ＋ Neue Anfrage <kbd className="ml-2 px-1.5 py-0.5 bg-white/10 text-[10px] font-mono rounded">N</kbd>
          </Link>
        </div>

        {/* Filter-Leiste */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-white/[0.08] border-[1.5px] border-white/20 rounded-lg px-3 py-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" className="text-steel flex-shrink-0">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={q}
              onChange={(e) => setParam("q", e.target.value)}
              placeholder="Name · Mail · Telefon · Ort · Text …"
              className="flex-1 bg-transparent border-0 text-[13px] text-white placeholder:text-steel focus:outline-none"
            />
            {q && (
              <button onClick={() => setParam("q", "")} className="text-steel hover:text-white text-[14px]">×</button>
            )}
          </div>
          <FilterSelect
            value={fStatus} onChange={(v) => setParam("status", v)}
            options={[
              { value: "open",             label: "offen / Arbeit" },
              { value: "all",              label: "alle" },
              { value: "wurde_zu_angebot", label: "→ Angebot" },
              { value: "verworfen",        label: "verworfen" }
            ]}
          />
          <FilterSelect
            value={fVorgang} onChange={(v) => setParam("vorgang", v)}
            options={[
              { value: "",            label: "alle Vorgänge" },
              { value: "angebot",     label: "Angebotsanfrage" },
              { value: "termin",      label: "Termin / Rückruf" },
              { value: "reklamation", label: "Reklamation" },
              { value: "material",    label: "Materialbestellung" },
              { value: "sonstiges",   label: "Sonstiges" }
            ]}
          />
          <FilterSelect
            value={fSource} onChange={(v) => setParam("source", v)}
            options={[
              { value: "",          label: "alle Quellen" },
              ...Object.entries(SOURCE_LABEL).map(([v, l]) => ({ value: v, label: l }))
            ]}
          />
          <FilterSelect
            value={fPriority} onChange={(v) => setParam("priority", v)}
            options={[
              { value: "",        label: "alle Prio" },
              { value: "hoch",    label: "hoch" },
              { value: "normal",  label: "normal" },
              { value: "niedrig", label: "niedrig" }
            ]}
          />
          <FilterSelect
            value={sort} onChange={(v) => setParam("sort", v)}
            options={[
              { value: "neu",  label: "Neueste zuerst" },
              { value: "alt",  label: "Älteste zuerst" },
              { value: "prio", label: "Priorität" }
            ]}
          />
        </div>
      </header>

      {error && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust font-sans">
          {error}
        </div>
      )}

      <main className="flex-1 px-4 lg:px-8 py-5 max-w-[1380px] w-full mx-auto">
        {loading ? (
          <div className="font-mono text-ink-2 text-[13px]">Wird geladen …</div>
        ) : filtered.length === 0 ? (
          <EmptyState hasItems={items.length > 0} />
        ) : (
          <ul className="space-y-2">
            {filtered.map((i) => (
              <InquiryRow
                key={i.id}
                inquiry={i}
                active={detail?.id === i.id}
                onOpen={() => setDetail(i)}
              />
            ))}
          </ul>
        )}
      </main>

      {detail && (
        <InquiryDrawer
          inquiry={detail}
          onClose={() => setDetail(null)}
          onSetStatus={(s) => setStatus(detail, s)}
          onSetPriority={(p) => setPriority(detail, p)}
          onChange={() => refresh()}
          onDelete={() => remove(detail)}
        />
      )}
    </div>
  );
}

/* ── Komponenten ────────────────────────────────────────────────────────── */

function FilterSelect({
  value, onChange, options
}: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/[0.08] border-[1.5px] border-white/20 rounded-lg px-3 py-2 text-[12px] text-white font-sans focus:outline-none focus:border-copper-bright"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-bg-deep text-white">{o.label}</option>
      ))}
    </select>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="bg-bg-2 border border-steel-line/45 rounded-xl px-6 py-12 text-center max-w-[640px] mx-auto">
      <p className="font-display font-bold uppercase text-[16px] text-ink mb-2">
        {hasItems ? "Keine Treffer mit diesen Filtern" : "Inbox leer · noch keine Anfrage erfasst"}
      </p>
      <p className="font-sans text-[13px] text-ink-2 mb-5 max-w-[420px] mx-auto">
        Wenn eine Kunden-Anfrage reinkommt (Mail, WhatsApp, Telefon, Brief, persönlich),
        hier reinpasten — App strukturiert, ordnet den Kunden zu und legt eine Pipeline-Karte an.
      </p>
      <Link to="/admin/anfrage-neu" className="btn-primary !min-h-[44px] text-[12px] inline-flex items-center">
        ＋ Anfrage anlegen
      </Link>
    </div>
  );
}

function InquiryRow({
  inquiry: i, active, onOpen
}: {
  inquiry: Inquiry; active: boolean; onOpen: () => void;
}) {
  const sMeta = STATUS_META[i.status];
  const pMeta = PRIORITY_META[i.priority];
  const vorgang = (i.parsedJson?.vorgang as Vorgang | undefined);
  return (
    <li
      onClick={onOpen}
      className={`bg-white border rounded-lg px-4 py-3 cursor-pointer transition-colors ${
        active ? "border-copper shadow-sm" : "border-steel-line/45 hover:border-copper/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-1 self-stretch rounded-sm flex-shrink-0"
          style={{ background: pMeta.color }}
          title={`Priorität ${pMeta.label}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-[9.5px] uppercase font-bold px-2 py-0.5 rounded-full" style={{ background: sMeta.color, color: "#fff" }}>
              {sMeta.label}
            </span>
            {vorgang && (
              <span
                className="font-mono text-[9.5px] uppercase font-bold px-2 py-0.5 rounded-full"
                style={{ background: VORGANG_COLOR[vorgang] + "22", color: VORGANG_COLOR[vorgang], border: `1px solid ${VORGANG_COLOR[vorgang]}55` }}
                title={`Vorgangstyp: ${VORGANG_LABEL[vorgang]}`}
              >
                {VORGANG_LABEL[vorgang]}
              </span>
            )}
            <span className="font-mono text-[10.5px] text-ink-2">
              {fmtDate(i.createdAt)} · {SOURCE_LABEL[i.source] ?? i.source}
            </span>
            {i.notesLog.length > 1 && (
              <span className="font-mono text-[10.5px] text-ink-2">
                · {i.notesLog.length - 1} Eintr{i.notesLog.length === 2 ? "ag" : "äge"}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <div className="font-sans font-bold text-[14.5px] text-ink truncate">
              {i.customerName || <span className="text-ink-2 italic">ohne Namen</span>}
            </div>
            {i.city && <span className="font-sans text-[12px] text-ink-2">{i.city}</span>}
            {i.customerPhone && <span className="font-mono text-[11px] text-ink-2">{i.customerPhone}</span>}
          </div>
          {i.description && (
            <div className="font-sans text-[12.5px] text-ink-2 line-clamp-2 mt-0.5">{i.description}</div>
          )}
        </div>
      </div>
    </li>
  );
}

function InquiryDrawer({
  inquiry, onClose, onSetStatus, onSetPriority, onChange, onDelete
}: {
  inquiry: Inquiry;
  onClose: () => void;
  onSetStatus: (s: InquiryStatus) => void;
  onSetPriority: (p: InquiryPriority) => void;
  onChange: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({
    customerName: inquiry.customerName ?? "",
    customerPhone: inquiry.customerPhone ?? "",
    customerEmail: inquiry.customerEmail ?? "",
    street: inquiry.street ?? "",
    zip: inquiry.zip ?? "",
    city: inquiry.city ?? "",
    description: inquiry.description ?? "",
    notes: inquiry.notes ?? "",
  });
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [showRaw, setShowRaw] = useState(true);

  useEffect(() => {
    setEdit({
      customerName: inquiry.customerName ?? "",
      customerPhone: inquiry.customerPhone ?? "",
      customerEmail: inquiry.customerEmail ?? "",
      street: inquiry.street ?? "",
      zip: inquiry.zip ?? "",
      city: inquiry.city ?? "",
      description: inquiry.description ?? "",
      notes: inquiry.notes ?? "",
    });
    setEditing(false);
  }, [inquiry.id]);

  async function saveEdit() {
    setBusy(true);
    try {
      await updateInquiry(inquiry.id, edit);
      await appendNote(inquiry.id, { kind: "system", text: "Stammdaten aktualisiert" });
      setEditing(false);
      onChange();
    } finally { setBusy(false); }
  }
  async function doAppendNote() {
    if (!newNote.trim()) return;
    setBusy(true);
    try {
      await appendNote(inquiry.id, { kind: "note", text: newNote.trim() });
      setNewNote("");
      onChange();
    } finally { setBusy(false); }
  }
  async function reparse() {
    setReparsing(true);
    try {
      const p = await llmStructure(inquiry.rawText);
      const merged = {
        customerName: edit.customerName || p.customerName || "",
        customerPhone: edit.customerPhone || p.phone || "",
        customerEmail: edit.customerEmail || p.email || "",
        street: edit.street || p.street || "",
        zip: edit.zip || p.zip || "",
        city: edit.city || p.city || "",
        description: edit.description || p.description || "",
      };
      setEdit({ ...edit, ...merged });
      await updateInquiry(inquiry.id, { ...merged, parsedJson: p });
      await appendNote(inquiry.id, { kind: "parse", text: `Re-Parse via ${p.parser}` });
      onChange();
    } finally { setReparsing(false); }
  }
  async function goToAngebot() {
    if (!inquiry.pipelineCardId) {
      alert("Diese Anfrage hat noch keine Pipeline-Karte.");
      return;
    }
    navigate(`/admin/angebot-neu/${inquiry.pipelineCardId}`);
  }

  const phoneClean = (inquiry.customerPhone ?? "").replace(/[^\d+]/g, "");
  const mapsLink = inquiry.street || inquiry.city
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([inquiry.street, inquiry.zip, inquiry.city].filter(Boolean).join(", "))}`
    : null;

  return (
    <>
      <div className="dd-scrim on" onClick={onClose} />
      <aside className="dd-drawer on" role="dialog" aria-modal="true" aria-label="Anfrage-Detail">
        <div className="surface-steel px-5 lg:px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase font-bold px-2 py-1 rounded" style={{ background: STATUS_META[inquiry.status].color, color: "#fff" }}>
                {STATUS_META[inquiry.status].label}
              </span>
              <span className="font-mono text-[10px] text-steel uppercase">{SOURCE_LABEL[inquiry.source]}</span>
              <span className="font-mono text-[10px] text-steel">{fmtFullDate(inquiry.createdAt)}</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="bg-white/10 border border-white/20 text-white w-9 h-9 rounded-md grid place-items-center hover:bg-white/20 text-[17px]"
            >✕</button>
          </div>
          <div className="font-display font-black uppercase text-[24px] lg:text-[28px] text-white mt-3 leading-tight">
            {inquiry.customerName || <span className="italic text-steel">ohne Namen</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            {inquiry.customerPhone && (
              <a href={`tel:${phoneClean}`} className="font-sans text-[13px] text-white hover:text-copper-bright underline-offset-2 hover:underline">
                ☏ {inquiry.customerPhone}
              </a>
            )}
            {inquiry.customerEmail && (
              <a href={`mailto:${inquiry.customerEmail}`} className="font-sans text-[13px] text-white hover:text-copper-bright underline-offset-2 hover:underline">
                ✉ {inquiry.customerEmail}
              </a>
            )}
            {mapsLink && (
              <a href={mapsLink} target="_blank" rel="noopener" className="font-sans text-[13px] text-white hover:text-copper-bright underline-offset-2 hover:underline">
                ⌖ {[inquiry.street, inquiry.zip, inquiry.city].filter(Boolean).join(", ")}
              </a>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-5 board-scroll space-y-5">

          {/* Stammdaten · editierbar */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display font-extrabold uppercase text-[12.5px] tracking-widest text-ink">Stammdaten</div>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="font-mono text-[11px] text-copper hover:text-copper-bright">
                  bearbeiten
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="font-mono text-[11px] text-ink-2 hover:text-ink">
                    abbrechen
                  </button>
                  <button onClick={saveEdit} disabled={busy} className="font-mono text-[11px] text-copper hover:text-copper-bright">
                    {busy ? "speichere …" : "speichern"}
                  </button>
                </div>
              )}
            </div>
            {!editing ? (
              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12.5px] font-sans">
                <Dt>Name</Dt><Dd>{inquiry.customerName || "—"}</Dd>
                <Dt>Telefon</Dt><Dd>{inquiry.customerPhone || "—"}</Dd>
                <Dt>E-Mail</Dt><Dd>{inquiry.customerEmail || "—"}</Dd>
                <Dt>Straße</Dt><Dd>{inquiry.street || "—"}</Dd>
                <Dt>PLZ · Ort</Dt><Dd>{[inquiry.zip, inquiry.city].filter(Boolean).join(" ") || "—"}</Dd>
                <Dt>Beschreibung</Dt><Dd>{inquiry.description || "—"}</Dd>
                <Dt>Notizen</Dt><Dd>{inquiry.notes || "—"}</Dd>
              </dl>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <DField label="Name" value={edit.customerName} onChange={(v) => setEdit({ ...edit, customerName: v })} span={2} />
                <DField label="Telefon" value={edit.customerPhone} onChange={(v) => setEdit({ ...edit, customerPhone: v })} />
                <DField label="E-Mail" value={edit.customerEmail} onChange={(v) => setEdit({ ...edit, customerEmail: v })} />
                <DField label="Straße" value={edit.street} onChange={(v) => setEdit({ ...edit, street: v })} span={2} />
                <DField label="PLZ" value={edit.zip} onChange={(v) => setEdit({ ...edit, zip: v })} />
                <DField label="Ort" value={edit.city} onChange={(v) => setEdit({ ...edit, city: v })} />
                <DField label="Beschreibung" value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} span={2} textarea />
                <DField label="Notizen" value={edit.notes} onChange={(v) => setEdit({ ...edit, notes: v })} span={2} />
              </div>
            )}
          </section>

          {/* Rohtext · einklappbar */}
          <section>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center justify-between w-full font-display font-extrabold uppercase text-[12.5px] tracking-widest text-ink mb-2"
            >
              <span>Originaltext</span>
              <span className="font-mono text-[10px] text-ink-2">{showRaw ? "▾ einklappen" : "▸ aufklappen"} · {inquiry.rawText.length} Zeichen</span>
            </button>
            {showRaw && (
              <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-3.5">
                <pre className="font-mono text-[11.5px] text-ink whitespace-pre-wrap leading-relaxed max-h-[280px] overflow-auto">
                  {inquiry.rawText}
                </pre>
                <div className="mt-2.5 flex justify-end">
                  <button
                    onClick={reparse}
                    disabled={reparsing}
                    className="font-mono text-[11px] text-copper hover:text-copper-bright"
                  >
                    {reparsing ? "parse …" : "↻ erneut strukturieren"}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Verlauf */}
          <section>
            <div className="font-display font-extrabold uppercase text-[12.5px] tracking-widest text-ink mb-2">
              Verlauf · {inquiry.notesLog.length} Eintr{inquiry.notesLog.length === 1 ? "ag" : "äge"}
            </div>
            <ul className="space-y-1.5 mb-3">
              {[...inquiry.notesLog].reverse().map((n, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[12px] font-sans">
                  <span className={`font-mono text-[9.5px] uppercase px-1.5 py-0.5 rounded-full ${
                    n.kind === "note"   ? "bg-copper/15 text-copper" :
                    n.kind === "status" ? "bg-moss/15 text-good" :
                    n.kind === "parse"  ? "bg-bronze/15 text-bronze" :
                                          "bg-ink/10 text-ink-2"
                  }`}>{n.kind}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-ink">{n.text}</span>
                    <span className="font-mono text-[10px] text-ink-2 ml-2">{fmtFullDate(n.at)}{n.by ? ` · ${n.by}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAppendNote(); } }}
                placeholder="Notiz hinzufügen (Enter speichert)"
                className="flex-1 bg-white border-[1.5px] border-steel-line/45 rounded-lg px-3 py-2 text-[12.5px] font-sans focus:outline-none focus:border-copper"
              />
              <button onClick={doAppendNote} disabled={busy || !newNote.trim()} className="btn-ghost !min-h-[38px] !px-3 text-[11.5px] disabled:opacity-40">
                + Notiz
              </button>
            </div>
          </section>

          {/* Priorität */}
          <section>
            <div className="font-display font-extrabold uppercase text-[12.5px] tracking-widest text-ink mb-2">Priorität</div>
            <div className="flex gap-2">
              {(["niedrig","normal","hoch"] as InquiryPriority[]).map((p) => (
                <button
                  key={p}
                  onClick={() => onSetPriority(p)}
                  className={`px-3.5 py-2 rounded-md text-[12px] font-display font-extrabold uppercase tracking-wide border-[1.5px] ${
                    inquiry.priority === p
                      ? "text-white border-transparent"
                      : "bg-white text-ink border-steel-line/45 hover:border-copper/60"
                  }`}
                  style={inquiry.priority === p ? { background: PRIORITY_META[p].color, borderColor: PRIORITY_META[p].color } : undefined}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </section>

          {/* Verknüpfung Pipeline */}
          {inquiry.pipelineCardId && (
            <section>
              <div className="font-display font-extrabold uppercase text-[12.5px] tracking-widest text-ink mb-2">Pipeline-Karte</div>
              <Link
                to="/admin/angebote"
                className="font-mono text-[11.5px] text-copper hover:text-copper-bright"
              >
                ◇ im Kanban öffnen →
              </Link>
            </section>
          )}
        </div>

        <div className="flex-shrink-0 px-5 lg:px-6 py-3.5 bg-[#E2E4E7] border-t border-steel flex flex-wrap gap-2">
          {/* Status-Buttons */}
          {inquiry.status !== "in_arbeit" && inquiry.status !== "wurde_zu_angebot" && (
            <button onClick={() => onSetStatus("in_arbeit")} className="btn-ghost !min-h-[44px] !px-3 text-[11.5px]">
              in Arbeit
            </button>
          )}
          {inquiry.status !== "verworfen" && (
            <button onClick={() => onSetStatus("verworfen")} className="btn-ghost !min-h-[44px] !px-3 text-[11.5px]">
              verwerfen
            </button>
          )}
          <button onClick={onDelete} className="btn-ghost !min-h-[44px] !px-3 text-[11.5px] !text-rust !border-rust/40">
            Löschen
          </button>
          {inquiry.pipelineCardId && inquiry.status !== "wurde_zu_angebot" && (
            <button onClick={goToAngebot} className="btn-primary flex-1 !min-h-[44px] text-[12px] min-w-[180px]">
              → Angebot draus machen
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="font-mono text-[10.5px] uppercase tracking-wider text-ink-2 self-start mt-0.5">{children}</dt>;
}
function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="text-ink">{children}</dd>;
}
function DField({
  label, value, onChange, span, textarea
}: {
  label: string; value: string; onChange: (v: string) => void; span?: 1 | 2; textarea?: boolean;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <label className="dd-eyebrow text-ink-2 block mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-h-[60px] bg-white border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[12.5px] font-sans focus:outline-none focus:border-copper resize-y"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white border-[1.5px] border-steel-line/45 rounded-md px-2.5 py-1.5 text-[12.5px] font-sans focus:outline-none focus:border-copper"
        />
      )}
    </div>
  );
}
