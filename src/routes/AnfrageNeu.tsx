import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { llmStructure, type ParsedInquiry } from "../lib/llm";
import {
  listCustomers, matchCustomers, createCustomerLocal,
  type Customer, type CustomerMatch
} from "../lib/customers";
import { sevdeskCreateContact } from "../lib/sevdesk";
import { createInquiry, updateInquiry, findSimilar, type InquirySource, type Inquiry } from "../lib/inquiries";
import { createCard } from "../lib/pipeline";
import { isBackendConnected } from "../lib/supabase";
import SaveProgress, { type SaveStep } from "../components/SaveProgress";

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

/** Auto-Erkennung der Quelle anhand von Heuristiken im Rohtext. */
function detectSource(text: string): InquirySource | null {
  const t = text.toLowerCase();
  if (/\b(von|from|gesendet|gesendet von)[\s:].*@/.test(t) ||
      /\bbetreff:|\bsubject:/.test(t)) return "mail";
  if (/whatsapp|✓✓|✔✔/.test(t)) return "whatsapp";
  if (/kleinanzeigen|noreply@kleinanzeigen/.test(t)) return "mail";
  if (/\b(telefonat|rückruf|angerufen|am telefon|telefon-notiz)\b/i.test(text)) return "phone";
  if (text.length < 180 && !/@/.test(text) && /^[A-Z]/.test(text)) return "whatsapp";
  return null;
}

type Step = "paste" | "edit";

export default function AnfrageNeu() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("paste");
  const [source, setSource] = useState<InquirySource>("mail");
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedInquiry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Inquiry[]>([]);
  const parseTimer = useRef<number | null>(null);

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

  // Save-Progress
  const [progressOpen, setProgressOpen] = useState(false);
  const [steps, setSteps] = useState<SaveStep[]>([]);
  const [createdCardId, setCreatedCardId] = useState<string | null>(null);

  useEffect(() => {
    if (!isBackendConnected()) return;
    listCustomers().then(setAllCustomers).catch(() => {});
  }, []);

  // Auto-Source-Erkennung beim Tippen
  useEffect(() => {
    if (!rawText.trim()) return;
    const guess = detectSource(rawText);
    if (guess && source === "mail" && step === "paste") setSource(guess);
  }, [rawText]);

  // Doppel-Check: ähnliche Anfrage in den letzten 7 Tagen?
  useEffect(() => {
    if (rawText.trim().length < 40) { setSimilar([]); return; }
    if (parseTimer.current) window.clearTimeout(parseTimer.current);
    parseTimer.current = window.setTimeout(() => {
      findSimilar(rawText).then(setSimilar).catch(() => {});
    }, 600);
    return () => { if (parseTimer.current) window.clearTimeout(parseTimer.current); };
  }, [rawText]);

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

  function diagnoseError(err: any): { detail: string; hint?: string } {
    const msg = String(err?.message ?? err ?? "Unbekannter Fehler");
    if (/Could not find the table 'public\.inquiries'/i.test(msg) || /relation .*inquiries.* does not exist/i.test(msg)) {
      return {
        detail: msg,
        hint: "Die Tabelle `inquiries` fehlt in der Live-DB. Spiele dazu die Datei\n`supabase/migrations/20260521140000_inquiries.sql`\nund\n`supabase/migrations/20260521160000_inquiries_extra.sql`\nim Supabase-SQL-Editor aus, dann nochmal speichern.",
      };
    }
    if (/Could not find the table 'public\.customers'/i.test(msg)) {
      return {
        detail: msg,
        hint: "Die Tabelle `customers` fehlt — Migration `20260521120000_customers.sql` im SQL-Editor ausführen.",
      };
    }
    if (/sevDesk .* 4\d\d/i.test(msg)) {
      return { detail: msg, hint: "sevDesk-API hat abgelehnt. SEVDESK_TOKEN als Cloudflare-Secret prüfen." };
    }
    if (/Failed to fetch|NetworkError|TypeError: Load failed/i.test(msg)) {
      return { detail: msg, hint: "Netzwerk-/Verbindungsfehler. Internet prüfen, dann erneut versuchen." };
    }
    return { detail: msg };
  }

  function makeSteps(): SaveStep[] {
    const useExisting = !!chosenCustomerId;
    return [
      { key: "precheck", label: "DB-Schema prüfen (inquiries-Tabelle)",  status: "pending" },
      { key: "parse",    label: "Strukturierung übernehmen",              status: "pending" },
      { key: "match",    label: useExisting ? "Bestandskunde verknüpft" : "Kundenstamm prüfen", status: useExisting ? "done" : "pending" },
      { key: "sevdesk",  label: createSevdesk && !useExisting ? "sevDesk-Contact anlegen" : "sevDesk übersprungen",
                         status: createSevdesk && !useExisting ? "pending" : "skipped" },
      { key: "customer", label: useExisting ? "Kunde übernommen" : "Kunde in App anlegen",  status: useExisting ? "done" : "pending" },
      { key: "card",     label: 'Pipeline-Karte in Stage „Anfrage"',    status: "pending" },
      { key: "inquiry",  label: "Anfrage in Inbox speichern",            status: "pending" },
    ];
  }

  function updateStep(key: string, patch: Partial<SaveStep>) {
    setSteps((prev) => prev.map((s) => s.key === key ? { ...s, ...patch } : s));
  }

  async function doSave() {
    if (!customerName.trim()) {
      setError("Kundenname fehlt.");
      return;
    }
    setError(null);
    setSaving(true);
    const initial = makeSteps();
    setSteps(initial);
    setProgressOpen(true);

    const useExisting = !!chosenCustomerId;
    let customerId: string | undefined = chosenCustomerId ?? undefined;

    try {
      // 0) Pre-Check: gibt es die inquiries-Tabelle? Fail-fast bevor wir
      //    Customer/Card halb anlegen und Karteileichen produzieren.
      updateStep("precheck", { status: "running" });
      try {
        const r = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/inquiries?select=id&limit=1`,
          {
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
          }
        );
        if (!r.ok) {
          const body = await r.text();
          if (/inquiries/.test(body)) throw new Error(`Tabelle 'public.inquiries' fehlt`);
          throw new Error(`Pre-Check fehlgeschlagen (${r.status})`);
        }
        updateStep("precheck", { status: "done", detail: "Schema OK" });
      } catch (e: any) {
        const d = diagnoseError(e);
        updateStep("precheck", { status: "error", detail: d.detail, errorHint: d.hint });
        throw e;
      }

      // 1) Strukturierung — synthetischer „Confirm"-Schritt
      updateStep("parse", { status: "running" });
      await new Promise((r) => setTimeout(r, 80));
      updateStep("parse", {
        status: "done",
        detail: parsed?.parser ? `via ${parsed.parser}` : "manuell ausgefüllt",
      });

      // 2) Kundenstamm-Match
      if (!useExisting) {
        updateStep("match", { status: "running" });
        await new Promise((r) => setTimeout(r, 80));
        updateStep("match", { status: "done", detail: "keine Bestands-Übereinstimmung — wird neu angelegt" });
      }

      // 3) sevDesk-Contact (optional)
      let sevdeskContactId: string | undefined;
      let customerNumber: string | undefined;
      if (createSevdesk && !useExisting) {
        updateStep("sevdesk", { status: "running" });
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
          updateStep("sevdesk", { status: "done", detail: `Kd-Nr ${customerNumber || sev.id}` });
        } catch (sevErr: any) {
          const d = diagnoseError(sevErr);
          updateStep("sevdesk", { status: "error", detail: d.detail, errorHint: d.hint ?? "sevDesk-Anlage übersprungen — Kunde wird nur in der App angelegt" });
          // Wir machen aber weiter — App-intern reicht für die Anfrage
        }
      }

      // 4) App-Customer
      if (!useExisting) {
        updateStep("customer", { status: "running" });
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
        updateStep("customer", { status: "done", detail: customerName });
      }

      // 5) Pipeline-Card
      updateStep("card", { status: "running" });
      const place = [zip, city].filter(Boolean).join(" ").trim() || street || undefined;
      const card = await createCard({
        stage: "Anfrage",
        customerName,
        place,
        description: description || undefined,
        openPoints: notes || undefined,
      });
      updateStep("card", { status: "done", detail: place ? `${customerName} · ${place}` : customerName });
      setCreatedCardId(card.id);

      // 6) Inquiry
      updateStep("inquiry", { status: "running" });
      const inq = await createInquiry({
        source,
        rawText,
        parsedJson: parsed,
        customerName, customerPhone: phone, customerEmail: email,
        street, zip, city, description, notes,
        customerId,
      });
      await updateInquiry(inq.id, { pipelineCardId: card.id, status: "in_arbeit" });
      updateStep("inquiry", { status: "done", detail: `Quelle ${source} · in_arbeit` });
    } catch (e: any) {
      // Welcher Schritt war running?
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.status === "running");
        if (idx === -1) return prev;
        const next = [...prev];
        const d = diagnoseError(e);
        next[idx] = { ...next[idx], status: "error", detail: d.detail, errorHint: d.hint };
        return next;
      });
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
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && rawText.trim()) {
                    e.preventDefault();
                    doParse();
                  }
                }}
                autoFocus
                placeholder="Hier Rohtext einfügen: kopierte Mail, WhatsApp-Nachricht, Telefonnotiz, abgetippter Brief …"
                className="w-full min-h-[280px] bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3.5 text-[14px] font-sans text-ink placeholder:text-ink-2 focus:outline-none focus:border-copper resize-y"
              />
              <p className="font-mono text-[11px] text-ink-2 mt-1.5">
                {rawText.length} Zeichen · <kbd className="px-1 py-0.5 bg-bg-3 text-[10px] font-mono rounded">Strg+↵</kbd> zum Strukturieren
              </p>
            </div>

            {/* Doppel-Anfrage-Warnung */}
            {similar.length > 0 && (
              <div className="bg-amber/10 border border-amber/35 rounded-lg p-3.5">
                <div className="font-display font-extrabold uppercase text-[12px] text-amber tracking-wide mb-1.5">
                  ⚠ Ähnliche Anfrage{similar.length === 1 ? "" : "n"} in den letzten 7 Tagen
                </div>
                <ul className="space-y-1">
                  {similar.slice(0, 3).map((s) => (
                    <li key={s.id} className="font-sans text-[12.5px] text-ink">
                      <b>{s.customerName ?? "ohne Namen"}</b>
                      {s.city && <span className="text-ink-2"> · {s.city}</span>}
                      <span className="font-mono text-[10.5px] text-ink-2 ml-2">
                        {new Date(s.createdAt).toLocaleDateString("de-DE")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="font-sans text-[11.5px] text-ink-2 mt-2">
                  Möglicher Duplikat — vorher in der Inbox prüfen.
                </p>
              </div>
            )}

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
            <SaveProgress
              open={progressOpen}
              steps={steps}
              title={`Anfrage anlegen · ${customerName || "ohne Namen"}`}
              onClose={() => setProgressOpen(false)}
              retry={steps.some((s) => s.status === "error") ? { label: "Erneut versuchen", onClick: doSave } : undefined}
              done={steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "skipped")
                ? {
                    label: createdCardId ? "→ Zur Pipeline" : "→ Zur Inbox",
                    onClick: () => navigate(createdCardId ? "/admin/angebote" : "/admin/anfragen"),
                  }
                : undefined}
            />
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
