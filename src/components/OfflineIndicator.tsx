import { useEffect, useState } from "react";
import { useOnline } from "../lib/useOnline";
import { getPendingCount, onSyncChange, syncPending } from "../lib/sync";

export default function OfflineIndicator() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    refresh();
    const off = onSyncChange(refresh);
    return off;
  }, []);

  useEffect(() => {
    if (online) trySync();
  }, [online]);

  async function refresh() {
    setPending(await getPendingCount());
  }

  async function trySync() {
    setSyncing(true);
    const res = await syncPending();
    setSyncing(false);
    if (res.synced > 0) {
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 3000);
    }
    refresh();
  }

  if (online && pending === 0 && !justSynced) return null;

  let label = "";
  let cls = "";

  if (justSynced) {
    label = "✓ Synchronisiert";
    cls = "bg-good/20 border-good/40 text-good";
  } else if (!online && pending > 0) {
    label = `⏱ Offline · ${pending} ${pending === 1 ? "Eintrag" : "Einträge"} warten`;
    cls = "bg-rust/15 border-rust/40 text-rust";
  } else if (!online) {
    label = "○ Offline · App im Cache";
    cls = "bg-bg-3 border-ink/15 text-ink-2";
  } else if (syncing) {
    label = `↻ Synchronisiere · ${pending} ${pending === 1 ? "Eintrag" : "Einträge"}`;
    cls = "bg-copper/15 border-copper/40 text-copper";
  } else if (pending > 0) {
    label = `⏱ ${pending} ${pending === 1 ? "Eintrag" : "Einträge"} warten`;
    cls = "bg-copper/15 border-copper/40 text-copper";
  }

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-40 px-3 py-1.5 text-center font-mono text-[12px] tracking-wider uppercase border-b backdrop-blur-md ${cls}`}
      style={{ paddingTop: "max(env(safe-area-inset-top), 6px)" }}
    >
      {label}
    </div>
  );
}
