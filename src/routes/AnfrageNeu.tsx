import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  llmStructureStream, VORGANG_LABEL, VORGANG_COLOR, PARSER_LABEL,
  type ParsedInquiry, type Vorgang, type Confidence, type StreamStep,
} from "../lib/llm";
import {
  listCustomers, matchCustomers, bestConfidentMatch,
  mergeCandidates, isSevdeskOnly,
  type Customer, type CustomerMatch
} from "../lib/customers";
import { sevdeskCreateContact, sevdeskListContacts } from "../lib/sevdesk";
import { findSimilar, uploadInquiryPhoto, updateInquiryPhotos, type InquirySource, type Inquiry } from "../lib/inquiries";
import { diffCorrections, logCorrections } from "../lib/corrections";
import { createInquiryBundle, attachSevdeskToCustomer, countCardsForCustomer } from "../lib/pipeline";
import { enforceValidSession } from "../lib/auth";
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

/** Eine erkannte Position (Gewerk) — Element von ParsedInquiry.leistungen. */
type LeistungEntry = NonNullable<ParsedInquiry["leistungen"]>[number];

export default function AnfrageNeu() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("paste");
  const [source, setSource] = useState<InquirySource>("mail");
  const [rawText, setRawText] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedInquiry | null>(null);
  // M13: Live-Stream-Steps. Map von step.id → latest StreamStep.
  // Bei mehrfachem 'llm' (70B-Fail + 8B-Fallback) wird nur das letzte
  // Event je id behalten — wir loggen den finalen Pfad.
  const [streamSteps, setStreamSteps] = useState<Record<string, StreamStep>>({});
  const [parseElapsed, setParseElapsed] = useState(0); // ms-Counter beim Tippen
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
  // Eingabefeld zum Hinzufügen einer manuellen Position (Gewerk)
  const [newPos, setNewPos] = useState("");
  // Positions-Detail-Editor (Modal): welche Position + Arbeitskopie
  const [editPos, setEditPos] = useState<{ idx: number; draft: LeistungEntry } | null>(null);

  // Kunden-Match
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  // Live aus sevDesk geladene Kontakte — erkennt Personen, die nach dem
  // letzten Import angelegt wurden und im lokalen Stamm noch fehlen.
  const [sevdeskContacts, setSevdeskContacts] = useState<Customer[]>([]);
  const [chosenCustomerId, setChosenCustomerId] = useState<string | null>(null);
  // Sobald der User die Zuordnung selbst anfasst (klickt/trennt), uebernimmt
  // die Auto-Erkennung nicht mehr — seine Entscheidung gewinnt.
  const [matchTouched, setMatchTouched] = useState(false);
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

  // sevDesk-Kontakte live laden (best effort, unabhaengig vom App-Backend) —
  // damit „bereits in sevDesk angelegt" schon beim Strukturieren greift.
  useEffect(() => {
    sevdeskListContacts().then(setSevdeskContacts).catch(() => {});
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

  // App-Stamm + live sevDesk-Kontakte zu einer Trefferliste mischen (bereits
  // gespiegelte Kontakte werden nicht doppelt gefuehrt).
  const candidates = useMemo(
    () => mergeCandidates(allCustomers, sevdeskContacts),
    [allCustomers, sevdeskContacts],
  );

  const matches: CustomerMatch[] = useMemo(() => {
    if (!customerName && !email && !phone) return [];
    return matchCustomers(candidates, { name: customerName, email, phone });
  }, [candidates, customerName, email, phone]);

  // Sicherer Top-Treffer (harter Anker + klarer Abstand) → automatisch verknuepfen,
  // solange der User die Zuordnung nicht selbst angefasst hat.
  const confident = useMemo(() => bestConfidentMatch(matches), [matches]);
  useEffect(() => {
    if (matchTouched) return;
    setChosenCustomerId(confident ? confident.customer.id : null);
  }, [confident, matchTouched]);

  const chosenCustomer = useMemo(
    () => candidates.find((c) => c.id === chosenCustomerId) ?? null,
    [candidates, chosenCustomerId],
  );

  // Folgeanfrage-Erkennung: Anzahl bereits vorhandener Pipeline-Vorgänge des
  // erkannten Bestandskunden laden. Nur App-Stammkunden haben Karten; sevDesk-
  // only-Treffer sind noch nicht im Stamm → kein Zähler. null = keine Anzeige.
  const [priorCount, setPriorCount] = useState<number | null>(null);
  useEffect(() => {
    setPriorCount(null);
    if (!chosenCustomer || isSevdeskOnly(chosenCustomer)) return;
    let alive = true;
    countCardsForCustomer(chosenCustomer.id)
      .then((n) => { if (alive) setPriorCount(n); })
      .catch(() => {});
    return () => { alive = false; };
  }, [chosenCustomer]);

  // Bestandskunde gewählt → fehlende Kontaktfelder aus dem Stammdatensatz
  // nachfüllen. Folgeanfragen kommen oft mit dünnem Text (nur Name + Stichworte),
  // obwohl der Kunde längst vollständig im System (und in sevDesk) steht. Nur
  // LEERE Felder füllen — vom Parser oder Nutzer gesetzte Werte bleiben unberührt.
  useEffect(() => {
    if (!chosenCustomer) return;
    if (chosenCustomer.email && !email) setEmail(chosenCustomer.email.toLowerCase().trim());
    if (chosenCustomer.street && !street) setStreet(chosenCustomer.street);
    if (chosenCustomer.zip && !zip) setZip(chosenCustomer.zip);
    if (chosenCustomer.city && !city) setCity(chosenCustomer.city);
    if (chosenCustomer.phone && !phone && !phoneMobile) {
      const d = chosenCustomer.phone.replace(/[^\d]/g, "").replace(/^49/, "0");
      if (/^01[5-7]/.test(d)) setPhoneMobile(normalizePhone(chosenCustomer.phone));
      else setPhone(normalizePhone(chosenCustomer.phone));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenCustomer]);

  async function doParse() {
    if (!rawText.trim()) {
      setError("Bitte erst Text einfügen.");
      return;
    }
    setError(null);
    setParsing(true);
    setStreamSteps({});
    setParseElapsed(0);
    const startedAt = Date.now();
    const ticker = window.setInterval(() => setParseElapsed(Date.now() - startedAt), 100);
    try {
      const p = await llmStructureStream(rawText, (ev) => {
        if (ev.kind === "step") {
          setStreamSteps((prev) => ({ ...prev, [ev.step.id]: ev.step }));
        }
      });
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
      // KI-Quellenschätzung nur übernehmen, wenn der Nutzer keine bewusste
      // Quelle gewählt hat (noch Default "mail"). Eine manuell gewählte oder
      // beim Tippen erkannte Quelle (WhatsApp/Telefon/…) gewinnt — die KI soll
      // sie nicht überschreiben (sonst wird z.B. WhatsApp fälschlich "persönlich").
      if (p.source_guess && source === "mail") setSource(p.source_guess);
      // M9: Snapshot der LLM-Werte merken + Confirm-Set zurücksetzen
      setParsedSnapshot({
        customerName: cn, phone: ph, phone_mobile: pm, email: em,
        street: p.street ?? "", zip: p.zip ?? "", city: p.city ?? "",
      });
      setConfirmedLowFields(new Set());
      setMatchTouched(false);
      setStep("edit");
    } catch (e: any) {
      setError(e?.message ?? "Parse-Fehler");
    } finally {
      window.clearInterval(ticker);
      setParsing(false);
    }
  }

  /** Positions-Editor: eine erkannte Position (Gewerk) entfernen. Schreibt
   *  direkt in `parsed.leistungen` zurück — dadurch fließt die Änderung beim
   *  Speichern (openPoints/parsedJson aus parsed) automatisch mit ein. leistung
   *  (Singular) wird konsistent nachgezogen. */
  function removeLeistung(idx: number) {
    setParsed((prev) => {
      if (!prev?.leistungen) return prev;
      const next = prev.leistungen.filter((_, i) => i !== idx);
      return { ...prev, leistungen: next, leistung: next[0]?.name };
    });
  }

  /** Positions-Editor: eine manuelle Position hinzufügen (nur Name nötig). */
  function addLeistung() {
    const name = newPos.trim();
    if (!name) return;
    setParsed((prev) => {
      const base = prev ?? { parser: "heuristic" as const };
      const list = base.leistungen ? [...base.leistungen] : [];
      list.push({ name });
      return { ...base, leistungen: list, leistung: base.leistung ?? name };
    });
    setNewPos("");
  }

  /* ── Positions-Detail-Editor (Modal) ───────────────────────────────────
     Klick auf eine Position öffnet eine Arbeitskopie (Draft). Erst „Übernehmen"
     schreibt zurück in parsed.leistungen — „Abbrechen" verwirft. So kann der
     User Name, jede Menge und jedes Material frei bearbeiten/ergänzen/löschen. */
  function openPosEdit(idx: number) {
    const l = parsed?.leistungen?.[idx];
    if (!l) return;
    setEditPos({ idx, draft: JSON.parse(JSON.stringify(l)) as LeistungEntry });
  }
  function patchDraft(fn: (d: LeistungEntry) => LeistungEntry) {
    setEditPos((p) => (p ? { ...p, draft: fn(p.draft) } : p));
  }
  function savePosEdit() {
    if (!editPos) return;
    const d = editPos.draft;
    setParsed((prev) => {
      if (!prev?.leistungen) return prev;
      const next = [...prev.leistungen];
      next[editPos.idx] = {
        ...d,
        name: d.name.trim() || next[editPos.idx].name,
        mengen: (d.mengen ?? []).filter((m) => String(m.wert ?? "").trim()),
        materialien: (d.materialien ?? []).filter((m) => (m.name ?? "").trim()),
      };
      return { ...prev, leistungen: next, leistung: next[0]?.name };
    });
    setEditPos(null);
  }
  // Draft-Mengen
  function draftAddMenge() { patchDraft((d) => ({ ...d, mengen: [...(d.mengen ?? []), { wert: "", einheit: "", was: "" }] })); }
  function draftSetMenge(i: number, field: "wert" | "einheit" | "was", val: string) {
    patchDraft((d) => ({ ...d, mengen: (d.mengen ?? []).map((m, j) => (j === i ? { ...m, [field]: val } : m)) }));
  }
  function draftRemoveMenge(i: number) { patchDraft((d) => ({ ...d, mengen: (d.mengen ?? []).filter((_, j) => j !== i) })); }
  // Draft-Materialien
  function draftAddMaterial() { patchDraft((d) => ({ ...d, materialien: [...(d.materialien ?? []), { name: "" }] })); }
  function draftSetMaterial(i: number, field: "name" | "spec" | "note", val: string) {
    patchDraft((d) => ({ ...d, materialien: (d.materialien ?? []).map((m, j) => (j === i ? { ...m, [field]: val } : m)) }));
  }
  function draftRemoveMaterial(i: number) { patchDraft((d) => ({ ...d, materialien: (d.materialien ?? []).filter((_, j) => j !== i) })); }

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
      issues.push({ field: "customerName", label: "Kundenname", reason: "unsicher, bitte prüfen oder bestätigen" });
    }

    if (!email.trim() && !phone.trim() && !phoneMobile.trim()) {
      issues.push({ field: "kontakt", label: "Kontakt", reason: "mindestens eines von Mail/Festnetz/Mobil ausfüllen" });
    } else {
      if (email.trim() && needsConfirm("email", email, conf("email"))) {
        issues.push({ field: "email", label: "E-Mail", reason: "unsicher, bitte prüfen oder bestätigen" });
      }
      if (phone.trim() && needsConfirm("phone", phone, conf("phone"))) {
        issues.push({ field: "phone", label: "Festnetz", reason: "unsicher, bitte prüfen oder bestätigen" });
      }
      if (phoneMobile.trim() && needsConfirm("phone_mobile", phoneMobile, conf("phone_mobile"))) {
        issues.push({ field: "phone_mobile", label: "Mobil", reason: "unsicher, bitte prüfen oder bestätigen" });
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
        hint: "Die Tabelle `customers` fehlt. Migration `20260521120000_customers.sql` im SQL-Editor ausführen.",
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
    const hasChosen = !!chosenCustomerId;
    const sevOnly = chosenCustomer ? isSevdeskOnly(chosenCustomer) : false;
    const useExisting = hasChosen && !sevOnly;       // echter lokaler Stammkunde
    const willCreateSev = createSevdesk && !hasChosen; // nur wenn gar kein Treffer
    return [
      { key: "anmeldung", label: "Anmeldung prüfen", status: "pending" },
      { key: "bundle",    label: "Anfrage sichern · Kunde, Vorgang, Anfrage & Baustelle", status: "pending" },
      ...(pendingPhotos.length > 0 ? [{ key: "fotos", label: `${pendingPhotos.length} WhatsApp-Foto${pendingPhotos.length === 1 ? "" : "s"} hochladen`, status: "pending" as const }] : []),
      { key: "sevdesk",   label: willCreateSev ? "sevDesk-Kontakt anlegen"
                               : sevOnly ? "sevDesk-Kontakt vorhanden"
                               : useExisting ? "sevDesk · Bestandskunde"
                               : "sevDesk übersprungen",
                          status: "pending" },
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

    const hasChosen = !!chosenCustomerId;
    const sevOnly = chosenCustomer ? isSevdeskOnly(chosenCustomer) : false;
    const useExisting = hasChosen && !sevOnly;       // echter lokaler Stammkunde
    const isCompany = /gmbh|gbr|e\.k\.|ag\b|kg\b|ohg|ug\b/i.test(customerName);
    const parts = customerName.trim().split(/\s+/);

    try {
      // 1) Preflight: Anmeldung gültig? Sonst SOFORT stoppen — bevor irgendetwas
      //    (vor allem in sevDesk) angelegt wird. Verhindert verwaiste Kontakte.
      updateStep("anmeldung", { status: "running" });
      const redirect = await enforceValidSession();
      if (redirect) {
        updateStep("anmeldung", {
          status: "error",
          detail: "Deine Sitzung ist abgelaufen. Es wurde noch NICHTS gespeichert.",
          errorHint: "Bitte neu anmelden, dann die Anfrage erneut speichern.",
        });
        setTimeout(() => window.location.replace(redirect), 1800);
        return;
      }
      updateStep("anmeldung", { status: "done", detail: "OK" });

      // openPoints für die Pipeline-Karte aus den erkannten Eckdaten anreichern
      const place = [zip, city].filter(Boolean).join(" ").trim() || street || undefined;
      const tags: string[] = [];
      if (parsed?.leistungen && parsed.leistungen.length > 0) {
        parsed.leistungen.slice(0, 4).forEach((l) => {
          const meng = l.mengen?.map((m) => `${m.wert}${m.einheit ? m.einheit : ""}`).join("+");
          tags.push(meng ? `${l.name} (${meng})` : l.name);
        });
      } else if (parsed?.leistung) {
        parsed.leistung.split(/,\s*/).slice(0, 3).forEach((l) => { if (l.trim()) tags.push(l.trim()); });
      }
      if (parsed?.mengen?.length) tags.push(`${parsed.mengen.length} Positionen`);
      if (parsed?.termin) tags.push(`Termin: ${parsed.termin}`);
      if (notes.trim()) tags.push(notes.trim());

      // bei sevDesk-only-Treffer ist die Kontakt-ID bereits bekannt
      const existingSevId = sevOnly ? chosenCustomer?.sevdeskContactId : undefined;

      // 2) ALLES-ODER-NICHTS: Kunde, Karte, Anfrage und Baustelle entstehen in
      //    EINER Datenbank-Transaktion — oder bei einem Fehler gar nichts.
      updateStep("bundle", { status: "running" });
      const bundle = await createInquiryBundle({
        customerId: useExisting ? chosenCustomerId ?? undefined : undefined,
        customer: useExisting ? undefined : {
          sevdeskContactId: existingSevId,
          customerNumber: sevOnly ? chosenCustomer?.customerNumber : undefined,
          name: customerName, isCompany,
          surename: !isCompany ? parts[0] : undefined,
          familyname: !isCompany ? parts.slice(1).join(" ") || undefined : undefined,
          email: email || undefined,
          phone: phone || phoneMobile || undefined,
          street: street || undefined, zip: zip || undefined, city: city || undefined,
        },
        card: {
          customerName, place,
          description: description || undefined,
          openPoints: tags.length > 0 ? tags.join(" · ") : undefined,
        },
        inquiry: {
          source, rawText,
          parsedJson: { ...(parsed ?? { parser: "heuristic" }), vorgang, phone_mobile: phoneMobile || undefined },
          customerName, customerPhone: phone, customerEmail: email,
          street, zip, city, description, notes,
        },
        site: {
          name: customerName, customerName,
          street: street || undefined, zip: zip || undefined, city: city || undefined,
          customerPhone: phone || phoneMobile || undefined, customerEmail: email || undefined,
          sevdeskContactId: existingSevId,
        },
      });
      setCreatedCardId(bundle.cardId);
      updateStep("bundle", { status: "done", detail: place ? `${customerName} · ${place}` : customerName });

      // 2b) Fotos aus WhatsApp hochladen (falls vorhanden)
      if (pendingPhotos.length > 0) {
        updateStep("fotos", { status: "running", detail: `${pendingPhotos.length} Foto${pendingPhotos.length === 1 ? "" : "s"} hochladen …` });
        try {
          const uploaded = await Promise.all(
            pendingPhotos.map((f) => uploadInquiryPhoto(f, bundle.inquiryId))
          );
          await updateInquiryPhotos(bundle.inquiryId, uploaded);
          updateStep("fotos", { status: "done", detail: `${uploaded.length} Foto${uploaded.length === 1 ? "" : "s"} gespeichert` });
        } catch (fotoErr: any) {
          updateStep("fotos", {
            status: "error", detail: String(fotoErr?.message ?? fotoErr),
            errorHint: "Anfrage ist vollständig gespeichert — nur die Fotos fehlen und können später nachgetragen werden.",
          });
        }
      }

      // 3) sevDesk als LETZTER, idempotenter Schritt. Erst live prüfen, ob der
      //    Kontakt schon existiert (kein Doppel!), sonst neu anlegen. Schlägt das
      //    fehl, bleibt die Anfrage vollständig — nur die sevDesk-Nummer fehlt.
      if (createSevdesk && !hasChosen) {
        updateStep("sevdesk", { status: "running" });
        try {
          let sevId: string | undefined;
          let sevNr: string | undefined;
          const live = await sevdeskListContacts(true); // frische Liste gegen Duplikate
          const best = bestConfidentMatch(matchCustomers(live, { name: customerName, email, phone: phone || phoneMobile }));
          if (best && isSevdeskOnly(best.customer)) {
            sevId = best.customer.sevdeskContactId;
            sevNr = best.customer.customerNumber;
            updateStep("sevdesk", { status: "done", detail: `Bereits vorhanden: ${best.customer.name}` });
          } else {
            const sev = await sevdeskCreateContact({
              isCompany,
              name: isCompany ? customerName : undefined,
              surename: !isCompany ? parts[0] : undefined,
              familyname: !isCompany ? parts.slice(1).join(" ") || undefined : undefined,
              email: email || undefined,
              phone: phone || undefined,
              phoneMobile: phoneMobile || undefined,
              street: street || undefined, zip: zip || undefined, city: city || undefined,
            });
            sevId = sev.id; sevNr = sev.customerNumber;
            updateStep("sevdesk", { status: "done", detail: `Kd-Nr ${sev.customerNumber || sev.id}` });
          }
          if (sevId) await attachSevdeskToCustomer(bundle.customerId, bundle.siteId, sevId, sevNr);
        } catch (sevErr: any) {
          const d = diagnoseError(sevErr);
          updateStep("sevdesk", {
            status: "error", detail: d.detail,
            errorHint: "Die Anfrage ist vollständig gespeichert. Nur der sevDesk-Kontakt fehlt und kann später nachgetragen werden.",
          });
        }
      } else {
        updateStep("sevdesk", {
          status: sevOnly ? "done" : "skipped",
          detail: sevOnly ? "bereits in sevDesk" : useExisting ? "Bestandskunde" : "übersprungen",
        });
      }

      // Korrektur-Log (still bei Fehler) — wenn der User Parsed-Werte geändert hat
      const diffs = diffCorrections(parsed, parsedSnapshot, {
        customerName, phone, phone_mobile: phoneMobile, email, street, zip, city,
      });
      if (diffs.length > 0) void logCorrections(bundle.inquiryId, parsed, diffs, vorgang);
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

            {/* Fotos aus WhatsApp */}
            <div>
              <label className="dd-eyebrow text-ink-2 block mb-1.5">
                Fotos aus WhatsApp
                <span className="normal-case tracking-normal font-sans font-normal text-[11px] text-ink-2 ml-2">(optional · werden zur Anfrage gespeichert)</span>
              </label>
              <div
                className="relative border-[1.5px] border-dashed border-steel-line/45 rounded-lg p-4 transition-colors hover:border-copper/60 cursor-pointer"
                onClick={() => document.getElementById("waphoto-input")?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-copper"); }}
                onDragLeave={(e) => e.currentTarget.classList.remove("border-copper")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("border-copper");
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                  if (files.length) setPendingPhotos((prev) => [...prev, ...files]);
                }}
              >
                <input
                  id="waphoto-input"
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
                    if (files.length) setPendingPhotos((prev) => [...prev, ...files]);
                    e.target.value = "";
                  }}
                />
                {pendingPhotos.length === 0 ? (
                  <p className="text-center font-sans text-[12.5px] text-ink-2">
                    📷 Bilder hier ablegen oder klicken zum Auswählen
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pendingPhotos.map((f, i) => (
                      <div key={i} className="relative group">
                        <img
                          src={URL.createObjectURL(f)}
                          alt={f.name}
                          className="w-20 h-20 object-cover rounded-md border border-steel-line/30"
                        />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setPendingPhotos((prev) => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rust text-white rounded-full text-[11px] leading-none grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Foto entfernen"
                        >✕</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); document.getElementById("waphoto-input")?.click(); }}
                      className="w-20 h-20 border-[1.5px] border-dashed border-steel-line/45 rounded-md grid place-items-center text-ink-2 hover:border-copper/60 hover:text-copper transition-colors text-2xl"
                      aria-label="Weiteres Foto hinzufügen"
                    >+</button>
                  </div>
                )}
              </div>
              {pendingPhotos.length > 0 && (
                <p className="font-mono text-[11px] text-ink-2 mt-1">
                  {pendingPhotos.length} Foto{pendingPhotos.length === 1 ? "" : "s"} ausgewählt · werden beim Speichern hochgeladen
                </p>
              )}
            </div>

            {/* Doppel-Anfrage-Warnung */}
            {similar.length > 0 && (
              <div className="bg-bg-2 border border-steel-line/45 border-l-4 border-l-amber rounded-lg p-4">
                <div className="font-display font-extrabold uppercase text-[12px] text-amber-deep tracking-wide mb-1.5">
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
                  Möglicher Duplikat. Vorher in der Inbox prüfen.
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
                disabled={!rawText.trim() || parsing}
                className="btn-ghost !min-h-[48px] !px-4 text-[12px] disabled:opacity-50"
              >
                Manuell weiter (ohne Auto-Parse)
              </button>
            </div>

            {/* M13 · Live-Pipeline während des Parsings */}
            {(parsing || Object.keys(streamSteps).length > 0) && (
              <StreamPipelineView steps={streamSteps} elapsedMs={parseElapsed} active={parsing} />
            )}
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
                    onClick: () => navigate("/admin/angebote"),
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
              <HighlightedRawText rawText={rawText} leistungen={parsed?.leistungen} />
              {parsed?.leistungen && parsed.leistungen.some((l) => l.source_quotes?.length) && (
                <div className="mt-2 font-mono text-[10px] text-ink-mute flex flex-wrap gap-x-3 gap-y-1">
                  {parsed.leistungen.map((l, idx) => {
                    if (!l.source_quotes?.length) return null;
                    const col = LEISTUNG_COLORS[idx % LEISTUNG_COLORS.length];
                    return (
                      <span key={idx} className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: col.bg, border: `1px solid ${col.border}` }} />
                        <span>{l.name}</span>
                      </span>
                    );
                  })}
                </div>
              )}
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
              <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-4 space-y-3">
                {/* Kopf: erkannte Positionen, bearbeitbar */}
                <div className="flex items-center justify-between">
                  <span className="dd-eyebrow text-ink-2">
                    Erkannte Positionen
                    {parsed.leistungen?.length ? (
                      <span className="ml-1.5 font-mono text-copper text-[10px]">×{parsed.leistungen.length}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[10px] text-ink-mute uppercase tracking-wide">bearbeitbar</span>
                </div>

                {/* Positions-Liste — je Gewerk eine Karte, einzeln entfernbar */}
                {parsed.leistungen && parsed.leistungen.length > 0 ? (
                  <ul className="space-y-1.5">
                    {parsed.leistungen.map((l, idx) => {
                      const col = LEISTUNG_COLORS[idx % LEISTUNG_COLORS.length];
                      return (
                        <li key={idx} onClick={() => openPosEdit(idx)} title="Zum Bearbeiten anklicken" className="group flex items-start gap-2.5 bg-white border border-steel-line/40 rounded-md pl-3 pr-2 py-2 hover:border-copper/50 cursor-pointer transition-colors">
                          <span className="mt-1 inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: col.bg, border: `1px solid ${col.border}` }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <b className="font-sans text-[13px] text-ink">{l.name}</b>
                              {l.mengen && l.mengen.length > 0 && (
                                <span className="font-mono text-[11px] text-ink-2">
                                  {l.mengen.map((m) => `${m.wert}${m.einheit ? " " + m.einheit : ""}${m.was ? " " + m.was : ""}`).join(" · ")}
                                </span>
                              )}
                            </div>
                            {l.materialien && l.materialien.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {l.materialien.map((mat, midx) => (
                                  <span key={midx} className="inline-flex items-baseline gap-1 px-1.5 py-0.5 bg-copper/10 border border-copper/30 rounded text-[10px] text-copper font-mono">
                                    <span className="font-bold">{mat.name}</span>
                                    {mat.spec && <span className="text-copper/80">· {mat.spec}</span>}
                                    {mat.menge && <span className="text-copper/80">· {mat.menge.wert}{mat.menge.einheit ? " " + mat.menge.einheit : ""}</span>}
                                    {mat.note && <span className="text-copper/60 italic" title={mat.note}>· {mat.note.length > 22 ? mat.note.slice(0, 20) + "…" : mat.note}</span>}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeLeistung(idx); }}
                            title="Position entfernen"
                            aria-label={`Position ${l.name} entfernen`}
                            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-ink-mute hover:text-white hover:bg-rust transition-colors opacity-50 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : parsed.leistung ? (
                  <div className="text-[13px] font-sans text-ink px-1">{parsed.leistung}</div>
                ) : (
                  <p className="font-sans text-[12px] text-ink-mute italic px-1">Keine Positionen erkannt. Unten ergänzen.</p>
                )}

                {/* Position manuell hinzufügen */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newPos}
                    onChange={(e) => setNewPos(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLeistung(); } }}
                    placeholder="Position ergänzen, z. B. Heckenschnitt …"
                    className="flex-1 min-w-0 bg-white border border-steel-line/45 rounded-md px-3 py-1.5 text-[12.5px] font-sans text-ink placeholder:text-ink-mute focus:border-copper focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addLeistung}
                    disabled={!newPos.trim()}
                    className="shrink-0 px-3 py-1.5 rounded-md bg-copper text-white font-sans font-bold text-[12.5px] disabled:opacity-40 hover:bg-copper/90 transition-colors"
                  >
                    + Hinzufügen
                  </button>
                </div>

                {/* Globale Mengen / Termin / Dringlichkeit — kompakt, abgesetzt */}
                {((parsed.mengen && parsed.mengen.length > 0 && (!parsed.leistungen || parsed.leistungen.length <= 1)) || parsed.termin || (parsed.dringlichkeit && parsed.dringlichkeit !== "normal")) && (
                  <div className="pt-2 border-t border-steel-line/30 space-y-1.5">
                    {parsed.mengen && parsed.mengen.length > 0 && (!parsed.leistungen || parsed.leistungen.length <= 1) && (
                      <div className="text-[12.5px] font-sans flex gap-2">
                        <span className="dd-eyebrow text-ink-2 w-[90px] shrink-0">Mengen</span>
                        <span className="flex flex-col gap-0.5">
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
                      <div className="text-[12.5px] font-sans flex gap-2">
                        <span className="dd-eyebrow text-ink-2 w-[90px] shrink-0">Termin</span>
                        <span className="text-ink">{parsed.termin}</span>
                      </div>
                    )}
                    {parsed.dringlichkeit && parsed.dringlichkeit !== "normal" && (
                      <div className="text-[12.5px] font-sans flex gap-2">
                        <span className="dd-eyebrow text-ink-2 w-[90px] shrink-0">Dringlichkeit</span>
                        <span className={`font-mono text-[11px] font-bold uppercase ${parsed.dringlichkeit === "hoch" ? "text-rust" : "text-ink-mute"}`}>
                          {parsed.dringlichkeit}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <p className="font-mono text-[10px] text-ink-mute">
                  Diese Positionen werden mit der Anfrage gespeichert und erscheinen im Drawer + in der Pipeline-Notiz.
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

              {/* Auto-Link-Banner: sicher erkannter Bestandskunde (App-Stamm
                  oder live aus sevDesk) */}
              {chosenCustomer && (
                <div className="flex items-center justify-between gap-3 mb-3 px-3.5 py-2.5 rounded-md bg-copper/10 border-[1.5px] border-copper">
                  <div>
                    <div className="font-sans font-bold text-[13.5px] text-ink flex items-center gap-1.5 flex-wrap">
                      <span className="text-copper">✓</span>
                      {isSevdeskOnly(chosenCustomer)
                        ? <>Bereits in <b>sevDesk</b> angelegt: {chosenCustomer.name}</>
                        : <>{priorCount && priorCount > 0 ? "Folgeanfrage" : "Bestandskunde"} {confident && !matchTouched ? "erkannt" : "verknüpft"}: {chosenCustomer.name}</>}
                      {!isSevdeskOnly(chosenCustomer) && !!priorCount && priorCount > 0 && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-copper/15 text-copper border border-copper/30">
                          ↻ {priorCount} {priorCount === 1 ? "Vorgang" : "Vorgänge"}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10.5px] text-ink-2 mt-0.5">
                      {[chosenCustomer.customerNumber && `Kd-Nr ${chosenCustomer.customerNumber}`, chosenCustomer.city, chosenCustomer.email, chosenCustomer.phone].filter(Boolean).join(" · ") || "kein Kontakt hinterlegt"}
                    </div>
                    {isSevdeskOnly(chosenCustomer) && (
                      <div className="font-mono text-[10px] text-ink-mute mt-0.5">
                        wird beim Speichern in den App-Stamm übernommen, kein neuer sevDesk-Contact
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setMatchTouched(true); setChosenCustomerId(null); }}
                    className="shrink-0 font-sans text-[12px] text-ink-2 underline hover:text-copper"
                  >
                    trennen
                  </button>
                </div>
              )}

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
                        onClick={() => { setMatchTouched(true); setChosenCustomerId(isChosen ? null : m.customer.id); }}
                        className={`w-full text-left px-3.5 py-2.5 rounded-md border-[1.5px] transition-colors ${
                          isChosen
                            ? "bg-copper/10 border-copper"
                            : "bg-white border-steel-line/45 hover:border-copper/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-sans font-bold text-[13.5px] text-ink flex items-center gap-1.5">
                              {m.customer.name}
                              {isSevdeskOnly(m.customer) && (
                                <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-copper/15 text-copper border border-copper/30">
                                  sevDesk
                                </span>
                              )}
                            </div>
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
                  Keine Bestands-Treffer. Wird als neuer Kunde angelegt.
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

            {/* Flächen-Gegenprüfung: Teilflächen ergeben nicht die Gesamtfläche */}
            {parsed?.meta?.flaechen_check && (
              <div className="bg-amber/10 border border-amber/40 border-l-4 border-l-amber rounded-lg p-4">
                <div className="font-display font-extrabold uppercase text-[12px] text-amber-deep tracking-wide mb-1.5 flex items-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full bg-amber text-white text-[10px] leading-4 text-center font-bold">△</span>
                  Flächen-Check
                </div>
                <p className="font-sans text-[13px] text-ink leading-relaxed">{parsed.meta.flaechen_check.hinweis}</p>
                <div className="font-mono text-[11px] text-ink-2 mt-2">
                  Gesamt {parsed.meta.flaechen_check.gesamt} m² · aufgeschlüsselt {parsed.meta.flaechen_check.zugeordnet} m² · offen <b className="text-amber-deep">{parsed.meta.flaechen_check.differenz} m²</b>
                </div>
              </div>
            )}

            {/* M5: Self-Check-Hinweise (zweiter LLM-Call hat etwas zu meckern) */}
            {parsed?.meta?.review_hints && (parsed.meta.review_hints.missing?.length || parsed.meta.review_hints.potentially_wrong?.length || parsed.meta.review_hints.note) && (
              <div className="bg-bg-2 border border-steel-line/45 border-l-4 border-l-amber rounded-lg p-4">
                <div className="font-display font-extrabold uppercase text-[12px] text-amber-deep tracking-wide mb-2 flex items-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full bg-amber text-white text-[10px] leading-4 text-center font-bold">ⓘ</span>
                  Selbst-Check der KI · zusätzliche Hinweise
                </div>
                {parsed.meta.review_hints.note && (
                  <p className="font-sans text-[13px] text-ink mb-3 leading-relaxed">{parsed.meta.review_hints.note}</p>
                )}
                {parsed.meta.review_hints.missing && parsed.meta.review_hints.missing.length > 0 && (
                  <div className="mb-2.5">
                    <div className="dd-eyebrow text-ink-mute mb-1">Möglicherweise nicht erfasst</div>
                    <ul className="space-y-1">
                      {parsed.meta.review_hints.missing.map((m, i) => (
                        <li key={i} className="font-sans text-[13px] text-ink leading-snug">• {m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {parsed.meta.review_hints.potentially_wrong && parsed.meta.review_hints.potentially_wrong.length > 0 && (
                  <div>
                    <div className="dd-eyebrow text-ink-mute mb-1">Eventuell falsch übernommen</div>
                    <ul className="space-y-1">
                      {parsed.meta.review_hints.potentially_wrong.map((m, i) => (
                        <li key={i} className="font-sans text-[13px] text-ink leading-snug">• {m}</li>
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
                      <b>{i.label}</b> <span className="text-ink-2">: {i.reason}</span>
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

      {/* ── Positions-Detail-Editor · Modal ─────────────────────────────── */}
      {editPos && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setEditPos(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-bg-2 border border-steel-line/60 rounded-xl shadow-2xl"
          >
            {/* Stahl-Header mit Kupfer-Schweißnaht */}
            <div
              className="px-5 py-3 flex items-center justify-between sticky top-0 z-10"
              style={{ background: "linear-gradient(#2B2E31,#1A1C1E)", boxShadow: "inset 0 -2px 0 #DC6E2D" }}
            >
              <div className="min-w-0">
                <div className="dd-eyebrow text-copper">Position bearbeiten</div>
                <div className="font-display text-white text-[16px] leading-tight truncate">{editPos.draft.name || "Neue Position"}</div>
              </div>
              <button type="button" onClick={() => setEditPos(null)} aria-label="Schließen" className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10">✕</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Gewerk-Name */}
              <div>
                <label className="dd-eyebrow text-ink-2 block mb-1.5">Gewerk / Bezeichnung</label>
                <input
                  type="text"
                  value={editPos.draft.name}
                  onChange={(e) => patchDraft((d) => ({ ...d, name: e.target.value }))}
                  className="w-full bg-white border border-steel-line/45 rounded-md px-3 py-2 text-[14px] font-sans text-ink focus:border-copper focus:outline-none"
                />
              </div>

              {/* Mengen */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="dd-eyebrow text-ink-2">Mengen</label>
                  <button type="button" onClick={draftAddMenge} className="font-sans text-[12px] font-bold text-copper hover:underline">+ Menge</button>
                </div>
                <div className="space-y-2">
                  {(editPos.draft.mengen ?? []).length === 0 && (
                    <p className="font-sans text-[12px] text-ink-mute italic">Keine Menge. Bei Bedarf hinzufügen.</p>
                  )}
                  {(editPos.draft.mengen ?? []).map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={m.wert} onChange={(e) => draftSetMenge(i, "wert", e.target.value)} placeholder="Wert" className="w-16 bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[13px] font-mono text-ink focus:border-copper focus:outline-none" />
                      <input value={m.einheit ?? ""} onChange={(e) => draftSetMenge(i, "einheit", e.target.value)} placeholder="Einh." className="w-16 bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[13px] font-mono text-ink focus:border-copper focus:outline-none" />
                      <input value={m.was ?? ""} onChange={(e) => draftSetMenge(i, "was", e.target.value)} placeholder="wofür (z. B. Terrasse)" className="flex-1 min-w-0 bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[13px] font-sans text-ink focus:border-copper focus:outline-none" />
                      <button type="button" onClick={() => draftRemoveMenge(i)} aria-label="Menge entfernen" className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-ink-mute hover:text-white hover:bg-rust">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Materialien */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="dd-eyebrow text-ink-2">Materialien</label>
                  <button type="button" onClick={draftAddMaterial} className="font-sans text-[12px] font-bold text-copper hover:underline">+ Material</button>
                </div>
                <div className="space-y-2">
                  {(editPos.draft.materialien ?? []).length === 0 && (
                    <p className="font-sans text-[12px] text-ink-mute italic">Kein Material. Bei Bedarf hinzufügen.</p>
                  )}
                  {(editPos.draft.materialien ?? []).map((mat, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={mat.name} onChange={(e) => draftSetMaterial(i, "name", e.target.value)} placeholder="Material" className="flex-1 min-w-0 bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[13px] font-sans text-ink focus:border-copper focus:outline-none" />
                      <input value={mat.spec ?? ""} onChange={(e) => draftSetMaterial(i, "spec", e.target.value)} placeholder="Spec (z. B. anthrazit)" className="w-32 bg-white border border-steel-line/45 rounded px-2 py-1.5 text-[13px] font-mono text-ink focus:border-copper focus:outline-none" />
                      <button type="button" onClick={() => draftRemoveMaterial(i)} aria-label="Material entfernen" className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-ink-mute hover:text-white hover:bg-rust">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-steel-line/40 flex items-center justify-end gap-2 sticky bottom-0 bg-bg-2">
              <button type="button" onClick={() => setEditPos(null)} className="px-4 py-2 rounded-md font-sans text-[13px] text-ink-2 hover:text-ink">Abbrechen</button>
              <button type="button" onClick={savePosEdit} className="px-5 py-2 rounded-md bg-copper text-white font-sans font-bold text-[13px] hover:bg-copper/90 transition-colors">✓ Übernehmen</button>
            </div>
          </div>
        </div>
      )}
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
          KI ist sich nicht sicher. Bitte prüfen, anpassen oder bestätigen.
        </p>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   M14 · Quellen-Highlights im Originaltext
   ──────────────────────────────────────────────────────────────────────
   Pro Leistung eine Farbe. Originaltext wird abschnittsweise gerendert,
   Stellen, die in leistungen[].source_quotes vorkommen, bekommen das
   farbige Background plus Hover-Tooltip mit dem Leistungs-Namen. */

const LEISTUNG_COLORS: { bg: string; border: string; ink: string }[] = [
  { bg: "rgba(220,110,45,0.18)",  border: "rgba(220,110,45,0.55)",  ink: "#7A3A14" }, // Kupfer
  { bg: "rgba(31,122,61,0.18)",   border: "rgba(31,122,61,0.55)",   ink: "#0E3D1F" }, // Moos
  { bg: "rgba(201,133,47,0.20)",  border: "rgba(201,133,47,0.55)",  ink: "#5E3D16" }, // Bernstein
  { bg: "rgba(30,64,175,0.16)",   border: "rgba(30,64,175,0.50)",   ink: "#162B6C" }, // Tinte
  { bg: "rgba(110,80,35,0.18)",   border: "rgba(110,80,35,0.55)",   ink: "#3F2D11" }, // Bronze
  { bg: "rgba(185,28,28,0.16)",   border: "rgba(185,28,28,0.50)",   ink: "#5E0F0F" }, // Rost
];

interface HighlightSpan {
  start: number;
  end: number;
  leistungIdx: number;
  leistungName: string;
}

/** Findet alle Vorkommen der source_quotes im rawText, sortiert nach
 *  Startposition, löst Überlappungen so dass die früher startende Spanne
 *  bleibt. Case-insensitive Match. */
function buildHighlightSpans(
  rawText: string,
  leistungen: ParsedInquiry["leistungen"],
): HighlightSpan[] {
  if (!leistungen) return [];
  const lower = rawText.toLowerCase();
  const spans: HighlightSpan[] = [];
  leistungen.forEach((l, idx) => {
    if (!l.source_quotes?.length) return;
    for (const quote of l.source_quotes) {
      const needle = quote.toLowerCase();
      if (needle.length < 3) continue;
      let from = 0;
      while (true) {
        const pos = lower.indexOf(needle, from);
        if (pos < 0) break;
        spans.push({ start: pos, end: pos + needle.length, leistungIdx: idx, leistungName: l.name });
        from = pos + needle.length;
      }
    }
  });
  spans.sort((a, b) => a.start - b.start);
  // Überlappungen entfernen: spätere komplett verschluckte Spans rausfiltern,
  // bei Teilüberlappung den Start des zweiten verschieben
  const out: HighlightSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (!last) { out.push(s); continue; }
    if (s.start >= last.end) { out.push(s); continue; }
    if (s.end <= last.end) { continue; } // komplett innerhalb
    out.push({ ...s, start: last.end });   // Teilüberlappung
  }
  return out;
}

function HighlightedRawText({
  rawText,
  leistungen,
}: {
  rawText: string;
  leistungen?: ParsedInquiry["leistungen"];
}) {
  const spans = useMemo(() => buildHighlightSpans(rawText, leistungen), [rawText, leistungen]);

  if (spans.length === 0) {
    return (
      <pre className="font-mono text-[11.5px] text-ink whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-auto">
        {rawText}
      </pre>
    );
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) nodes.push(rawText.slice(cursor, s.start));
    const col = LEISTUNG_COLORS[s.leistungIdx % LEISTUNG_COLORS.length];
    nodes.push(
      <mark
        key={`s-${i}`}
        title={`gehört zu: ${s.leistungName}`}
        style={{
          background: col.bg,
          borderBottom: `2px solid ${col.border}`,
          color: col.ink,
          padding: "0 1px",
          borderRadius: "2px",
        }}
      >
        {rawText.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  });
  if (cursor < rawText.length) nodes.push(rawText.slice(cursor));

  return (
    <pre className="font-mono text-[11.5px] text-ink whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-auto">
      {nodes}
    </pre>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   M13 · Live-Pipeline-Anzeige
   ──────────────────────────────────────────────────────────────────────
   Zeigt während der Strukturierung Schritt für Schritt, was passiert.
   Jeder Schritt: ○ (pending) → ⏳ (running) → ✓ (done) bzw. → (skipped).
   Pro Schritt: Label, Status-Icon, Millisekunden-Wert, optionaler Info-Text. */

const PIPELINE_STEPS: { id: string; label: string }[] = [
  { id: "preclean",      label: "Pre-Cleaning" },
  { id: "heuristik",     label: "Heuristik (Regex)" },
  { id: "llm",           label: "Llama 3.3 70B" },
  { id: "crossvalidate", label: "Cross-Validation" },
  { id: "selfcheck",     label: "Self-Check" },
  { id: "done",          label: "fertig" },
];

function StreamPipelineView({
  steps,
  elapsedMs,
  active,
}: {
  steps: Record<string, StreamStep>;
  elapsedMs: number;
  active: boolean;
}) {
  return (
    <div className="bg-bg-deep text-white rounded-xl p-4 lg:p-5 font-mono text-[12px] shadow-lg border border-steel-line/35">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-extrabold uppercase tracking-wide text-copper text-[13px]">
          Strukturiere · live
        </span>
        <span className="text-steel tabular-nums text-[11px]">
          {(elapsedMs / 1000).toFixed(1)} s
        </span>
      </div>
      <ul className="space-y-1.5">
        {PIPELINE_STEPS.map(({ id, label }) => {
          const step = steps[id];
          const status = step?.status;
          const isStart = status === "start";
          const isDone = status === "done";
          const isSkip = status === "skipped";

          let icon = "○";
          let iconClass = "text-steel/50";
          if (isStart && active) { icon = "⏳"; iconClass = "text-amber"; }
          else if (isDone) { icon = "✓"; iconClass = "text-moss-bright"; }
          else if (isSkip) { icon = "→"; iconClass = "text-steel"; }

          const ms = step?.ms;
          const info = step?.info;
          const model = step?.model;

          return (
            <li key={id} className="flex items-baseline gap-3 leading-snug">
              <span className={`text-[14px] w-4 inline-block text-center ${iconClass}`}>{icon}</span>
              <span className={`flex-1 ${isDone || isSkip ? "text-white" : isStart ? "text-amber" : "text-steel/65"}`}>
                {label}
                {model && <span className="text-copper/80 ml-1.5">· {model}</span>}
                {info && <span className="text-steel ml-2">· {info}</span>}
              </span>
              {typeof ms === "number" && (isDone || isSkip) && (
                <span className="text-steel tabular-nums text-[10.5px]">{ms} ms</span>
              )}
            </li>
          );
        })}
      </ul>
      {steps.done?.totalMs != null && (
        <div className="mt-3 pt-2.5 border-t border-steel-line/30 text-steel text-[10.5px] flex justify-between">
          <span>Pfad: <b className="text-copper">{steps.done.path ?? "—"}</b></span>
          <span>Total: <b className="text-white tabular-nums">{steps.done.totalMs} ms</b></span>
        </div>
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
