import { useEffect, useState } from "react";
import { currentUser } from "../lib/auth";
import {
  enableNotifications, notificationsEnabled, notificationsSupported
} from "../lib/notifications";

/**
 * Sticky Hinweis-Banner — fordert Admins auf, Browser-Push zu aktivieren.
 * Verschwindet sofort sobald Permission erteilt ist. Ohne Aktivierung
 * bleibt er auf jeder Admin-Seite sichtbar.
 */
export default function AdminPushBanner() {
  const [me, setMe] = useState(() => currentUser());
  const [ready, setReady] = useState(notificationsEnabled());
  const [activating, setActivating] = useState(false);

  // Auf Login-Wechsel reagieren
  useEffect(() => {
    const onStorage = () => setMe(currentUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!me?.isAdmin) return null;
  if (ready) return null;
  if (!notificationsSupported()) return null;

  async function activate() {
    setActivating(true);
    try {
      const ok = await enableNotifications();
      setReady(ok);
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="surface-steel sticky top-0 z-40">
      <div className="px-5 lg:px-10 xl:px-16 py-2.5 flex items-center gap-4 flex-wrap">
        <span className="text-xl flex-shrink-0">🔔</span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-black text-[14px] uppercase tracking-tight leading-none text-white">
            Browser-Push noch nicht aktiv
          </div>
          <div className="h-mono text-[10px] tracking-widest mt-1 text-white/65">
            Du wirst sonst nicht informiert wenn jemand Stunden sendet oder einen Tag offen lässt.
          </div>
        </div>
        <button
          onClick={activate}
          disabled={activating}
          className="px-4 py-2 rounded-md bg-copper text-white font-display font-black uppercase tracking-wide text-[12px] disabled:opacity-60 flex-shrink-0"
        >
          {activating ? "Frage Browser …" : "Jetzt aktivieren"}
        </button>
      </div>
    </div>
  );
}
