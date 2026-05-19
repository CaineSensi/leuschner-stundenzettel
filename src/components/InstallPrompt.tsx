import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "leuschner.install.dismissed";

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    // Bereits installiert? (PWA läuft im Standalone-Modus)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    // iOS-Erkennung (Safari hat kein beforeinstallprompt)
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    if (ios) {
      setIsIOS(true);
      // Erst nach 5 Sekunden zeigen — User soll zuerst die App sehen
      const t = setTimeout(() => setShow(true), 5000);
      return () => clearTimeout(t);
    }

    // Android Chrome / Edge: beforeinstallprompt event
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(DISMISS_KEY, "1");
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:max-w-sm z-50 bg-bg-2 border border-copper rounded-2xl shadow-2xl p-5 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="text-3xl flex-shrink-0">📱</div>
        <div className="flex-1 min-w-0">
          <div className="h-mono text-copper text-[13px]">App auf den Home-Bildschirm</div>
          <h3 className="font-display font-extrabold text-base mt-0.5 uppercase tracking-tight">
            Schneller starten
          </h3>
          {isIOS ? (
            <p className="text-[12px] text-paper/70 mt-1.5 leading-snug">
              Safari unten: <strong>Teilen-Symbol</strong> (Quadrat mit Pfeil) → <strong>„Zum Home-Bildschirm"</strong> → Hinzufügen
            </p>
          ) : (
            <p className="text-[12px] text-paper/70 mt-1.5 leading-snug">
              Mit einem Tap auf den Home-Bildschirm, sieht aus wie eine native App, läuft offline.
            </p>
          )}
          <div className="flex gap-2 mt-3">
            {!isIOS && deferred && (
              <button onClick={install} className="btn-primary text-[13px] flex-1">
                Installieren
              </button>
            )}
            <button onClick={dismiss} className="btn-ghost text-[12px]">
              {isIOS ? "Verstanden" : "Später"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
