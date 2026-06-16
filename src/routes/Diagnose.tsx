import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BackButton from "../components/BackButton";
import { useRealtime, useRefreshOnAuth, useRefreshOnVisible } from "../lib/realtime";
import { listDiagEvents, buildPatterns, type DiagEvent, type DiagLevel } from "../lib/diag";

/* ────────────────────────────────────────────────────────────────────────
   Diagnose · System-Fehler & Timeouts
   Sub-Tabs: 01 Muster & Health (verdichtete Erkennung) · 02 Live-Log (roh).
   Daten aus diag_events (Admin-only via RLS), live nachgeladen.
   ──────────────────────────────────────────────────────────────────────── */

type TabKey = "health" | "log";
const PATTERN_THRESHOLD = 3; // ab so vielen gleichartigen in 24 h = aktives Muster

const LEVEL_LABEL: Record<DiagLevel, string> = {
  timeout: "Timeout", error: "Fehler", crash: "Crash", warn: "Warnung", info: "Info",
};
function levelDot(level: DiagLevel): string {
  return level === "crash" || level === "error" ? "bg-rust"
    : level === "timeout" || level === "warn" ? "bg-amber"
    : "bg-steel";
}
function levelBadge(level: DiagLevel): string {
  return level === "crash" ? "bg-rust text-white"
    : level === "error" ? "bg-rust/15 text-rust"
    : level === "timeout" || level === "warn" ? "bg-amber/20 text-amber-deep"
    : "bg-steel/20 text-ink-2";
}

function relTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return `vor ${d} T`;
}
function fullTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const TABS: { key: TabKey; num: string; label: string }[] = [
  { key: "health", num: "01", label: "Muster & Health" },
  { key: "log", num: "02", label: "Live-Log" },
];

export default function Diagnose() {
  const [params, setParams] = useSearchParams();
  const rawTab = (params.get("tab") ?? "health") as TabKey;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? rawTab : "health";
  function setTab(t: TabKey) {
    const p = new URLSearchParams(params);
    if (t === "health") p.delete("tab"); else p.set("tab", t);
    setParams(p, { replace: false });
  }

  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const nowMs = Date.now();

  const refresh = useCallback(() => {
    // letzte 7 Tage, neueste zuerst
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    listDiagEvents({ sinceIso: since, limit: 500 })
      .then((rows) => { setEvents(rows); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRealtime("diag", ["diag_events"], refresh);
  useRefreshOnVisible(refresh);
  useRefreshOnAuth(refresh);

  const patterns = useMemo(() => buildPatterns(events, nowMs), [events, nowMs]);
  const activePatterns = patterns.filter((p) => p.count24h >= PATTERN_THRESHOLD);

  const since24h = nowMs - 24 * 3600 * 1000;
  const ev24 = events.filter((e) => new Date(e.ts).getTime() >= since24h);
  const kpiTotal = ev24.length;
  const kpiTimeouts = ev24.filter((e) => e.level === "timeout").length;
  const kpiUsers = new Set(ev24.map((e) => e.workerName).filter(Boolean)).size;
  const famCount = ev24.reduce((m, e) => {
    const f = e.browserFamily ?? "?"; m[f] = (m[f] ?? 0) + 1; return m;
  }, {} as Record<string, number>);
  const famTop = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0];
  const famPct = famTop && kpiTotal ? Math.round((famTop[1] / kpiTotal) * 100) : 0;

  return (
    <div className="min-h-screen safe-top safe-bottom bg-bg">
      {/* STAHL-HEADER */}
      <header className="sticky top-0 z-30 surface-steel safe-top">
        <div className="w-full max-w-[1700px] mx-auto px-5 lg:px-10 xl:px-14 pt-5 pb-0">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <BackButton />
              <span className="dd-eyebrow text-copper-bright block mt-1">System-Diagnose · live</span>
              <h1 className="font-display font-black uppercase text-2xl lg:text-3xl xl:text-4xl text-white leading-none mt-1.5">
                Diagnose
              </h1>
              <p className="font-mono text-[11.5px] mt-2 tracking-wide text-steel">
                Fehler, Crashes &amp; Timeouts automatisch erfasst · {loading ? "lädt …" : `${events.length} Ereignisse (7 Tage)`}
              </p>
            </div>
            <button
              onClick={refresh}
              className="font-mono text-[11px] tracking-wider uppercase text-steel hover:text-copper-bright transition-colors pb-1"
            >
              ↻ Aktualisieren
            </button>
          </div>
          {/* Sub-Tabs */}
          <nav className="mt-5 -mb-px flex gap-0">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-5 py-3 font-mono text-[12px] tracking-wider uppercase border-b-2 transition-colors ${
                    active ? "border-copper text-white font-bold" : "border-transparent text-steel hover:text-white"
                  }`}
                >
                  <span className={`mr-2 ${active ? "text-copper-bright" : "text-steel/70"}`}>{t.num}</span>
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="w-full max-w-[1700px] mx-auto px-5 lg:px-10 xl:px-14 py-6">
        {tab === "health" ? (
          <HealthTab
            kpiTotal={kpiTotal} kpiTimeouts={kpiTimeouts} kpiUsers={kpiUsers}
            famTop={famTop} famPct={famPct}
            activePatterns={activePatterns} otherPatterns={patterns.filter((p) => p.count24h < PATTERN_THRESHOLD)}
            loading={loading} now={nowMs}
          />
        ) : (
          <LogTab events={events} loading={loading} now={nowMs} />
        )}
      </main>
    </div>
  );
}

/* ──────── Muster & Health ──────── */
function HealthTab({ kpiTotal, kpiTimeouts, kpiUsers, famTop, famPct, activePatterns, otherPatterns, loading, now }: {
  kpiTotal: number; kpiTimeouts: number; kpiUsers: number;
  famTop?: [string, number]; famPct: number;
  activePatterns: ReturnType<typeof buildPatterns>; otherPatterns: ReturnType<typeof buildPatterns>;
  loading: boolean; now: number;
}) {
  return (
    <>
      {/* KPI-Reihe */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard c="#B91C1C" label="Ereignisse · 24 h" value={String(kpiTotal)} tone="rust" />
        <KpiCard c="#C9852F" label="davon Timeouts" value={String(kpiTimeouts)} tone="amber" />
        <KpiCard c="#15171A" label="Betroffene Nutzer" value={String(kpiUsers)} />
        <KpiCard c="#DC6E2D" label="Top-Browser · 24 h"
          value={famTop ? `${famPct}% ${famTop[0].slice(0, 4)}` : "—"} tone="copper" small />
      </div>

      {/* Health-Banner */}
      <section className="dd-card overflow-hidden mt-5" style={{ ["--c" as any]: activePatterns.length ? "#C9852F" : "#1F7A3D" }}>
        <header className="px-5 py-3.5 flex items-center gap-3 surface-steel"
          style={{ boxShadow: `inset 0 -2px 0 ${activePatterns.length ? "#C9852F" : "#1F7A3D"}` }}>
          <span className={`w-3 h-3 rounded-full ${activePatterns.length ? "bg-amber-bright" : "bg-moss-bright"}`} />
          <h2 className="font-display font-black uppercase text-sm text-white tracking-wide">
            {loading ? "lädt …" : activePatterns.length
              ? `${activePatterns.length} aktive${activePatterns.length === 1 ? "s" : ""} Muster erkannt`
              : "Keine auffälligen Muster"}
          </h2>
          <span className="ml-auto font-mono text-[10px] tracking-wider uppercase text-steel">
            Schwelle: ≥ {PATTERN_THRESHOLD} gleichartige / 24 h
          </span>
        </header>

        {activePatterns.length === 0 && !loading && (
          <p className="px-5 py-6 text-[13px] text-ink-body">
            In den letzten 24 Stunden hat sich kein Fehler-Muster über die Schwelle gehäuft. Einzelne
            Ereignisse stehen im <b>Live-Log</b>.
          </p>
        )}

        {activePatterns.map((p) => <PatternRow key={p.key} p={p} now={now} active />)}
        {otherPatterns.length > 0 && (
          <>
            <div className="px-5 pt-4 pb-1 font-mono text-[10px] tracking-wider uppercase text-ink-mute">
              Unter der Schwelle · zur Beobachtung
            </div>
            {otherPatterns.slice(0, 8).map((p) => <PatternRow key={p.key} p={p} now={now} />)}
          </>
        )}
      </section>

      <p className="mt-5 font-mono text-[10.5px] text-ink-mute leading-relaxed max-w-2xl">
        Erkennung läuft regelbasiert: gruppiert nach Fehlertyp + Browser + Nutzer, schlägt ab
        {" "}{PATTERN_THRESHOLD} gleichartigen Ereignissen in 24 h an. Keine externen Dienste — alles in unserer
        Supabase, Aufbewahrung 30 Tage.
      </p>
    </>
  );
}

function PatternRow({ p, now, active }: { p: ReturnType<typeof buildPatterns>[number]; now: number; active?: boolean }) {
  return (
    <div className="px-5 py-4 border-t border-ink/8">
      <div className="flex items-start gap-3">
        <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${levelDot(p.level)}`} />
        <div className="min-w-0 flex-1">
          <div className="font-display font-black text-[15px] text-ink leading-tight">
            {LEVEL_LABEL[p.level]}: {p.label} {p.browserFamily !== "unbekannt" && (
              <span className="font-mono text-[11px] font-normal text-ink-2">· {p.browserFamily}</span>
            )}
          </div>
          <div className="font-mono text-[11.5px] text-ink-body mt-0.5 break-words">{p.sampleMessage}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`font-display font-black text-2xl leading-none tabular-nums ${active ? "text-rust" : "text-amber-deep"}`}>
            {p.count24h}×
          </div>
          <div className="font-mono text-[9px] tracking-wider uppercase text-ink-mute mt-0.5">24 h</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5 pl-6">
        {p.workers.map((w) => (
          <span key={w} className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-steel-line text-ink-2 bg-white">
            {w}
          </span>
        ))}
        {p.routes.slice(0, 3).map((r) => (
          <span key={r} className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-steel-line/60 text-ink-mute bg-bg-2">
            {r}
          </span>
        ))}
        <span className="font-mono text-[10px] px-2 py-0.5 rounded-full text-ink-mute">
          gesamt {p.total} · zuletzt {relTime(p.lastTs, now)}
        </span>
      </div>
    </div>
  );
}

function KpiCard({ c, label, value, tone, small }: {
  c: string; label: string; value: string; tone?: "rust" | "amber" | "copper"; small?: boolean;
}) {
  const fg = tone === "rust" ? "text-rust" : tone === "amber" ? "text-amber-deep" : tone === "copper" ? "text-copper" : "text-ink";
  return (
    <div className="dd-card px-4 py-3.5" style={{ ["--c" as any]: c }}>
      <div className="font-mono text-[9.5px] tracking-wider uppercase text-ink-mute">{label}</div>
      <div className={`font-display font-black leading-none tabular-nums mt-2 ${small ? "text-lg" : "text-3xl"} ${fg}`}>{value}</div>
    </div>
  );
}

/* ──────── Live-Log ──────── */
type Filter = "all" | DiagLevel | "ff";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "timeout", label: "Timeouts" },
  { key: "error", label: "Fehler" },
  { key: "crash", label: "Crashes" },
  { key: "ff", label: "nur Firefox" },
];

function LogTab({ events, loading, now }: { events: DiagEvent[]; loading: boolean; now: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "ff") return e.browserFamily === "Firefox";
    return e.level === filter;
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="font-mono text-[10px] tracking-wider uppercase text-ink-mute mr-1">Filter</span>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`font-mono text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
              filter === f.key ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-steel-line hover:border-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="dd-card overflow-hidden" style={{ ["--c" as any]: "#A9AEB3" }}>
        {loading && <div className="px-4 py-6 text-[13px] text-ink-mute">lädt …</div>}
        {!loading && shown.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-ink-mute">
            Keine Ereignisse in diesem Filter. {events.length === 0 && "Noch nichts protokolliert — gut so."}
          </div>
        )}
        {shown.map((e) => {
          const open = openId === e.id;
          return (
            <div key={e.id} className="border-b border-ink/8 last:border-0">
              <button
                onClick={() => setOpenId(open ? null : e.id)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg-2/50"
              >
                <span className={`font-mono text-[9.5px] font-bold tracking-wider uppercase px-2 py-1 rounded ${levelBadge(e.level)}`}>
                  {LEVEL_LABEL[e.level]}
                </span>
                {e.browserFamily && (
                  <span className={`font-mono text-[9.5px] px-2 py-1 rounded border ${
                    e.browserFamily === "Firefox" ? "bg-amber/10 text-amber-deep border-amber/40" : "bg-bg-2 text-ink-2 border-steel-line/60"
                  }`}>
                    {e.browser ?? e.browserFamily}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-bold text-[13.5px] text-ink truncate">{e.label || "(ohne Label)"}</span>
                  <span className="block font-mono text-[11px] text-ink-body truncate">{e.message}</span>
                </span>
                <span className="font-mono text-[10px] text-ink-mute whitespace-nowrap">{relTime(e.ts, now)}</span>
              </button>
              {open && (
                <div className="px-4 pb-4 bg-bg-3/40">
                  <dl className="grid grid-cols-[110px_1fr] gap-y-1 gap-x-3 font-mono text-[11px] pt-3">
                    <dt className="text-ink-mute">Zeitpunkt</dt><dd className="text-ink-body">{fullTime(e.ts)}</dd>
                    <dt className="text-ink-mute">Nutzer</dt><dd className="text-ink-body">{e.workerName ?? "—"}</dd>
                    <dt className="text-ink-mute">Route</dt><dd className="text-ink-body">{e.route ?? "—"}</dd>
                    <dt className="text-ink-mute">Browser</dt><dd className="text-ink-body">{e.browser ?? "—"} · {e.os ?? "—"}</dd>
                    <dt className="text-ink-mute">Verbindung</dt><dd className="text-ink-body">{e.online == null ? "—" : e.online ? "online" : "offline"}</dd>
                    {e.appVersion && (<><dt className="text-ink-mute">Version</dt><dd className="text-ink-body">{e.appVersion}</dd></>)}
                  </dl>
                  {e.context && Object.keys(e.context).length > 0 && (
                    <pre className="mt-3 bg-[#1A1C1E] text-[#cfd3d7] font-mono text-[10.5px] leading-relaxed p-3 rounded-lg overflow-x-auto border-l-[3px] border-rust whitespace-pre-wrap break-words">
{JSON.stringify(e.context, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
