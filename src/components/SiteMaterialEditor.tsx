import { useState } from "react";
import type { SiteMaterialInput } from "../lib/api";
import type { MaterialStatus, SiteMaterial } from "../lib/types";

const STATUS_OPTIONS: { value: MaterialStatus; label: string }[] = [
  { value: "planned",   label: "Geplant" },
  { value: "ordered",   label: "Bestellt" },
  { value: "delivered", label: "Geliefert" },
  { value: "installed", label: "Eingebaut" },
  { value: "returned",  label: "Zurückgegeben" }
];

const UNIT_OPTIONS = ["Stk", "m²", "m³", "m", "t", "kg", "l", "Sack", "Palette", "pauschal"];

export default function SiteMaterialEditor({
  initial, onClose, onSave, onDelete
}: {
  initial?: SiteMaterial;
  onClose: () => void;
  onSave: (input: SiteMaterialInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [quantity, setQuantity] = useState<string>(initial?.quantity?.toString().replace(".", ",") ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "Stk");
  const [status, setStatus] = useState<MaterialStatus>(initial?.status ?? "planned");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [orderedAt, setOrderedAt] = useState(initial?.orderedAt ?? "");
  const [deliveredAt, setDeliveredAt] = useState(initial?.deliveredAt ?? "");
  const [priceEur, setPriceEur] = useState<string>(initial?.priceEur?.toString().replace(".", ",") ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        quantity: quantity ? Number(quantity.replace(",", ".")) : undefined,
        unit: unit.trim() || undefined,
        status,
        supplier: supplier.trim() || undefined,
        orderedAt: orderedAt || undefined,
        deliveredAt: deliveredAt || undefined,
        priceEur: priceEur ? Number(priceEur.replace(",", ".")) : undefined,
        notes: notes.trim() || undefined
      });
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirm(`„${name}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (e: any) {
      setErr(e?.message ?? "Löschen fehlgeschlagen");
    } finally {
      setDeleting(false);
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
          <h2 className="h-display text-2xl">{initial ? "Material bearbeiten" : "Material hinzufügen"}</h2>
          <button type="button" onClick={onClose} className="text-ink-2 hover:text-paper text-2xl leading-none px-2">×</button>
        </div>

        {err && (
          <div className="mb-3 px-3 py-2 bg-rust/10 border border-rust/35 rounded-lg text-[12px] text-rust">{err}</div>
        )}

        <div className="space-y-3">
          <Field label="Bezeichnung" required>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. H-Steine Haco VI 10 cm grau"
              className="mat-input"
            />
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Menge">
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="z. B. 113,30" className="mat-input font-mono" inputMode="decimal" />
            </Field>
            <Field label="Einheit">
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="mat-input">
                {UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Status">
            <div className="flex gap-1.5 flex-wrap">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-bold border ${
                    status === opt.value
                      ? "bg-copper text-bg-DEFAULT border-copper"
                      : "bg-bg-2 text-paper border-ink/15 hover:border-copper hover:text-copper"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Lieferant">
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="z. B. Baustoffhandel Hartwig" className="mat-input" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bestellt am">
              <input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} className="mat-input" />
            </Field>
            <Field label="Geliefert am">
              <input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} className="mat-input" />
            </Field>
          </div>
          <Field label="Preis netto (EUR, Einzelpreis)">
            <input value={priceEur} onChange={(e) => setPriceEur(e.target.value)} placeholder="z. B. 15,10" className="mat-input font-mono" inputMode="decimal" />
          </Field>
          <Field label="Notiz">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional: Hinweise, Bestellnr, Charge …" className="mat-input resize-y" />
          </Field>
        </div>

        <div className="flex gap-2 mt-5">
          {initial && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="btn-ghost text-[12px] text-rust border-rust/30 hover:bg-rust/10 disabled:opacity-50"
            >
              {deleting ? "…" : "Löschen"}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-ghost flex-1 text-[12px]">Abbrechen</button>
          <button type="submit" disabled={!name.trim() || saving} className="btn-primary flex-1 text-[12px] disabled:opacity-50">
            {saving ? "Speichert …" : initial ? "Speichern" : "Hinzufügen"}
          </button>
        </div>

        <style>{`
          .mat-input {
            width: 100%;
            background: var(--bg-2, #F4F4F5);
            border: 2px solid rgba(0,0,0,0.15);
            border-radius: 10px;
            padding: 10px 12px;
            font-size: 14px;
            color: #000;
            outline: none;
          }
          .mat-input:focus { border-color: #DC6E2D; }
        `}</style>
      </form>
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
