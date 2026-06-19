import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { currentUser } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { listOpenAlerts, acknowledgeAlert, subscribeToAlerts, type DiagAlert } from "../lib/diag";

/* ────────────────────────────────────────────────────────────────────────
   App-Wächter-Banner (Frühwarnung · Ebene 2)
   Zeigt oben einen auffälligen Hinweis, sobald sich Timeouts häufen — damit
   so etwas nie wieder wochenlang unbemerkt nur im Diagnose-Log steht.
   Nur für Admins. Speist sich aus diag_alerts (serverseitig in /api/log
   ausgelöst) und aktualisiert sich live (Realtime).
   ──────────────────────────────────────────────────────────────────────── */

export default function DiagAlertBanner() {
  const [isAdmin, setIsAdmin] = useState<boolean>(currentUser()?.isAdmin === true);
  const [alerts, setAlerts] = useState<DiagAlert[]>([]);

  // Admin-Status auch nach (verzögertem) Login mitbekommen
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setIsAdmin(currentUser()?.isAdmin === true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Offene Alarme laden + auf neue lauschen
  useEffect(() => {
    if (!isAdmin) { setAlerts([]); return; }
    let cancelled = false;
    listOpenAlerts().then((a) => { if (!cancelled) setAlerts(a); });
    const unsub = subscribeToAlerts((a) => {
      setAlerts((prev) => prev.some((x) => x.id === a.id) ? prev : [a, ...prev]);
    });
    return () => { cancelled = true; unsub(); };
  }, [isAdmin]);

  async function dismiss(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id)); // optimistisch
    try { await acknowledgeAlert(id); } catch { /* Realtime/Reload korrigiert */ }
  }

  if (!isAdmin || alerts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex flex-col">
      {alerts.map((a) => (
        <div
          key={a.id}
          role="alert"
          className="flex items-center gap-3 px-4 py-2.5 text-white border-b border-black/20"
          style={{ background: "linear-gradient(180deg,#C0392B,#96281B)", boxShadow: "0 6px 18px -8px rgba(0,0,0,.6)" }}
        >
          <span className="text-lg leading-none flex-shrink-0" aria-hidden>⚠</span>
          <div className="flex-1 min-w-0 text-[13px] leading-snug">
            <span className="font-bold">App-Wächter: {a.title}.</span>{" "}
            <span className="opacity-90">{a.message}</span>
          </div>
          <Link
            to="/admin/diagnose"
            className="flex-shrink-0 font-mono text-[11px] uppercase tracking-wider bg-white/15 hover:bg-white/25 border border-white/30 rounded px-2.5 py-1 transition-colors"
          >
            Diagnose
          </Link>
          <button
            onClick={() => dismiss(a.id)}
            aria-label="Hinweis quittieren"
            title="Quittieren"
            className="flex-shrink-0 w-7 h-7 grid place-items-center rounded bg-white/10 hover:bg-white/20 border border-white/25 text-[13px]"
          >✕</button>
        </div>
      ))}
    </div>
  );
}
