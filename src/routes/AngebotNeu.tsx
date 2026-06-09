import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  listCards, type PipelineCard, type PipelinePosition
} from "../lib/pipeline";
import { sevdeskCreateOrder, sevdeskNextOrderNumber } from "../lib/sevdesk";
import { supabase, isBackendConnected } from "../lib/supabase";
import { updateInquiry, appendNote } from "../lib/inquiries";

/* ────────────────────────────────────────────────────────────────────────
   Angebot-Wizard · macht aus einer „Anfrage"-Karte ein „Angebot"
   1) Positionen-Tabelle befüllen (Vorlagen + Freitext)
   2) Speichern → pipeline_card.stage = Angebot, positions = die Tabelle
   3) Optional: Push zu sevDesk (legt Order an, schreibt sevdesk_order_id
      und AN-Nummer zurück auf die Karte)
   ──────────────────────────────────────────────────────────────────────── */

interface Row {
  name: string;
  quantity: number;
  unity: string;       // Display-Label (Stk/m²/Std/...)
  unityId: string;     // sevDesk-Unity-ID
  price: number;
}

const UNITY_OPTIONS = [
  { id: "1",  label: "Stk" },
  { id: "9",  label: "Std" },
  { id: "2",  label: "m²" },
  { id: "3",  label: "m" },
  { id: "6",  label: "lfm" },
  { id: "8",  label: "m³" },
  { id: "7",  label: "pausch." },
  { id: "4",  label: "kg" },
  { id: "5",  label: "t" },
  { id: "10", label: "km" },
] as const;

interface Template {
  label: string;
  rows: Row[];
}

const TEMPLATES: Template[] = [
  {
    label: "Doppelstabmattenzaun · Basis",
    rows: [
      { name: "Doppelstabmatte Schwer 183x250cm anthrazit", quantity: 0, unity: "Stk", unityId: "1", price: 65 },
      { name: "Pfosten 60x40x2400mm anthrazit",             quantity: 0, unity: "Stk", unityId: "1", price: 23.15 },
      { name: "Zaunfundamente herstellen",                   quantity: 0, unity: "Stk", unityId: "1", price: 40 },
      { name: "Remix Estrichbeton",                          quantity: 0, unity: "Stk", unityId: "1", price: 5.46 },
      { name: "Doppelstabmattenzaun aufbauen",               quantity: 0, unity: "Std", unityId: "9", price: 60 },
      { name: "Transport Fremd LKW",                         quantity: 1, unity: "pausch.", unityId: "7", price: 24.50 },
    ],
  },
  {
    label: "Pflasterarbeiten · Hofeinfahrt",
    rows: [
      { name: "Pflastersteine setzen",                       quantity: 0, unity: "m²", unityId: "2", price: 55 },
      { name: "Tragschicht herstellen",                      quantity: 0, unity: "m²", unityId: "2", price: 18 },
      { name: "Randsteine setzen",                            quantity: 0, unity: "m", unityId: "3", price: 25 },
      { name: "Aushub abfahren",                              quantity: 0, unity: "m³", unityId: "8", price: 32 },
    ],
  },
  {
    label: "Erdarbeiten · Bagger 22to",
    rows: [
      { name: "Baggerarbeiten Kettenbagger 22 to",           quantity: 0, unity: "Std", unityId: "9", price: 110 },
      { name: "Transport Kette/Pendel",                       quantity: 1, unity: "pausch.", unityId: "7", price: 250 },
      { name: "Mutterboden abtragen",                         quantity: 0, unity: "m³", unityId: "8", price: 8 },
    ],
  },
];

function fmtMoney(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Mapt eine Mengen-Einheit aus der Anfrage auf {unity, unityId} für sevDesk. */
function unityFromEinheit(e?: string): { unity: string; unityId: string } {
  const norm = (e || "").toLowerCase().trim();
  if (norm === "m²" || norm === "qm" || norm === "m2") return { unity: "m²", unityId: "2" };
  if (norm === "m³" || norm === "cbm" || norm === "m3") return { unity: "m³", unityId: "8" };
  if (norm === "lfm") return { unity: "lfm", unityId: "6" };
  if (norm === "m") return { unity: "m", unityId: "3" };
  if (norm === "std" || norm === "stunde" || norm === "stunden" || norm === "h") return { unity: "Std", unityId: "9" };
  if (norm === "t" || norm === "tonne" || norm === "tonnen") return { unity: "t", unityId: "5" };
  if (norm === "kg") return { unity: "kg", unityId: "4" };
  if (norm === "km") return { unity: "km", unityId: "10" };
  if (norm === "pausch." || norm === "pauschal") return { unity: "pausch.", unityId: "7" };
  return { unity: "Stk", unityId: "1" };
}

/** Mapt eine erkannte Leistung aus der Anfrage auf eine Wizard-Row.
 *  Materialien werden als Suffix im Namen sichtbar gemacht (z.B.
 *  "Einfassung Beete (Naturstein, Betonrandsteine)") — der User kann später
 *  beim Klär-Rückruf entscheiden. Erste Menge bestimmt quantity+unity. */
function leistungToRow(l: {
  name: string;
  mengen?: { wert: string; einheit?: string; was?: string }[];
  materialien?: { name: string; spec?: string }[];
}): Row {
  const menge = l.mengen?.[0];
  const matSuffix = l.materialien?.length
    ? ` (${l.materialien.map((m) => (m.spec ? `${m.name} ${m.spec}` : m.name)).join(", ")})`
    : "";
  const { unity, unityId } = unityFromEinheit(menge?.einheit);
  const quantity = menge ? parseFloat((menge.wert || "1").replace(",", ".")) || 1 : 1;
  return {
    name: l.name + matSuffix,
    quantity,
    unity,
    unityId,
    price: 0,
  };
}

export default function AngebotNeu() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<PipelineCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [headText, setHeadText] = useState(
    "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes freibleibendes Angebot.\n"
  );
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  // S5: Quelle der Vorbefüllung — 'positions' (bereits gespeicherte Wizard-Daten),
  // 'inquiry' (frisch aus der zugehörigen Anfrage gezogen) oder null.
  const [prefillSource, setPrefillSource] = useState<"positions" | "inquiry" | null>(null);
  const [inquirySummary, setInquirySummary] = useState<{
    leistungenCount: number;
    materialienCount: number;
    hasAlternatives: boolean;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cards = await listCards({ archived: false });
        const found = cards.find((c) => c.id === cardId);
        if (!found) { setError("Karte nicht gefunden"); setLoading(false); return; }
        setCard(found);
        if (found.positions && found.positions.length > 0) {
          setRows(found.positions.map((p) => ({
            name: p.name,
            quantity: parseFloat(String(p.quantity).replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
            unity: String(p.quantity).match(/[a-zA-Z²³]+/)?.[0] ?? "Stk",
            unityId: "1",
            price: parseFloat(p.unitPrice.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
          })));
          setPrefillSource("positions");
        } else if (isBackendConnected() && supabase) {
          // S5: noch keine Positionen → versuche aus der verknüpften Anfrage zu ziehen
          const sb: any = supabase;
          const { data: inq } = await sb
            .from("inquiries")
            .select("parsed_json")
            .eq("pipeline_card_id", found.id)
            .limit(1)
            .maybeSingle();
          const leistungen = (inq?.parsed_json as any)?.leistungen as
            | { name: string; mengen?: any[]; materialien?: any[] }[]
            | undefined;
          if (Array.isArray(leistungen) && leistungen.length > 0) {
            setRows(leistungen.map(leistungToRow));
            const materialienCount = leistungen.reduce((sum, l) => sum + (l.materialien?.length ?? 0), 0);
            const hasAlternatives = leistungen.some((l) =>
              (l.materialien ?? []).some((m: any) => /alternativ/i.test(m.note ?? ""))
            );
            setInquirySummary({ leistungenCount: leistungen.length, materialienCount, hasAlternatives });
            setPrefillSource("inquiry");
          }
        }
      } catch (e: any) { setError(e?.message ?? "Fehler beim Laden"); }
      finally { setLoading(false); }
    })();
  }, [cardId]);

  const sumNet = useMemo(() => rows.reduce((t, r) => t + r.quantity * r.price, 0), [rows]);

  function addRow() {
    setRows([...rows, { name: "", quantity: 1, unity: "Stk", unityId: "1", price: 0 }]);
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function applyTemplate(t: Template) {
    setRows([...rows, ...t.rows.map((r) => ({ ...r }))]);
  }

  /** Schließt den Kreis Anfrage → Angebot: setzt inquiry.status + Verlaufseintrag. */
  async function closeInquiryLink(cardId: string, note: string) {
    if (!isBackendConnected() || !supabase) return;
    const sb: any = supabase;
    const { data } = await sb
      .from("inquiries")
      .select("id")
      .eq("pipeline_card_id", cardId)
      .limit(1);
    const inqId = data?.[0]?.id;
    if (!inqId) return;
    try {
      await updateInquiry(inqId, { status: "wurde_zu_angebot" });
      await appendNote(inqId, { kind: "system", text: note });
    } catch { /* silent — Hauptaktion war schon erfolgreich */ }
  }

  async function saveAsAngebot() {
    if (!card || !isBackendConnected() || !supabase) return;
    setSaving(true); setError(null);
    try {
      const positions: PipelinePosition[] = rows.map((r, i) => ({
        pos: i + 1,
        name: r.name,
        quantity: `${r.quantity} ${r.unity}`.trim(),
        unitPrice: r.price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        sum: r.quantity * r.price,
      }));
      const sb: any = supabase;
      const { error: upErr } = await sb
        .from("pipeline_cards")
        .update({
          stage: "Angebot",
          positions,
          value_eur: sumNet,
          plan_eur: sumNet,
          open_points: "Entwurf · noch nicht versendet",
        })
        .eq("id", card.id);
      if (upErr) throw upErr;
      await closeInquiryLink(card.id, `Angebot app-intern angelegt · ${rows.length} Positionen · ${sumNet.toFixed(2)} €`);
      navigate("/admin/angebote");
    } catch (e: any) { setError(e?.message ?? "Speichern fehlgeschlagen"); }
    finally { setSaving(false); }
  }

  async function pushToSevdesk() {
    if (!card || !isBackendConnected() || !supabase) return;
    setPushing(true); setError(null);
    try {
      // Kunde via customer_id ermitteln → sevdesk_contact_id
      const sb2: any = supabase;
      const { data: cust, error: cErr } = await sb2
        .from("pipeline_cards")
        .select("customer_id, customers(sevdesk_contact_id)")
        .eq("id", card.id)
        .single();
      if (cErr) throw cErr;
      const sevContactId = (cust as any)?.customers?.sevdesk_contact_id;
      if (!sevContactId) throw new Error("Kunde ist nicht mit sevDesk verknüpft. Bitte erst Kunden anlegen lassen.");

      const orderNumber = await sevdeskNextOrderNumber();
      const result = await sevdeskCreateOrder({
        contactId: sevContactId,
        orderNumber,
        header: `Angebot ${orderNumber}`,
        headText,
        positions: rows.map((r) => ({
          name: r.name, quantity: r.quantity, price: r.price, unityId: r.unityId,
        })),
      });

      const positions: PipelinePosition[] = rows.map((r, i) => ({
        pos: i + 1, name: r.name,
        quantity: `${r.quantity} ${r.unity}`.trim(),
        unitPrice: r.price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        sum: r.quantity * r.price,
      }));
      const sb: any = supabase;
      const { error: upErr } = await sb
        .from("pipeline_cards")
        .update({
          stage: "Angebot",
          positions,
          value_eur: sumNet, plan_eur: sumNet,
          doc_number: result.orderNumber,
          sevdesk_order_id: result.id,
          open_points: "Entwurf · noch nicht versendet",
        })
        .eq("id", card.id);
      if (upErr) throw upErr;
      await closeInquiryLink(card.id, `Angebot ${result.orderNumber} in sevDesk angelegt`);
      navigate("/admin/angebote");
    } catch (e: any) { setError(e?.message ?? "sevDesk-Push fehlgeschlagen"); }
    finally { setPushing(false); }
  }

  return (
    <div className="min-h-screen flex flex-col safe-top">
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4">
        <button
          onClick={() => navigate("/admin/angebote")}
          className="dd-eyebrow text-steel hover:text-copper-bright transition-colors mb-2 flex items-center gap-2"
        >
          <span aria-hidden>←</span><span>Zurück zum Board</span>
        </button>
        <span className="dd-eyebrow text-copper-bright block">Vertrieb · Wizard</span>
        <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1">
          Angebot erstellen
        </h1>
        {card && (
          <span className="font-mono text-[11.5px] mt-1.5 block tracking-wide text-steel">
            Für {card.customerName}{card.place ? ` · ${card.place}` : ""}
          </span>
        )}
      </header>

      {error && (
        <div className="mx-4 lg:mx-8 mt-3 px-4 py-2.5 bg-rust/10 border border-rust/35 rounded-lg text-[13px] text-rust font-sans">
          {error}
        </div>
      )}

      <main className="flex-1 px-4 lg:px-8 py-5 max-w-[1180px] w-full mx-auto">
        {loading ? (
          <div className="font-mono text-ink-2 text-[13px]">Wird geladen …</div>
        ) : !card ? null : (
          <div className="space-y-5">
            {card.description && (
              <div className="bg-bg-2 border border-steel-line/45 rounded-lg p-4">
                <span className="dd-eyebrow text-ink-2 block mb-1">Anfrage-Beschreibung</span>
                <p className="font-sans text-[13.5px] text-ink">{card.description}</p>
                {card.openPoints && (
                  <p className="font-mono text-[11.5px] text-ink-2 mt-2">Offene Punkte: {card.openPoints}</p>
                )}
              </div>
            )}

            {/* S5: Hinweis wenn aus Anfrage vorbefüllt */}
            {prefillSource === "inquiry" && inquirySummary && (
              <div className="bg-copper/10 border border-copper/40 rounded-lg p-4">
                <div className="font-display font-extrabold uppercase text-[12px] text-copper tracking-wide mb-1.5">
                  ✓ {inquirySummary.leistungenCount} {inquirySummary.leistungenCount === 1 ? "Position" : "Positionen"} aus der Anfrage übernommen
                </div>
                <p className="font-sans text-[12.5px] text-ink leading-relaxed">
                  Leistungs-Namen und Mengen kommen aus dem strukturierten Parser-Ergebnis. <b>Preise bitte eintragen, Mengen überprüfen.</b> Vorlagen oben kannst du zusätzlich draufpacken (z.B. Pflaster-Template für Tragschicht/Randsteine/Aushub).
                </p>
                {inquirySummary.materialienCount > 0 && (
                  <p className="font-sans text-[12px] text-ink-2 mt-1.5">
                    <b className="text-copper">{inquirySummary.materialienCount}</b> Material-Wunsch{inquirySummary.materialienCount === 1 ? "" : "/-wünsche"} in den Positionsnamen vermerkt
                    {inquirySummary.hasAlternatives && <span className="text-amber"> · enthält Alternativ-Auswahl (z.B. „Naturstein oder Betonrandsteine"), beim Kunden klären</span>}.
                  </p>
                )}
              </div>
            )}

            {/* Templates */}
            <div>
              <span className="dd-eyebrow text-ink-2 block mb-1.5">Vorlage einfügen</span>
              <div className="flex gap-2 flex-wrap">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => applyTemplate(t)}
                    className="btn-ghost !min-h-[38px] !px-3 text-[11.5px]"
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Positionen-Tabelle */}
            <div className="bg-white border border-steel-line/45 rounded-lg overflow-x-auto">
              <table className="w-full text-[12.5px] font-sans">
                <thead className="surface-steel">
                  <tr>
                    <th className="text-left px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide w-[40px]">#</th>
                    <th className="text-left px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide">Bezeichnung</th>
                    <th className="text-right px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide w-[80px]">Menge</th>
                    <th className="text-left px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide w-[90px]">Einheit</th>
                    <th className="text-right px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide w-[110px]">EP netto</th>
                    <th className="text-right px-2 py-2 font-display uppercase text-[10.5px] text-white tracking-wide w-[130px]">Summe</th>
                    <th className="w-[36px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 font-mono text-[11.5px] text-ink-2">
                        Noch keine Positionen. Vorlage wählen oder „+ Position" klicken.
                      </td>
                    </tr>
                  ) : rows.map((r, i) => (
                    <tr key={i} className="border-t border-steel-line/35">
                      <td className="px-2 py-1.5 font-mono text-[11px] text-ink-2">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.name}
                          onChange={(e) => updateRow(i, { name: e.target.value })}
                          className="w-full bg-transparent border-0 text-[12.5px] focus:outline-none"
                          placeholder="Position …"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={r.quantity}
                          onChange={(e) => updateRow(i, { quantity: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-transparent border-0 text-[12.5px] text-right focus:outline-none font-mono"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={r.unityId}
                          onChange={(e) => {
                            const opt = UNITY_OPTIONS.find((o) => o.id === e.target.value);
                            updateRow(i, { unityId: e.target.value, unity: opt?.label ?? "Stk" });
                          }}
                          className="w-full bg-transparent border-0 text-[12px] focus:outline-none font-mono"
                        >
                          {UNITY_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={r.price}
                          onChange={(e) => updateRow(i, { price: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-transparent border-0 text-[12.5px] text-right focus:outline-none font-mono"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[12.5px] tabular-nums">
                        {fmtMoney(r.quantity * r.price)}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button onClick={() => removeRow(i)} className="text-ink-2 hover:text-rust text-[14px]" title="Position entfernen">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-bg-2 font-bold">
                  <tr>
                    <td colSpan={5} className="px-2 py-2.5 text-right font-display uppercase text-[12px]">Summe netto</td>
                    <td className="px-2 py-2.5 text-right font-mono text-[14px] tabular-nums text-copper">{fmtMoney(sumNet)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div className="px-3 py-2 border-t border-steel-line/45">
                <button onClick={addRow} className="btn-ghost !min-h-[36px] !px-3 text-[11.5px]">
                  + Position
                </button>
              </div>
            </div>

            {/* Briefkopf-Text für sevDesk */}
            <div>
              <span className="dd-eyebrow text-ink-2 block mb-1.5">Anschreiben (für sevDesk-PDF)</span>
              <textarea
                value={headText}
                onChange={(e) => setHeadText(e.target.value)}
                className="w-full min-h-[100px] bg-bg-2 border-[1.5px] border-steel-line/45 rounded-lg p-3 text-[13px] font-sans text-ink focus:outline-none focus:border-copper resize-y"
              />
            </div>

            {/* Aktionen */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={saveAsAngebot}
                disabled={saving || pushing || rows.length === 0}
                className="btn-ghost !min-h-[48px] !px-4 text-[12px] disabled:opacity-50"
                title="Nur in der App speichern, noch nicht in sevDesk anlegen"
              >
                {saving ? "Speichere …" : "Nur App-intern speichern"}
              </button>
              <button
                onClick={pushToSevdesk}
                disabled={saving || pushing || rows.length === 0}
                className="btn-primary !min-h-[48px] text-[13px] disabled:opacity-50"
              >
                {pushing ? "Pushe zu sevDesk …" : "→ Angebot in sevDesk anlegen"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
