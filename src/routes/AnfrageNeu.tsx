import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { llmStructure, type ParsedInquiry } from "../lib/llm";
import {
  listCustomers, matchCustomers, createCustomerLocal,
  type Customer, type CustomerMatch
} from "../lib/customers";
import { sevdeskCreateContact } from "../lib/sevdesk";
import { createInquiry, updateInquiry, type InquirySource } from "../lib/inquiries";
import { createCard } from "../lib/pipeline";
import { isBackendConnected } from "../lib/supabase";

/* ────────────────────────────────────────────────────────────────────────
   Anfrage anlegen · 3 Schritte
   1) Rohtext rein + Quelle wählen → „Strukturieren"
   2) Felder editieren + Kunde matchen / anlegen
   3) Speichern: legt inquiry + pipeline_card (Stage „Anfrage") an
   ──────────────────────────────────────────────────────────────────────── */

const SOURCES: { value: InquirySource; label: string }[] = [
  { value: "mail",      label: "E-Mail" },
  { value: "phone",     label: "Telefon" },
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "letter",    label: "Brief / Fax" },
  { value: "in_person", label: "persönlich" },
  { value: "web",       label: "Web-Formular" },
  { value: "other",     label: "andere" }
];

type Step = "paste" | "edit";

export default function AnfrageNeu() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("paste");
  const [source, setSource] = useState<InquirySource>("mail");
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedInquiry | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editier-Felder
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  // Kunden-Match
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [chosenCustomerId, setChosenCustomerId] = useState<string | null>(null);
  const [createSevdesk, setCreateSevdesk] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isBackendConnected()) return;
    listCustomers().then(setAllCustomers).catch(() => {});
  }, []);

  const matches: CustomerMatch[] = useMemo(() => {
    if (!customerName && !email && !phone) return [];
    return matchCustomers(allCustomers, { name: customerName, email, phone });
  }, [allCustomers, customerName, email, phone]);

  async function doParse() {
    if (!rawText.trim()) {
      setError("Bitte erst Text einfügen.");
      return;
    }
    setError(null);
    setParsing(true);
    try {
      const p = await llmStructure(rawText);
      setParsed(p);
      setCustomerName(p.customerName ?? "");
      setPhone(p.phone ?? "");
      setEmail(p.email ?? "");
      setStreet(p.street ?? "");
      setZip(p.zip ?? "");
      setCity(p.city ?? "");
      setDescription(p.description ?? "");
      if (p.source_guess) setSource(p.source_guess);
      setStep("edit");
    } catch (e: any) {
      setError(e?.message ?? "Parse-Fehler");
    } finally {
      setParsing(false);
    }
  }

  function skipParse() {
    setParsed({ parser: "heuristic" });
    setStep("edit");
  }

  async function doSave() {
    if (!customerName.trim()) {
      setError("Kundenname fehlt.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // 1) Kunde — bestehend wählen oder neu anlegen
      let customerId = chosenCustomerId ?? undefined;
      if (!customerId) {
        let sevdeskContactId: string | undefined;
        let customerNumber: string | undefined;
        if (createSevdesk) {
          try {
            const isCompany = /gmbh|gbr|e\.k\.|ag\b|kg\b|ohg|ug\b/i.test(customerName);
            const parts = customerName.trim().split(/\s+/);
            const sev = await sevdeskCreateContact({
              isCompany,
              name: isCompany ? customerName : undefined,
              surename: !isCompany ? parts[0] : undefined,
              familyname: !isCompany ? parts.slice(1).join(" ") || undefined : undefined,
              email: email || undefined,
              phone: phone || undefined,
              street: street || undefined,
              zip: zip || undefined,
              city: city || undefined,
            });
            sevdeskContactId = sev.id;
            customerNumber = sev.customerNumber;
          } catch (sevErr: any) {
            console.warn("sevDesk-Anlage fehlgeschlagen, Kunde wird nur lokal angelegt:", sevErr?.message);
          }
        }
        const isCompany = /gmbh|gbr|e\.k\.|ag\b|kg\b|ohg|ug\b/i.test(customerName);
        const parts = customerName.trim().split(/\s+/);
        const newCust = await createCustomerLocal({
          sevdeskContactId, customerNumber,
          name: customerName,
          isCompany,
          surename: !isCompany ? parts[0] : undefined,
          familyname: !isCompany ? parts.slice(1).join(" ") || undefined : undefined,
          email: email || undefined,
          phone: phone || undefined,
          street: street || undefined, zip: zip || undefined, city: city || undefined,
        });
        customerId = newCust.id;
      }

      // 2) Pipeline-Karte in Stage Anfrage
      const place = [zip, city].filter(Boolean).join(" ").trim() || street || undefined;
      const card = await createCard({
        stage: "Anfrage",
        customerName,
        place,
        description: description || undefined,
        openPoints: notes || undefined,
      });

      // 3) Inquiry-Row
      const inq = await createInquiry({
        source,
        rawText,
        parsedJson: parsed,
        customerName, customerPhone: phone, customerEmail: email,
        street, zip, city, description, notes,
        customerId,
      });
      await updateInquiry(inq.id, { pipelineCardId: card.id, status: "in_arbeit" });

      navigate("/admin/angebote");
    } catch (e: any) {
      setError(e?.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
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
        <span className="dd-eyebrow text-copper-bright block">Vertrieb · Eingangsbearbeitung</span>
        <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
          Neue Anfrage
        </h1>
        <span className="font-mono text-[11.5px] mt-1.5 block tracking-wide text-steel">
          {step === "paste"
            ? "Schritt 1 von 2 · Rohtext einfügen"
            : "Schritt 2 von 2 · Felder prüfen, Kunde zuordnen"}
        </span>
      </header>

      {error && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust font-sans">
          {error}
        </div>
      )}

      <main className="flex-1 px-4 lg:px-8 py-5 max-w-[1080px] w-full mx-auto">
        {step === "paste" && (
          <div className="space-y-4">
            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">Quelle</label>
              <div className="flex flex-wrap gap-2">
                {SOURCES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSource(s.value)}
                    className={`px-3.5 py-2 rounded-md text-[12.5px] font-display font-extrabold uppercase tracking-wide border-[1.5px] transition-colors ${
                      source === s.value
                        ? "bg-copper text-white border-copper"
                        : "bg-bg-2 text-ink border-steel-line/45 hover:border-copper/60"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">Anfrage-Text</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Hier Rohtext einfügen: kopierte Mail, WhatsApp-Nachricht, Telefonnotiz, abgetippter Brief …"
                className="w-full min-h-[280px] bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3.5 text-[14px] font-sans text-ink placeholder:text-ink-2 focus:outline-none focus:border-copper resize-y"
              />
              <p className="font-mono text-[11px] text-ink-2 mt-1.5">
                {rawText.length} Zeichen
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={doParse}
                disabled={parsing || !rawText.trim()}
                className="btn-primary !min-h-[48px] text-[13px] disabled:opacity-50"
              >
                {parsing ? "Strukturiere …" : "→ Strukturieren"}
              </button>
              <button
                onClick={skipParse}
                disabled={!rawText.trim()}
                className="btn-ghost !min-h-[48px] !px-4 text-[12px] disabled:opacity-50"
              >
                Manuell weiter (ohne Auto-Parse)
              </button>
            </div>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-5">
            <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-4">
              <span className="dd-eyebrow text-ink-2 block mb-2">
                Originaltext · Quelle {SOURCES.find((s) => s.value === source)?.label}
                {parsed?.parser && (
                  <span className="ml-2 font-mono text-[10px] text-ink-2">[strukturiert via {parsed.parser}]</span>
                )}
              </span>
              <pre className="font-mono text-[11.5px] text-ink whitespace-pre-wrap leading-relaxed max-h-[180px] overflow-auto">
                {rawText}
              </pre>
            </div>

            <div className="grid md:grid-cols-2 gap-3.5">
              <Field label="Kundenname" value={customerName} onChange={setCustomerName} required />
              <Field label="Telefon" value={phone} onChange={setPhone} />
              <Field label="E-Mail" value={email} onChange={setEmail} />
              <Field label="Straße + Nr." value={street} onChange={setStreet} />
              <Field label="PLZ" value={zip} onChange={setZip} />
              <Field label="Ort" value={city} onChange={setCity} />
            </div>

            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[80px] bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3 text-[13.5px] font-sans text-ink focus:outline-none focus:border-copper resize-y"
              />
            </div>
            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">Notizen / offene Punkte</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="z.B. Aufmaß planen · Rückruf bis Freitag · Foto fehlt"
                className="w-full bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3 text-[13.5px] font-sans text-ink focus:outline-none focus:border-copper"
              />
            </div>

            {/* Kunden-Match */}
            <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-4">
              <span className="dd-eyebrow text-ink-2 block mb-2">Kunde zuordnen</span>
              {matches.length > 0 ? (
                <div className="space-y-2 mb-3">
                  <p className="font-sans text-[12.5px] text-ink-2">
                    {matches.length} mögliche Bestands-Treffer:
                  </p>
                  {matches.map((m) => {
                    const isChosen = chosenCustomerId === m.customer.id;
                    return (
                      <button
                        key={m.customer.id}
                        onClick={() => setChosenCustomerId(isChosen ? null : m.customer.id)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-md border-[1.5px] transition-colors ${
                          isChosen
                            ? "bg-copper/10 border-copper"
                            : "bg-white border-steel-line/45 hover:border-copper/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-sans font-bold text-[13.5px] text-ink">{m.customer.name}</div>
                            <div className="font-mono text-[10.5px] text-ink-2 mt-0.5">
                              {[m.customer.customerNumber && `Kd-Nr ${m.customer.customerNumber}`, m.customer.city, m.customer.email].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-[11px] text-copper">{m.score}</div>
                            <div className="font-mono text-[9px] text-ink-2">{m.reason.join(", ")}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="font-sans text-[12.5px] text-ink-2 mb-3">
                  Keine Bestands-Treffer — wird als neuer Kunde angelegt.
                </p>
              )}
              {!chosenCustomerId && (
                <label className="flex items-center gap-2 font-sans text-[12.5px] text-ink">
                  <input
                    type="checkbox"
                    checked={createSevdesk}
                    onChange={(e) => setCreateSevdesk(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Auch in sevDesk als Contact anlegen (empfohlen)
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => setStep("paste")}
                disabled={saving}
                className="btn-ghost !min-h-[48px] !px-4 text-[12px]"
              >
                ← Zurück zum Text
              </button>
              <button
                onClick={doSave}
                disabled={saving || !customerName.trim()}
                className="btn-primary !min-h-[48px] text-[13px] disabled:opacity-50"
              >
                {saving ? "Speichere …" : "✓ Anfrage anlegen"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Field({
  label, value, onChange, required,
}: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="dd-eyebrow text-ink-2 block mb-1.5">
        {label}{required && <span className="text-rust ml-0.5">*</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg px-3 py-2.5 text-[13.5px] font-sans text-ink focus:outline-none focus:border-copper"
      />
    </div>
  );
}
