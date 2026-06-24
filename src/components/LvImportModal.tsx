import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseSirDoc,
  parseGaebDoc,
  suggestMatchesSir,
  gewerkToLvCat,
  formatSirPriceSource,
  detectOptionKey,
  deriveOptionLabel,
  derivePositionStem,
  type SirExport,
} from "../lib/gaebImport";
import {
  LV_CAT_ORDER,
  LV_CATEGORIES,
  updateLvPosition,
  createLvPosition,
  addLvOption,
} from "../lib/lv";
import { supabase } from "../lib/supabase";
import type { LvPosition } from "../lib/types";

/** Die fünf etablierten Auflagen-Schlüssel. Mit Default-Folge-Kategorie für
 *  die anzulegende Folge-LV-Position (Rick-Vorgabe „Material liefern gehört
 *  zu Material, nicht als Zulage zu den Arbeiten"). */
const OPTION_KEYS = [
  { key: "lagern",       label: "Lagern",       defaultCat: "ERD" as const },
  { key: "entsorgen",    label: "Entsorgen",    defaultCat: "SON" as const },
  { key: "austauschen",  label: "Austauschen",  defaultCat: "MAT" as const },
  { key: "kultivieren",  label: "Kultivieren",  defaultCat: "GTN" as const },
  { key: "liefern",      label: "Liefern",      defaultCat: "MAT" as const },
] as const;
type OptionKey = typeof OPTION_KEYS[number]["key"];

/* ────────────────────────────────────────────────────────────────────────
   LV-Import (23.06.2026)
   .sir / .X81 / .X82 / .X83 → Leuschner-LV
   --------------------------------------------------------------------
   Workflow:
     1) Datei droppen / wählen → Parser erkennt Format automatisch
     2) Tabelle zeigt alle Positionen + Match-Vorschläge gegen unser LV
     3) Pro Zeile: Aktion festlegen (Preis aktualisieren | Neu anlegen | Skip)
     4) "Übernehmen" → Bulk-Update + lv_price_history-Einträge mit Quelle

   Stil: Marktwerte (Preis/Einheit) übernehmen wir 1:1; Position-Name
   bleibt Leuschner-Sprache. Beim Neuanlegen schlagen wir einen Kurz-Namen
   vor, den Rick noch editieren kann.
   ──────────────────────────────────────────────────────────────────── */

type Action = "update" | "create" | "auflage" | "skip";

interface Decision {
  action:     Action;
  /** bei "update" */
  targetLvId: string | null;
  /** bei "create": Hauptposition (Arbeit ODER Material wenn split=false; Arbeits-Pos wenn split=true) */
  newId:      string;
  newName:    string;
  newCat:     string;
  /** bei "create": Arbeit + Material strikt trennen.
   *  - true  → 2 LV-Positionen werden angelegt (Arbeit in newCat + Material in MAT)
   *            UND eine Auflage "liefern" verknüpft beide (defaultActive=true).
   *  - false → eine einzige LV-Position mit dem vollen EP. Nutze ich bei
   *            Positionen ohne Material (z.B. reines Erdarbeiten) oder wenn
   *            der User es explizit nicht splitten will. */
  splitMaterial:  boolean;
  /** bei "create" + splitMaterial=true: Material-Folgeposition (immer Cat=MAT) */
  matNewId:       string;
  matNewName:     string;
  /** bei "auflage": welche Hauptposition bekommt die Auflage angehängt? */
  auflageBaseLvId:    string | null;
  /** bei "auflage": Schlüssel (lagern | entsorgen | …) */
  auflageKey:         OptionKey;
  /** bei "auflage": Label das in der Auflage-Liste angezeigt wird */
  auflageLabel:       string;
  /** bei "auflage": ID der **neu anzulegenden Folge-LV-Position** */
  auflageFollowId:    string;
  /** bei "auflage": Kategorie der Folge-LV-Position */
  auflageFollowCat:   string;
  /** bei "auflage": Name der Folge-LV-Position (in Leuschner-Stil) */
  auflageFollowName:  string;
}

interface Props {
  isOpen:    boolean;
  onClose:   () => void;
  positions: LvPosition[];
  onApplied: () => void;       // refresh aus LV.tsx
}

/* ── Sprach-Smoother für Leuschner-Stil ────────────────────────────────
   sirAdos schreibt z.B. "Oberboden abtragen, entsorgen, bis 30 cm".
   Leuschner-Stil ist knapper: "Oberboden abtragen 30 cm".
   Nicht aggressiv – nur erste Komma-Phrase + Kerndimension behalten. */
function suggestShortName(longName: string, specs: string | null): string {
  // Komma-getrennten Anhang abtrennen, falls Dimensionsphrase ("bis 30 cm")
  let s = longName.replace(/\s*,\s*(bis|i\.M\.|i\. M\.)\s+\d+\s*cm.*$/i, "");
  // Doppel-Kommas reduzieren
  s = s.replace(/\s*,\s+([a-zäöüß]+)\s*,\s*([a-zäöüß]+)\s*$/i, ", $1 $2");
  // wenn Specs vorhanden und im Namen fehlt → anhängen
  if (specs && /\d+/.test(specs)) {
    const cm = specs.split(",").map((x) => x.trim()).find((x) => /^\d+$/.test(x));
    if (cm && !s.includes(cm)) s = `${s.replace(/,?\s*$/, "")} ${cm} cm`;
  }
  return s.trim();
}

/** Aus sirAdos-Volltext einen Material-LV-Namen ableiten — z.B.
 *  "Betonsteinpflaster, 200/100/60 mm, N2, ungebundene Bauweise"
 *   → "Betonsteinpflaster 200/100/60 N2 (Lieferung)". */
function suggestMaterialName(longName: string): string {
  // Erste 2-3 Phrasen behalten, "(Lieferung)" anhängen
  const parts = longName.split(",").map((s) => s.trim());
  const stem = parts.slice(0, Math.min(3, parts.length)).join(" ");
  return `${stem} (Lieferung)`.trim();
}

/* ── Nächste freie ID in einer Kategorie schätzen ─────────────────────
   Heuristik: höchste existierende Nummer + 1, dreistellig.
   Optionales `claimed`-Set verhindert Kollisionen, wenn innerhalb eines
   Default-Init-Laufes mehrere IDs in derselben Cat reserviert werden
   (z.B. 5× neue MAT-Positionen). Wird befüllt → später Sets erkennen sich. */
function nextFreeId(cat: string, all: LvPosition[], claimed?: Set<string>): string {
  const re = new RegExp(`^${cat}-(\\d+)$`, "i");
  let max = 0;
  for (const p of all) {
    const m = re.exec(p.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (claimed) {
    for (const id of claimed) {
      const m = re.exec(id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  const id = `${cat}-${String(max + 1).padStart(3, "0")}`;
  if (claimed) claimed.add(id);
  return id;
}

export default function LvImportModal({ isOpen, onClose, positions, onApplied }: Props) {
  const [parsed, setParsed] = useState<SirExport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ updated: number; created: number; auflagen: number; skipped: number } | null>(null);
  /** Leuschner-Stundensatz für Lohn-Umrechnung. Default 60 €/h (entspricht
   *  VWG-102 Stand 06/2026). Wird auf alle importierten Positionen mit
   *  hoursPerUnit > 0 angewendet: lohn_neu = hoursPerUnit × hourlyRate. */
  const [hourlyRate, setHourlyRate] = useState<number>(60);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Lohn-Anteil auf Leuschner-Satz umrechnen.
   *  Wenn die Position keine Zeit (h) angibt, behalten wir den sirAdos-Lohn. */
  const adjustWage = useCallback((sirWage: number, hoursPerUnit: number | null): number => {
    if (hoursPerUnit == null || hoursPerUnit <= 0) return sirWage;
    return Number((hoursPerUnit * hourlyRate).toFixed(2));
  }, [hourlyRate]);

  // Reset bei jedem Schließen, damit beim nächsten Öffnen ein sauberer Start ist
  useEffect(() => {
    if (!isOpen) {
      setParsed(null);
      setParseError(null);
      setFilename("");
      setDecisions(new Map());
      setApplyError(null);
      setApplyResult(null);
      setApplying(false);
    }
  }, [isOpen]);

  const handleFile = useCallback(async (file: File) => {
    setFilename(file.name);
    setParseError(null);
    setParsed(null);
    setApplyResult(null);
    try {
      const text = await file.text();
      // Format-Erkennung: .sir hat <UserData>, GAEB hat <GAEB>
      let result: SirExport;
      if (/<UserData[^>]*source\s*=\s*"Sirados"/i.test(text.slice(0, 600))) {
        result = parseSirDoc(text);
      } else if (/<GAEB[^>]/i.test(text.slice(0, 600))) {
        // GAEB → in SirExport-shape umwandeln (Demo-Items rausfiltern)
        const g = parseGaebDoc(text);
        result = {
          source: "Sirados (GAEB)", version: g.gaebVersion, user: null,
          exportDate: g.exportDate, projectName: g.projectName,
          objectAddr: { street: null, zip: null, city: null },
          offerName: g.daPhase ? `DA${g.daPhase}` : "",
          offer: { wageTotal: 0, materialTotal: 0, plantTotal: 0, netTotal: 0, vatRate: 0, vatAmount: 0, grossTotal: 0, hours: null },
          priceFactor: { state: null, location: null, postalCode: null, factor: null },
          positions: g.items.filter((i) => !i.isDemo && i.upTotal > 0).map((i) => ({
            siradosGuid:  i.siradosGuid ?? "",
            siradosId:    i.siradosId ?? "",
            name:         i.outlineText || i.detailText.slice(0, 80),
            positionNum:  i.rNoPart,
            lvNumber:     null,
            specs:        null,
            unit:         i.unit,
            quantity:     1,
            unitPrice:    i.upTotal,
            wage:         i.upWage,
            material:     i.upMaterial,
            plant:        i.upPlant,
            total:        i.upTotal,
            hoursPerUnit: i.timePerUnit,
            kg2018:       i.din276_18,
            kg2008:       i.din276_08,
            gewerk:       i.slb,
            titel:        null,
            description:  i.detailText,
            hint:         null,
            rangeLow:     i.upFrom,
            rangeMid:     i.upAvg,
            rangeHigh:    i.upTo,
            groupTitle:   "",
          })),
        };
      } else {
        throw new Error("Unbekanntes Format – erwarte .sir, .X81, .X82 oder .X83.");
      }
      setParsed(result);

      // Default-Decisions: Auflagen-Heuristik zuerst, dann Match/Update, dann Create.
      const emptyDec = (): Decision => ({
        action: "skip", targetLvId: null, newId: "", newName: "", newCat: "ERD",
        splitMaterial: false, matNewId: "", matNewName: "",
        auflageBaseLvId: null, auflageKey: "lagern", auflageLabel: "",
        auflageFollowId: "", auflageFollowCat: "ERD", auflageFollowName: "",
      });
      const d = new Map<string, Decision>();
      const claimed = new Set<string>();  // IDs, die innerhalb dieses Defaultlaufs schon vergeben sind
      for (const p of result.positions) {
        const key   = p.siradosGuid || p.siradosId;
        const cands = suggestMatchesSir(p, positions, 3);
        const optKey = detectOptionKey(p.name);
        const stem   = derivePositionStem(p.name).toLowerCase();

        // Hauptposition aus Leuschner-LV finden: Name beginnt mit (oder enthält) Stamm
        const baseMatch = positions.find((lp) => {
          const ln = lp.name.toLowerCase();
          return ln === stem || ln.startsWith(stem) || stem.startsWith(ln);
        });

        if (optKey && baseMatch) {
          // → Auflage zu bestehender Hauptposition
          const followCat = OPTION_KEYS.find((k) => k.key === optKey)!.defaultCat;
          d.set(key, {
            ...emptyDec(),
            action: "auflage",
            auflageBaseLvId:   baseMatch.id,
            auflageKey:        optKey,
            auflageLabel:      deriveOptionLabel(p.name),
            auflageFollowId:   nextFreeId(followCat, positions, claimed),
            auflageFollowCat:  followCat,
            auflageFollowName: deriveOptionLabel(p.name),
          });
        } else if (cands.length > 0 && cands[0].score > 0.55) {
          // → Bestehende Position updaten
          d.set(key, {
            ...emptyDec(),
            action: "update",
            targetLvId: cands[0].lvId,
          });
        } else {
          // → Neue Position(en) anlegen. Default: Arbeit + Material strikt trennen,
          //    wenn beide Anteile substantiell sind (Rick-Vorgabe 23.06.2026).
          const cat = gewerkToLvCat(p.gewerk, p.kg2018);
          const hasWork = (p.wage + p.plant) > 0 || (p.hoursPerUnit ?? 0) > 0;
          const hasMat  = p.material > 0;
          const shouldSplit = hasWork && hasMat && cat !== "MAT";

          d.set(key, {
            ...emptyDec(),
            action: "create",
            newId:           nextFreeId(cat, positions, claimed),
            newName:         suggestShortName(p.name, p.specs),
            newCat:          cat,
            splitMaterial:   shouldSplit,
            matNewId:        shouldSplit ? nextFreeId("MAT", positions, claimed) : "",
            matNewName:      shouldSplit ? suggestMaterialName(p.name) : "",
          });
        }
      }
      setDecisions(d);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }, [positions]);

  /* ── Bulk-Apply ───────────────────────────────────────────────────── */
  const apply = useCallback(async () => {
    if (!parsed) return;
    setApplying(true); setApplyError(null);
    let updated = 0, created = 0, auflagen = 0, skipped = 0;
    try {
      for (const p of parsed.positions) {
        const key = p.siradosGuid || p.siradosId;
        const dec = decisions.get(key);
        if (!dec || dec.action === "skip") { skipped++; continue; }
        const reason = formatSirPriceSource(p, parsed.exportDate);
        const unit   = p.unit ?? "";

        // Lohn auf Leuschner-Stundensatz umgerechnet (außer hoursPerUnit fehlt)
        const wageAdj = adjustWage(p.wage, p.hoursPerUnit);
        // Anteile: Arbeit = Lohn (adjusted) + Gerät; Material separat
        const workShare = Number((wageAdj + p.plant).toFixed(2));
        const matShare  = Number(p.material.toFixed(2));
        const totalEp   = Number((wageAdj + p.plant + p.material).toFixed(2));

        if (dec.action === "update" && dec.targetLvId) {
          // Cat-passenden Anteil übernehmen: MAT → Material, sonst Arbeit
          const targetCat = positions.find((x) => x.id === dec.targetLvId)?.cat;
          const priceForUpdate = targetCat === "MAT" ? matShare : workShare;
          await updateLvPosition(dec.targetLvId, {
            price: priceForUpdate,
            unit:  unit || undefined,
          });
          try {
            if (supabase) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.rpc as any)("lv_price_history_set_latest_reason", {
                p_lv_id:  dec.targetLvId,
                p_reason: reason,
              });
            }
          } catch { /* Trigger-Eintrag bleibt ohne Quelle */ }
          updated++;

        } else if (dec.action === "create") {
          if (dec.splitMaterial && matShare > 0 && dec.matNewId) {
            // 1) Arbeitsposition (Lohn-adjusted + Gerät)
            await createLvPosition({
              id: dec.newId, cat: dec.newCat, name: dec.newName,
              price: workShare, unit, surcharge: "",
              shortText: "", longText: "", zulagen: [],
            });
            // 2) Materialposition (Material-Anteil)
            await createLvPosition({
              id: dec.matNewId, cat: "MAT", name: dec.matNewName,
              price: matShare, unit, surcharge: "",
              shortText: "", longText: "", zulagen: [],
            });
            // 3) Verknüpfung: Auflage "liefern" defaultActive=true
            await addLvOption({
              baseLvId:      dec.newId,
              key:           "liefern",
              label:         "Material liefern",
              followLvId:    dec.matNewId,
              defaultActive: true,
            });
            created  += 2;
            auflagen += 1;
          } else {
            // Eine einzige LV-Position mit gesamtem (adjustierten) EP
            await createLvPosition({
              id: dec.newId, cat: dec.newCat, name: dec.newName,
              price: totalEp, unit, surcharge: "",
              shortText: "", longText: "", zulagen: [],
            });
            created++;
          }

        } else if (dec.action === "auflage" && dec.auflageBaseLvId) {
          // Folge-Position: nimmt nur den Cat-passenden Anteil
          const followIsMat = dec.auflageFollowCat === "MAT";
          const followPrice = followIsMat ? matShare : workShare;
          await createLvPosition({
            id:        dec.auflageFollowId,
            cat:       dec.auflageFollowCat,
            name:      dec.auflageFollowName,
            price:     followPrice,
            unit,
            surcharge: "",
            shortText: "",
            longText:  "",
            zulagen:   [],
          });
          await addLvOption({
            baseLvId:      dec.auflageBaseLvId,
            key:           dec.auflageKey,
            label:         dec.auflageLabel || dec.auflageFollowName,
            followLvId:    dec.auflageFollowId,
            defaultActive: false,
          });
          auflagen++;
        }
      }
      setApplyResult({ updated, created, auflagen, skipped });
      onApplied();
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [parsed, decisions, onApplied, positions, adjustWage]);

  /* ── Hilfs-Helper für Decision-Updates ─────────────────────────────── */
  function setDec(key: string, patch: Partial<Decision>) {
    setDecisions((m) => {
      const next = new Map(m);
      const cur = next.get(key);
      if (!cur) return m;
      next.set(key, { ...cur, ...patch });
      return next;
    });
  }

  /* ── Match-Vorschläge memoisieren ─────────────────────────────────── */
  const matchCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof suggestMatchesSir>>();
    if (!parsed) return cache;
    for (const p of parsed.positions) {
      cache.set(p.siradosGuid || p.siradosId, suggestMatchesSir(p, positions, 5));
    }
    return cache;
  }, [parsed, positions]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-[80] flex items-end lg:items-center justify-center p-0 lg:p-6"
      onClick={onClose}
    >
      <div
        className="bg-bg-2 rounded-t-3xl lg:rounded-2xl w-full max-w-6xl p-6 max-h-[92vh] overflow-y-auto board-scroll"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kopfzeile */}
        <div className="flex items-center justify-between mb-4">
          <span className="dd-eyebrow text-copper">Externer Import</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modal schließen"
            className="font-sans text-ink-2 text-[13px] hover:text-ink"
          >
            Schließen
          </button>
        </div>
        <h2 className="font-display font-black uppercase text-2xl text-ink mb-1">sirAdos · LV-Übernahme</h2>
        <p className="font-sans text-[13px] text-ink-mute mb-5">
          .sir / .X81 / .X82 / .X83 – Preise & Einheiten werden übernommen,
          Position-Namen bleiben in Leuschner-Sprache.
        </p>

        {/* Schritt 1 — Datei wählen */}
        {!parsed && (
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className="border-2 border-dashed border-steel rounded-2xl p-10 text-center bg-bg-1/40 hover:bg-bg-1/60 transition"
          >
            <div className="font-display font-black uppercase text-ink text-lg mb-1">Datei hier ablegen</div>
            <div className="font-sans text-ink-mute text-[13px] mb-4">
              oder
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-copper text-white px-4 py-2 rounded-lg font-sans font-bold text-[13px] hover:opacity-90"
            >
              Datei auswählen
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sir,.X81,.x81,.X82,.x82,.X83,.x83,.xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {parseError && (
              <div className="mt-4 text-red-600 font-sans text-[13px]">
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* Schritt 2+3 — Vorschau + Decision-Tabelle */}
        {parsed && (
          <>
            {/* Meta-Header */}
            <div className="bg-bg-1 rounded-xl p-4 mb-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-[12.5px] font-sans">
              <div>
                <div className="text-ink-mute uppercase text-[10.5px] tracking-wider mb-0.5">Quelle</div>
                <div className="text-ink font-bold">{parsed.source} {parsed.version}</div>
              </div>
              <div>
                <div className="text-ink-mute uppercase text-[10.5px] tracking-wider mb-0.5">Projekt</div>
                <div className="text-ink font-bold">{parsed.projectName || filename}</div>
              </div>
              <div>
                <div className="text-ink-mute uppercase text-[10.5px] tracking-wider mb-0.5">Positionen</div>
                <div className="text-ink font-bold">{parsed.positions.length}</div>
              </div>
              <div>
                <div className="text-ink-mute uppercase text-[10.5px] tracking-wider mb-0.5">Datum</div>
                <div className="text-ink font-bold">{parsed.exportDate}</div>
              </div>
              {/* Leuschner-Stundensatz für Lohn-Umrechnung */}
              <div className="col-span-2 lg:col-span-4 flex items-center gap-3 border-t border-steel/30 pt-3 mt-1">
                <span className="text-ink-mute uppercase text-[10.5px] tracking-wider">Leuschner-Stundensatz</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(Number(e.target.value) || 0)}
                    className="w-20 bg-white border border-steel rounded px-2 py-1 text-[12.5px] tabular-nums text-right"
                  />
                  <span className="text-ink text-[12.5px]">€/h</span>
                </div>
                <span className="text-ink-mute text-[11px] italic">
                  Arbeits-Anteil wird neu berechnet: <span className="font-bold">Zeit (h) × {hourlyRate} €/h</span> — gilt für alle Positionen mit Zeit-Angabe in sirAdos.
                </span>
              </div>
              {parsed.priceFactor.factor != null && (
                <div className="col-span-2 lg:col-span-4">
                  <div className="text-ink-mute uppercase text-[10.5px] tracking-wider mb-0.5">Ortsfaktor (effektiv genutzt)</div>
                  <div className="text-ink text-[12.5px]">
                    {parsed.priceFactor.location ?? "—"}
                    {parsed.priceFactor.postalCode && <> · PLZ {parsed.priceFactor.postalCode}</>}
                    {" · "}Faktor <span className="font-bold tabular-nums">{parsed.priceFactor.factor.toFixed(4)}</span>
                    {parsed.objectAddr.zip && parsed.priceFactor.postalCode &&
                       parsed.objectAddr.zip !== parsed.priceFactor.postalCode && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px]">
                        Hinweis: Faktor-PLZ {parsed.priceFactor.postalCode} ≠ Objekt-PLZ {parsed.objectAddr.zip}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Decisions-Tabelle */}
            <div className="overflow-x-auto rounded-xl border border-steel mb-4">
              <table className="w-full text-[12.5px] font-sans">
                <thead className="bg-bg-1 text-ink-mute uppercase text-[10.5px] tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">sirAdos · Position</th>
                    <th className="text-right px-3 py-2 w-24">Preis</th>
                    <th className="text-left px-3 py-2 w-32">Aktion</th>
                    <th className="text-left px-3 py-2">Ziel / Neuanlage</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.positions.map((p) => {
                    const key  = p.siradosGuid || p.siradosId;
                    const dec  = decisions.get(key);
                    const cands= matchCache.get(key) ?? [];
                    if (!dec) return null;
                    const lvTarget = positions.find((x) => x.id === dec.targetLvId);
                    const priceDiff = lvTarget?.price != null
                      ? p.unitPrice - lvTarget.price
                      : null;
                    return (
                      <tr key={key} className="border-t border-steel/40 align-top">
                        <td className="px-3 py-2">
                          <div className="text-ink font-bold leading-tight">{p.name}</div>
                          <div className="text-ink-mute text-[11px] mt-0.5">
                            sirAdos {p.siradosId} · {p.unit ?? "?"} · KG{p.kg2018 ?? "?"}
                            {p.hoursPerUnit && p.hoursPerUnit > 0
                              ? ` · ${p.hoursPerUnit.toFixed(2)} h/Eh.` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {(() => {
                            const w  = adjustWage(p.wage, p.hoursPerUnit);
                            const ep = Number((w + p.material + p.plant).toFixed(2));
                            const changed = Math.abs(ep - p.unitPrice) > 0.005;
                            return (
                              <>
                                <div className="text-ink font-bold tabular-nums">
                                  {ep.toFixed(2)} €
                                </div>
                                {changed && (
                                  <div className="text-ink-mute text-[10.5px] tabular-nums" title={`sirAdos-EP ${p.unitPrice.toFixed(2)} € → Leuschner-Lohn ${hourlyRate} €/h`}>
                                    sir {p.unitPrice.toFixed(2)} €
                                  </div>
                                )}
                                <div className="text-ink-mute text-[10px] tabular-nums" title="Anteile aus sirAdos pro Einheit (z.B. €/m²)">
                                  Arbeit {w.toFixed(2)} · Material {p.material.toFixed(2)} · Gerät {p.plant.toFixed(2)} €/{p.unit ?? "Eh."}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={dec.action}
                            onChange={(e) => setDec(key, { action: e.target.value as Action })}
                            className="w-full bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                          >
                            <option value="update">Preis updaten</option>
                            <option value="create">Neu (Hauptposition)</option>
                            <option value="auflage">Als Auflage anhängen</option>
                            <option value="skip">Ignorieren</option>
                          </select>
                          {detectOptionKey(p.name) && dec.action !== "auflage" && (
                            <div className="text-[10.5px] text-amber-700 mt-1 italic">
                              💡 sieht wie Auflage aus (Schlüssel „{detectOptionKey(p.name)}")
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {dec.action === "update" && (
                            <>
                              <select
                                value={dec.targetLvId ?? ""}
                                onChange={(e) => setDec(key, { targetLvId: e.target.value || null })}
                                className="w-full bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                              >
                                <option value="">— LV-Position wählen —</option>
                                {cands.map((c) => (
                                  <option key={c.lvId} value={c.lvId}>
                                    {c.lvId} · {c.lvName} ({Math.round(c.score * 100)}%)
                                  </option>
                                ))}
                                <option disabled>──────────</option>
                                {positions
                                  .filter((x) => !cands.find((c) => c.lvId === x.id))
                                  .slice(0, 50)
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.id} · {x.name}
                                    </option>
                                  ))}
                              </select>
                              {lvTarget && priceDiff != null && (
                                <div className="text-[10.5px] mt-1 tabular-nums">
                                  <span className="text-ink-mute">aktuell: </span>
                                  <span className="text-ink">{lvTarget.price?.toFixed(2)} €</span>
                                  <span className={`ml-1.5 font-bold ${priceDiff > 0 ? "text-emerald-700" : priceDiff < 0 ? "text-red-700" : "text-ink-mute"}`}>
                                    {priceDiff > 0 ? "+" : ""}{priceDiff.toFixed(2)} €
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          {dec.action === "create" && (
                            <div className="grid grid-cols-3 gap-2">
                              <select
                                value={dec.newCat}
                                onChange={(e) => setDec(key, {
                                  newCat: e.target.value,
                                  newId: nextFreeId(e.target.value, positions),
                                })}
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                              >
                                {LV_CAT_ORDER.map((c) => (
                                  <option key={c} value={c}>{c} · {LV_CATEGORIES[c].label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={dec.newId}
                                onChange={(e) => setDec(key, { newId: e.target.value.toUpperCase() })}
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] font-mono"
                              />
                              <input
                                type="text"
                                value={dec.newName}
                                onChange={(e) => setDec(key, { newName: e.target.value })}
                                placeholder="Arbeits-Position (Leuschner-Stil)…"
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] col-span-3"
                              />
                              {/* Split-Toggle nur, wenn echte Material-Komponente vorhanden */}
                              {p.material > 0 && dec.newCat !== "MAT" && (
                                <label className="col-span-3 flex items-center gap-2 text-[12px] text-ink py-1">
                                  <input
                                    type="checkbox"
                                    checked={dec.splitMaterial}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setDec(key, {
                                        splitMaterial: on,
                                        matNewId:   on && !dec.matNewId   ? nextFreeId("MAT", positions) : dec.matNewId,
                                        matNewName: on && !dec.matNewName ? suggestMaterialName(p.name)  : dec.matNewName,
                                      });
                                    }}
                                  />
                                  <span className="font-bold">Arbeit + Material splitten</span>
                                  <span className="text-ink-mute">→ Auflage „Material liefern" wird automatisch verknüpft</span>
                                </label>
                              )}
                              {dec.splitMaterial && p.material > 0 && (
                                <>
                                  <div className="col-span-3 text-[10.5px] text-ink-mute uppercase tracking-wider pt-1">
                                    📦 Material-Folgeposition (Cat MAT)
                                  </div>
                                  <input
                                    type="text"
                                    value="MAT"
                                    disabled
                                    className="bg-bg-1 border border-steel rounded px-2 py-1 text-[12.5px] text-ink-mute font-mono"
                                  />
                                  <input
                                    type="text"
                                    value={dec.matNewId}
                                    onChange={(e) => setDec(key, { matNewId: e.target.value.toUpperCase() })}
                                    className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] font-mono"
                                  />
                                  <input
                                    type="text"
                                    value={dec.matNewName}
                                    onChange={(e) => setDec(key, { matNewName: e.target.value })}
                                    placeholder="Material-Position…"
                                    className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] col-span-1"
                                  />
                                  <div className="col-span-3 text-[10.5px] text-emerald-700 tabular-nums">
                                    {dec.newCat}-Arbeit: {(adjustWage(p.wage, p.hoursPerUnit) + p.plant).toFixed(2)} €
                                    {" + "}MAT: {p.material.toFixed(2)} €
                                    {" = "}{(adjustWage(p.wage, p.hoursPerUnit) + p.plant + p.material).toFixed(2)} €/{p.unit ?? "Eh."}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          {dec.action === "auflage" && (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <span className="text-[10.5px] text-ink-mute uppercase tracking-wider block mb-0.5">An Hauptposition</span>
                                <select
                                  value={dec.auflageBaseLvId ?? ""}
                                  onChange={(e) => setDec(key, { auflageBaseLvId: e.target.value || null })}
                                  className="w-full bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                                >
                                  <option value="">— Hauptposition wählen —</option>
                                  {positions.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.id} · {x.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <span className="text-[10.5px] text-ink-mute uppercase tracking-wider block mb-0.5">Auflagen-Schlüssel</span>
                                <select
                                  value={dec.auflageKey}
                                  onChange={(e) => {
                                    const newKey = e.target.value as OptionKey;
                                    const cat = OPTION_KEYS.find((k) => k.key === newKey)!.defaultCat;
                                    setDec(key, {
                                      auflageKey:       newKey,
                                      auflageFollowCat: cat,
                                      auflageFollowId:  nextFreeId(cat, positions),
                                    });
                                  }}
                                  className="w-full bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                                >
                                  {OPTION_KEYS.map((o) => (
                                    <option key={o.key} value={o.key}>{o.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <span className="text-[10.5px] text-ink-mute uppercase tracking-wider block mb-0.5">Folge-Kategorie</span>
                                <select
                                  value={dec.auflageFollowCat}
                                  onChange={(e) => setDec(key, {
                                    auflageFollowCat: e.target.value,
                                    auflageFollowId:  nextFreeId(e.target.value, positions),
                                  })}
                                  className="w-full bg-white border border-steel rounded px-2 py-1 text-[12.5px]"
                                >
                                  {LV_CAT_ORDER.map((c) => (
                                    <option key={c} value={c}>{c} · {LV_CATEGORIES[c].label}</option>
                                  ))}
                                </select>
                              </div>
                              <input
                                type="text"
                                value={dec.auflageFollowId}
                                onChange={(e) => setDec(key, { auflageFollowId: e.target.value.toUpperCase() })}
                                title="Folge-LV-ID"
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] font-mono"
                              />
                              <input
                                type="text"
                                value={dec.auflageFollowName}
                                onChange={(e) => setDec(key, { auflageFollowName: e.target.value })}
                                placeholder="Folge-Position (Leuschner-Stil)"
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] col-span-2"
                              />
                              <input
                                type="text"
                                value={dec.auflageLabel}
                                onChange={(e) => setDec(key, { auflageLabel: e.target.value })}
                                placeholder="Auflage-Anzeige-Label (optional)"
                                className="bg-white border border-steel rounded px-2 py-1 text-[12.5px] col-span-2"
                              />
                            </div>
                          )}
                          {dec.action === "skip" && (
                            <div className="text-ink-mute italic text-[12px]">— wird übersprungen —</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Apply-Bar */}
            <div className="flex flex-col lg:flex-row items-center gap-3 lg:gap-4">
              <div className="text-[12.5px] font-sans text-ink-mute flex-1">
                {Array.from(decisions.values()).filter(d => d.action === "update").length} Updates,{" "}
                {Array.from(decisions.values()).filter(d => d.action === "create").length} Neue Hauptpos.,{" "}
                {Array.from(decisions.values()).filter(d => d.action === "auflage").length} Auflagen,{" "}
                {Array.from(decisions.values()).filter(d => d.action === "skip").length} ignoriert.
              </div>
              {applyResult && (
                <div className="text-[13px] font-sans text-emerald-700 font-bold">
                  ✓ {applyResult.updated} aktualisiert · {applyResult.created} neu · {applyResult.auflagen} Auflagen · {applyResult.skipped} übersprungen
                </div>
              )}
              {applyError && (
                <div className="text-[13px] font-sans text-red-700">
                  {applyError}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setParsed(null); setDecisions(new Map()); setApplyResult(null); }}
                className="border border-steel bg-white text-ink px-4 py-2 rounded-lg font-sans font-bold text-[13px] hover:bg-bg-1"
              >
                Andere Datei
              </button>
              <button
                type="button"
                disabled={applying || applyResult !== null}
                onClick={apply}
                className="bg-copper text-white px-5 py-2 rounded-lg font-sans font-bold text-[13px] hover:opacity-90 disabled:opacity-50"
              >
                {applying ? "Übernehme…" : applyResult ? "Erledigt" : "Übernehmen"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
