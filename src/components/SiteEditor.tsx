import { useState } from "react";
import type { SiteInput } from "../lib/api";
import type { Site } from "../lib/types";

type SiteRow = Site & { archived?: boolean };

export default function SiteEditor({
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
          setTimeout(() => reject(new Error("Zeitüberschreitung, Server antwortet nicht")), 8000)
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
    <div className="fixed inset-0 z-[1200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-DEFAULT rounded-2xl border-2 border-ink/30 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 my-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="h-display text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="text-ink-2 hover:text-paper text-2xl leading-none px-2">×</button>
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
              className="site-input"
            />
          </Field>
          <Field label="Auftragsnummer">
            <input
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value)}
              placeholder="z. B. 2026-042"
              className="site-input font-mono"
            />
          </Field>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Field label="Straße">
              <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Wilhelmstr. 12" className="site-input" />
            </Field>
            <Field label="Ort / PLZ">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="26789 Leer" className="site-input" />
            </Field>
          </div>

          <details className="bg-bg-2 rounded-xl">
            <summary className="px-4 py-2.5 cursor-pointer h-mono text-copper text-[11px]">GPS-Koordinaten (optional)</summary>
            <div className="px-4 pb-3 pt-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Lat">
                  <input value={geoLat} onChange={(e) => setGeoLat(e.target.value)} placeholder="53.2306" className="site-input font-mono" />
                </Field>
                <Field label="Lng">
                  <input value={geoLng} onChange={(e) => setGeoLng(e.target.value)} placeholder="7.4577" className="site-input font-mono" />
                </Field>
              </div>
              <p className="h-mono text-ink-mute text-[10px]">
                Optional, wird später für GPS-Verifizierung der Mitarbeiter-Einträge genutzt
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
        .site-input {
          width: 100%;
          background: #FFFFFF;
          border: 1px solid #A9AEB3;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 14px;
          color: #1A1C1E;
          outline: none;
        }
        .site-input:focus { border-color: #DC6E2D; }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="h-mono text-copper text-[11px] block mb-1">
        {label}{required && <span className="text-rust ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
