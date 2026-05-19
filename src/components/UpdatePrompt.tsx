import { useEffect, useState } from "react";
// @ts-ignore — virtual module von vite-plugin-pwa
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Zeigt einen Banner unten an, wenn eine neue PWA-Version
 * verfügbar ist. Klick aktualisiert die App ohne dass der
 * User die Kachel löschen + neu installieren muss.
 *
 * Zusätzlich pollen wir alle 60 s ob ein neuer Service Worker
 * verfügbar ist, damit das auch bei aktiven Sessions funktioniert.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return;
      // Beim Tab-Wechsel wieder in den Vordergrund: prüfe nach Updates
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      // Plus: alle 60s im Hintergrund prüfen
      const interval = setInterval(() => {
        registration.update().catch(() => {});
      }, 60_000);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
        clearInterval(interval);
      };
    }
  });

  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!reloading) return;
    // Sicherheits-Reload nach 3s falls updateServiceWorker hängt
    const t = setTimeout(() => window.location.reload(), 3000);
    return () => clearTimeout(t);
  }, [reloading]);

  if (!needRefresh) return null;

  return (
    <div
      role="dialog"
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md bg-copper text-bg-deep rounded-2xl shadow-2xl border border-copper-bright/40 p-4 animate-in fade-in slide-in-from-bottom-4"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔄</span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-base uppercase tracking-tight leading-none">
            Neue Version verfügbar
          </div>
          <div className="text-[12px] mt-1 leading-snug opacity-90">
            Tippe „Aktualisieren", Daten gehen nicht verloren.
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => setNeedRefresh(false)}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-bg-deep/10 text-bg-deep font-mono text-[11px] uppercase tracking-wide"
        >
          Später
        </button>
        <button
          onClick={() => { setReloading(true); updateServiceWorker(true); }}
          disabled={reloading}
          className="flex-1 px-4 py-2 rounded-lg bg-bg-deep text-copper-bright font-display font-extrabold uppercase tracking-wide text-[13px] disabled:opacity-60"
        >
          {reloading ? "Lädt …" : "Aktualisieren"}
        </button>
      </div>
    </div>
  );
}
