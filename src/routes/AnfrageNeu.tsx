import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  llmStructure, VORGANG_LABEL, VORGANG_COLOR, PARSER_LABEL,
  type ParsedInquiry, type Vorgang, type Confidence,
} from "../lib/llm";
import {
  listCustomers, matchCustomers, createCustomerLocal,
  type Customer, type CustomerMatch
} from "../lib/customers";
import { sevdeskCreateContact } from "../lib/sevdesk";
import { createInquiry, updateInquiry, findSimilar, type InquirySource, type Inquiry } from "../lib/inquiries";
import { diffCorrections, logCorrections } from "../lib/corrections";
import { createCard } from "../lib/pipeline";
import { isBackendConnected } from "../lib/supabase";
import SaveProgress, { type SaveStep } from "../components/SaveProgress";
import BackButton from "../components/BackButton";

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

/** Telefon in normalisierte Form bringen: ohne doppelte Leerzeichen, +49
 *  statt führende 0, damit sevDesk / Such-Index sauber arbeitet. */
function normalizePhone(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Bereits internationale Form
  if (s.startsWith("+")) return s;
  // DE-Nummer: erste 0 durch +49 ersetzen
  if (s.startsWith("0")) {
    const stripped = s.slice(1).replace(/^\s*/, "").replace(/[\s\-/]+/g, " ");
    return `+49 ${stripped}`.replace(/\s+/g, " ").trim();
  }
  return s;
}

/** Name trimmen + überflüssige Anreden entfernen. */
function normalizeName(raw: string): string {
  return raw.replace(/^(Herr|Frau|Familie|Hr\.?|Fr\.?)\s+/i, "").trim();
}

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
  const [phoneMobile, setPhoneMobile] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [vorgang, setVorgang] = useState<Vorgang>("angebot");

  // Kunden-Match
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [chosenCustomerId, setChosenCustomerId] = useState<string | null>(null);
  const [createSevdesk, setCreateSevdesk] = useState(true);
  const [saving, setSaving] = useState(false);

  // M9 Active-Asking: welche Low-Confidence-Pflichtfelder hat der User
  // schon ausdrücklich bestätigt (Klick auf „passt") oder durch eigene
  // Wertänderung implizit bestätigt? Solange ein Pflichtfeld mit conf=low
  // weder bestätigt noch verändert wurde, ist Speichern blockiert.
  const [confirmedLowFields, setConfirmedLowFields] = useState<Set<string>>(new Set());
  // Original-Werte direkt nach dem Parse — damit wir „User hat geändert"
  // sauber erkennen können (Änderung = implizite Bestätigung).
  const [parsedSnapshot, setParsedSnapshot] = useState<Record<string, string>>({});

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
      const cn = normalizeName(p.customerName ?? "");
      const ph = normalizePhone(p.phone ?? "");
      const pm = normalizePhone(p.phone_mobile ?? "");
      const em = (p.email ?? "").toLowerCase().trim();
      setCustomerName(cn);
      setPhone(ph);
      setPhoneMobile(pm);
      setEmail(em);
      setStreet(p.street ?? "");
      setZip(p.zip ?? "");
      setCity(p.city ?? "");
      setDescription(p.description ?? "");
      if (p.vorgang) setVorgang(p.vorgang);
      if (p.source_guess) setSource(p.source_guess);
      // M9: Snapshot der LLM-Werte merken + Confirm-Set zurücksetzen
      setParsedSnapshot({
        customerName: cn, phone: ph, phone_mobile: pm, email: em,
        street: p.street ?? "", zip: p.zip ?? "", city: p.city ?? "",
      });
      setConfirmedLowFields(new Set());
      setStep("edit");
    } catch (e: any) {
      setError(e?.message ?? "Parse-Fehler");
    } finally {
      setParsing(false);
    }
  }

  /** M9 Helper: muss dieses Feld noch bestätigt werden?
   *  Bedingung: confidence=low UND nicht explizit bestätigt UND der User
   *  hat den Wert nicht selbst verändert (Änderung = implizite Bestätigung). */
  function needsConfirm(field: string, currentValue: string, conf?: Confidence): boolean {
    if (conf !== "low") return false;
    if (confirmedLowFields.has(field)) return false;
    const snap = parsedSnapshot[field];
    if (snap !== undefined && snap !== currentValue) return false; // verändert = bestätigt
    return true;
  }
  function confirmField(field: string) {
    setConfirmedLowFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }

  /** Pflichtfelder fürs Speichern. Kontakt erfüllt = mind. eines von
   *  email / phone / phone_mobile. */
  const requiredCheck = useMemo(() => {
    const issues: { field: string; label: string; reason: string }[] = [];
    const c = parsed?.confidence ?? {};
    const conf = (k: keyof typeof c) => c[k] as Confidence | undefined;

    if (!customerName.trim()) {
      issues.push({ field: "customerName", label: "Kundenname", reason: "leer" });
    } else if (needsConfirm("customerName", customerName, conf("customerName"))) {
      issues.push({ field: "customerName", label: "Kundenname", reason: "unsicher — bitte prüfen oder bestätigen" });
    }

    if (!email.trim() && !phone.trim() && !phoneMobile.trim()) {
      issues.push({ field: "kontakt", label: "Kontakt", reason: "mindestens eines von Mail/Festnetz/Mobil ausfüllen" });
    } else {
      if (email.trim() && needsConfirm("email", email, conf("email"))) {
        issues.push({ field: "email", label: "E-Mail", reason: "unsicher — bitte prüfen oder bestätigen" });
      }
      if (phone.trim() && needsConfirm("phone", phone, conf("phone"))) {
        issues.push({ field: "phone", label: "Festnetz", reason: "unsicher — bitte prüfen oder bestätigen" });
      }
      if (phoneMobile.trim() && needsConfirm("phone_mobile", phoneMobile, conf("phone_mobile"))) {
        issues.push({ field: "phone_mobile", label: "Mobil", reason: "unsicher — bitte prüfen oder bestätigen" });
      }
    }
    return issues;
  }, [customerName, email, phone, phoneMobile, parsed, confirmedLowFields, parsedSnapshot]);

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

      // 5) Pipeline-Card — openPoints automatisch um Eckdaten anreichern
      //    damit Rick im Kanban-Board nicht erst klicken muss
      updateStep("card", { status: "running" });
      const place = [zip, city].filter(Boolean).join(" ").trim() || street || undefined;
      const tags: string[] = [];
      // M8: Leistungs-Chips bevorzugt aus leistungen[], sonst Fallback auf leistung-Singular
      if (parsed?.leistungen && parsed.leistungen.length > 0) {
        parsed.leistungen.slice(0, 4).forEach((l) => {
          const meng = l.mengen?.map((m) => `${m.wert}${m.einheit ? m.einheit : ""}`).join("+");
          tags.push(meng ? `${l.name} (${meng})` : l.name);
        });
      } else if (parsed?.leistung) {
        parsed.leistung.split(/,\s*/).slice(0, 3).forEach((l) => { if (l.trim()) tags.push(l.trim()); });
      }
      // Mengen-Hint
      if (parsed?.mengen?.length) tags.push(`${parsed.mengen.length} Positionen`);
      // Termin-Wunsch
      if (parsed?.termin) tags.push(`Termin: ${parsed.termin}`);
      // User-Notes ans Ende
      if (notes.trim()) tags.push(notes.trim());

      const card = await createCard({
        stage: "Anfrage",
        customerName,
        place,
        description: description || undefined,
        openPoints: tags.length > 0 ? tags.join(" · ") : undefined,
      });
      updateStep("card", { status: "done", detail: place ? `${customerName} · ${place}` : customerName });
      setCreatedCardId(card.id);

      // 6) Inquiry
      updateStep("inquiry", { status: "running" });
      const inq = await createInquiry({
        source,
        rawText,
        // Mobil hat keine eigene DB-Spalte: wir spiegeln sie in parsedJson,
        // damit Drawer/Inbox/Pipeline-Karte sie sehen können. Bei Bedarf
        // später als Migration in eigene Spalte ziehen.
        parsedJson: { ...(parsed ?? { parser: "heuristic" }), vorgang, phone_mobile: phoneMobile || undefined },
        customerName, customerPhone: phone, customerEmail: email,
        street, zip, city, description, notes,
        customerId,
      });
      await updateInquiry(inq.id, { pipelineCardId: card.id, status: "in_arbeit" });

      // M11: Korrektur-Log — wenn der User Parsed-Werte verändert hat,
      // schreiben wir die Diffs in parse_corrections (still bei Fehler).
      const diffs = diffCorrections(parsed, parsedSnapshot, {
        customerName, phone, phone_mobile: phoneMobile, email, street, zip, city,
      });
      if (diffs.length > 0) {
        void logCorrections(inq.id, parsed, diffs, vorgang);
      }

      updateStep("inquiry", { status: "done", detail: `Quelle ${source} · in_arbeit${diffs.length ? ` · ${diffs.length} Korrektur${diffs.length === 1 ? "" : "en"} geloggt` : ""}` });
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
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />
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
                  <span className="ml-2 font-mono text-[10px] text-ink-2">
                    [strukturiert via {PARSER_LABEL[parsed.parser]}]
                  </span>
                )}
                {parsed?.confidence?.overall && (
                  <ConfidenceDot c={parsed.confidence.overall as Confidence} />
                )}
              </span>
              <pre className="font-mono text-[11.5px] text-ink whitespace-pre-wrap leading-relaxed max-h-[180px] overflow-auto">
                {rawText}
              </pre>
            </div>

            {/* Vorgangstyp */}
            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">
                Vorgangstyp
                {parsed?.confidence?.vorgang && (
                  <ConfidenceDot c={parsed.confidence.vorgang as Confidence} />
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {(["angebot","termin","reklamation","material","sonstiges"] as Vorgang[]).map((v) => {
                  const active = vorgang === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setVorgang(v)}
                      className={`px-3.5 py-2 rounded-md text-[12.5px] font-display font-extrabold uppercase tracking-wide border-[1.5px] transition-colors ${
                        active
                          ? "text-white border-transparent"
                          : "bg-bg-2 text-ink border-steel-line/45 hover:border-copper/60"
                      }`}
                      style={active ? { background: VORGANG_COLOR[v], borderColor: VORGANG_COLOR[v] } : undefined}
                    >
                      {VORGANG_LABEL[v]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3.5">
              <Field label="Kundenname" value={customerName} onChange={setCustomerName} required
                     confidence={parsed?.confidence?.customerName as Confidence | undefined}
                     needsConfirm={needsConfirm("customerName", customerName, parsed?.confidence?.customerName as Confidence | undefined)}
                     onConfirm={() => confirmField("customerName")} />
              <Field label="E-Mail" value={email} onChange={setEmail}
                     confidence={parsed?.confidence?.email as Confidence | undefined}
                     needsConfirm={needsConfirm("email", email, parsed?.confidence?.email as Confidence | undefined)}
                     onConfirm={() => confirmField("email")} />
              <Field label="Festnetz" value={phone} onChange={setPhone}
                     confidence={parsed?.confidence?.phone as Confidence | undefined}
                     needsConfirm={needsConfirm("phone", phone, parsed?.confidence?.phone as Confidence | undefined)}
                     onConfirm={() => confirmField("phone")} />
              <Field label="Mobil" value={phoneMobile} onChange={setPhoneMobile}
                     confidence={parsed?.confidence?.phone_mobile as Confidence | undefined}
                     needsConfirm={needsConfirm("phone_mobile", phoneMobile, parsed?.confidence?.phone_mobile as Confidence | undefined)}
                     onConfirm={() => confirmField("phone_mobile")} />
              <Field label="Straße + Nr." value={street} onChange={setStreet} confidence={parsed?.confidence?.street as Confidence | undefined} />
              <Field label="PLZ" value={zip} onChange={setZip} />
              <Field label="Ort" value={city} onChange={setCity} confidence={parsed?.confidence?.city as Confidence | undefined} />
            </div>

            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[80px] bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3 text-[13.5px] font-sans text-ink focus:outline-none focus:border-copper resize-y"
              />
            </div>

            {/* Vom LLM erkannte Zusatz-Infos · read-only, werden in parsedJson
                mit gespeichert. Leistung/Mengen/Termin nicht editierbar in der
                Stammdaten-Sektion oben — hier sieht User trotzdem auf einen
                Blick was zu tun ist. */}
            {parsed && (parsed.leistung || parsed.leistungen?.length || parsed.mengen?.length || parsed.termin || (parsed.dringlichkeit && parsed.dringlichkeit !== "normal")) && (
              <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-3.5 space-y-2">
                <span className="dd-eyebrow text-ink-2 block mb-1">Aus dem Text zusätzlich erkannt</span>
                {/* M8: Mehrere Leistungen mit jeweiligen Mengen — strukturiert */}
                {parsed.leistungen && parsed.leistungen.length > 1 ? (
                  <div className="text-[12.5px] font-sans">
                    <span className="dd-eyebrow text-ink-2 inline-block w-[110px] align-top">Leistungen
                      <span className="ml-1 font-mono text-copper text-[10px]">×{parsed.leistungen.length}</span>
                    </span>
                    <span className="inline-flex flex-col gap-1.5 align-top">
                      {parsed.leistungen.map((l, idx) => (
                        <span key={idx} className="text-ink">
                          <b>{l.name}</b>
                          {l.mengen && l.mengen.length > 0 && (
                            <span className="text-ink-2 ml-2 font-mono text-[11px]">
                              {l.mengen.map((m) => `${m.wert}${m.einheit ? " " + m.einheit : ""}${m.was ? " " + m.was : ""}`).join(" · ")}
                            </span>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                ) : parsed.leistung ? (
                  <div className="text-[12.5px] font-sans">
                    <span className="dd-eyebrow text-ink-2 inline-block w-[110px] align-top">Leistung</span>
                    <span className="text-ink">{parsed.leistung}</span>
                  </div>
                ) : null}
                {/* Globale Mengen nur zeigen, wenn keine pro-Leistung-Mengen vorhanden */}
                {parsed.mengen && parsed.mengen.length > 0 && (!parsed.leistungen || parsed.leistungen.length <= 1) && (
                  <div className="text-[12.5px] font-sans">
                    <span className="dd-eyebrow text-ink-2 inline-block w-[110px] align-top">Mengen</span>
                    <span className="inline-flex flex-col gap-0.5 align-top">
                      {parsed.mengen.map((m, idx) => (
                        <span key={idx} className="text-ink">
                          <b className="font-mono">{m.wert}{m.einheit ? ` ${m.einheit}` : ""}</b>
                          {m.was && <span className="text-ink-2"> · {m.was}</span>}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {parsed.termin && (
                  <div className="text-[12.5px] font-sans">
                    <span className="dd-eyebrow text-ink-2 inline-block w-[110px]">Termin-Wunsch</span>
                    <span className="text-ink">{parsed.termin}</span>
                  </div>
                )}
                {parsed.dringlichkeit && parsed.dringlichkeit !== "normal" && (
                  <div className="text-[12.5px] font-sans">
                    <span className="dd-eyebrow text-ink-2 inline-block w-[110px]">Dringlichkeit</span>
                    <span className={`font-mono text-[11px] font-bold uppercase ${parsed.dringlichkeit === "hoch" ? "text-rust" : "text-ink-mute"}`}>
                      {parsed.dringlichkeit}
                    </span>
                  </div>
                )}
                <p className="font-mono text-[10.5px] text-ink-mute mt-1">
                  Diese Werte werden mit der Anfrage gespeichert, bleiben aber im Drawer und in der Pipeline-Notiz sichtbar.
                </p>
              </div>
            )}
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

            {/* M5: Self-Check-Hinweise (zweiter LLM-Call hat etwas zu meckern) */}
            {parsed?.meta?.review_hints && (parsed.meta.review_hints.missing?.length || parsed.meta.review_hints.potentially_wrong?.length || parsed.meta.review_hints.note) && (
              <div className="bg-amber/10 border border-amber/40 rounded-lg p-3.5">
                <div className="font-display font-extrabold uppercase text-[12px] text-amber tracking-wide mb-2">
                  ⓘ Selbst-Check der KI · zusätzliche Hinweise
                </div>
                {parsed.meta.review_hints.note && (
                  <p className="font-sans text-[12.5px] text-ink mb-2">{parsed.meta.review_hints.note}</p>
                )}
                {parsed.meta.review_hints.missing && parsed.meta.review_hints.missing.length > 0 && (
                  <div className="mb-2">
                    <div className="dd-eyebrow text-ink-2 mb-1">Möglicherweise nicht erfasst</div>
                    <ul className="space-y-0.5">
                      {parsed.meta.review_hints.missing.map((m, i) => (
                        <li key={i} className="font-sans text-[12.5px] text-ink">• {m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {parsed.meta.review_hints.potentially_wrong && parsed.meta.review_hints.potentially_wrong.length > 0 && (
                  <div>
                    <div className="dd-eyebrow text-ink-2 mb-1">Eventuell falsch übernommen</div>
                    <ul className="space-y-0.5">
                      {parsed.meta.review_hints.potentially_wrong.map((m, i) => (
                        <li key={i} className="font-sans text-[12.5px] text-ink">• {m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* M9: blockierende Pflichtfeld-Issues (leer ODER unsicher unbestätigt) */}
            {requiredCheck.length > 0 && (
              <div className="bg-rust/10 border border-rust/40 rounded-lg p-3.5">
                <div className="font-display font-extrabold uppercase text-[12px] text-rust tracking-wide mb-2">
                  ⚠ {requiredCheck.length} {requiredCheck.length === 1 ? "Punkt blockiert" : "Punkte blockieren"} das Speichern
                </div>
                <ul className="space-y-1">
                  {requiredCheck.map((i, idx) => (
                    <li key={idx} className="font-sans text-[12.5px] text-ink">
                      <b>{i.label}</b> <span className="text-ink-2">— {i.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pre-Cleaning Diagnose (klein, dezent) */}
            {parsed?.meta?.preclean?.applied && parsed.meta.preclean.applied.length > 0 && (
              <p className="font-mono text-[10.5px] text-ink-mute">
                Pre-Clean angewendet: {parsed.meta.preclean.applied.join(" · ")}
                {parsed.meta.preclean.shrunkBy > 0 && ` · ${parsed.meta.preclean.shrunkBy} Zeichen entfernt`}
              </p>
            )}

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
                disabled={saving || requiredCheck.length > 0}
                className="btn-primary !min-h-[48px] text-[13px] disabled:opacity-50"
                title={requiredCheck.length > 0 ? "Bitte zuerst die markierten Punkte oben prüfen oder bestätigen" : ""}
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
  label, value, onChange, required, confidence, needsConfirm, onConfirm,
}: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; confidence?: Confidence;
  needsConfirm?: boolean; onConfirm?: () => void;
}) {
  // M9: Bei unbestätigter Low-Confidence visuell deutlich rot, mit
  // „passt"-Button. Andernfalls normale Confidence-Färbung.
  const ring = needsConfirm
    ? "border-rust ring-2 ring-rust/30 bg-rust/8"
    : confidence === "low"    ? "border-rust/70 bg-rust/5"
    : confidence === "medium" ? "border-amber/70 bg-amber/5"
    :                           "border-steel-line/45 bg-bg-2";
  return (
    <div>
      <label className="dd-eyebrow text-ink-2 block mb-1.5">
        {label}{required && <span className="text-rust ml-0.5">*</span>}
        {confidence && <ConfidenceDot c={confidence} />}
      </label>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border-[1.5px] rounded-lg px-3 py-2.5 text-[13.5px] font-sans text-ink focus:outline-none focus:border-copper ${ring}`}
        />
        {needsConfirm && onConfirm && (
          <button
            type="button"
            onClick={onConfirm}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md text-[11px] font-display font-extrabold uppercase tracking-wide bg-rust text-white hover:bg-rust/85 transition-colors"
            title="Diesen unsicheren Wert als korrekt bestätigen"
          >
            ✓ passt
          </button>
        )}
      </div>
      {needsConfirm && (
        <p className="font-mono text-[10.5px] text-rust mt-1">
          KI ist sich nicht sicher — bitte prüfen, anpassen oder bestätigen.
        </p>
      )}
    </div>
  );
}

function ConfidenceDot({ c }: { c: Confidence }) {
  const meta =
    c === "high"   ? { color: "#1F7A3D", label: "sicher" } :
    c === "medium" ? { color: "#C9852F", label: "prüfen" } :
                     { color: "#B91C1C", label: "unsicher" };
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 align-middle font-mono text-[9.5px] uppercase tracking-wider"
      style={{ color: meta.color }}
      title={`LLM-Sicherheit: ${meta.label}`}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}
