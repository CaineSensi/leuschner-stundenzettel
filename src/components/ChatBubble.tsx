import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { currentUser } from "../lib/auth";
import { listWorkers } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { Worker } from "../lib/types";
import {
  listAllMyMessages, markConversationRead, sendMessage,
  subscribeToInbox, summarizeByPeer, uploadChatAttachment, attachmentUrl,
  type Message, type ChatAttachment
} from "../lib/chat";
import { startPresence, useOnlineUsers, isWorkerOnline } from "../lib/presence";
import { useRefreshOnVisible } from "../lib/realtime";
import { withTimeout } from "../lib/utils";

const SEND_TIMEOUT_MS = 15_000;   // max Wartezeit pro Sende-Vorgang
const POLL_INTERVAL_MS = 30_000;  // Fallback-Polling wenn WebSocket schweigt

/* ────────────────────────────────────────────────────────────────────────
   ChatBubble + Prime-Modal · interner App-Chat (Floating Bubble unten rechts)
   Sichtbar nur für Admins. Nicht-Admins sehen nichts (Mitarbeiter-Chat
   kommt in einer späteren Ausbaustufe).
   ──────────────────────────────────────────────────────────────────────── */

const TOAST_DURATION_MS = 6000;

export default function ChatBubble() {
  // App.tsx mountet ChatBubble einmalig — der initiale currentUser() ist
  // i. d. R. null. Damit die Bubble nach dem Login erscheint, lauscht sie
  // hier selbst auf Auth-Änderungen + Routen-Wechsel und liest currentUser
  // ggf. neu aus localStorage.
  const location = useLocation();
  const [me, setMe] = useState<Worker | null>(currentUser());
  useEffect(() => {
    // Bei jedem Routenwechsel kurz nachfassen (auch wenn nichts passiert ist,
    // ist es ein billiger localStorage-Read).
    setMe(currentUser());
  }, [location.pathname]);
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Auth-Event landet AFTER syncWorkerFromSession() — localStorage ist
      // schon gepflegt, also einfach neu auslesen.
      setMe(currentUser());
    });
    return () => subscription.unsubscribe();
  }, []);
  if (!me || !me.isAdmin) return null;
  return <ChatBubbleInner me={me} />;
}

function ChatBubbleInner({ me }: { me: Worker }) {
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<Worker[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<{ msg: Message; peer?: Worker } | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ file: File; preview: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks the temp ID of the currently in-flight optimistic message
  const optimisticIdRef = useRef<string | null>(null);
  const onlineUsers = useOnlineUsers();

  // Presence aktivieren, solange ich eingeloggt bin
  useEffect(() => { startPresence(me); }, [me.id]);

  // Workers laden (für Sidebar-Liste + Anzeige-Daten) — auch nach Tab-Wechsel
  // neu, damit frisch zu Admin ernannte Personen sofort in der Sidebar landen.
  const [peersRefreshKey, setPeersRefreshKey] = useState(0);
  useRefreshOnVisible(() => setPeersRefreshKey((k) => k + 1));
  useEffect(() => {
    let cancelled = false;
    listWorkers(true) // includeArchived: archivierte Admins (Wolfgang) sollen chatbar bleiben
      .then((ws) => {
        if (cancelled) return;
        // Aktuell nur Admin-zu-Admin-Chat (Rick-Vorgabe 09.06.: „Mathias und
        // Hartwig erstmal aus dem Chat entfernen"). Mitarbeiter werden später
        // wieder reingenommen, wenn die Mitarbeiter-Variante kommt.
        const filtered = ws.filter((w) => w.id !== me.id && w.isAdmin === true);
        filtered.sort((a, b) => a.firstName.localeCompare(b.firstName));
        setPeers(filtered);
        if (!activePeerId && filtered.length > 0) {
          setActivePeerId(filtered[0].id);
        }
      })
      .catch((e) => console.warn("[chat] listWorkers failed", e));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, peersRefreshKey]);

  // Inbox laden — alle Nachrichten an/von mir
  const refreshMessages = useMemo(() => async () => {
    try {
      const msgs = await withTimeout(listAllMyMessages(me.id), 8_000, "Nachrichten");
      setMessages(msgs);
    } catch (err) {
      console.warn("[chat] refreshMessages failed", err);
    }
  }, [me.id]);

  useEffect(() => { refreshMessages(); }, [refreshMessages]);

  // Fallback-Polling: alle 30 s nachladen falls WebSocket schweigt
  useEffect(() => {
    const id = setInterval(refreshMessages, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshMessages]);

  // Sofort neu laden wenn Tab wieder sichtbar wird (z.B. nach Seiten-Wechsel)
  useRefreshOnVisible(refreshMessages);

  // Realtime: neue Nachrichten reinpushen
  useEffect(() => {
    const unsub = subscribeToInbox(me.id, (m) => {
      setMessages((prev) => {
        // Eigenes Echo: optimistischen Platzhalter ersetzen (falls noch vorhanden)
        if (m.senderId === me.id && optimisticIdRef.current) {
          const optIdx = prev.findIndex((x) => x.id === optimisticIdRef.current);
          if (optIdx >= 0) {
            optimisticIdRef.current = null;
            const next = prev.slice();
            next[optIdx] = m;
            return next;
          }
        }
        // Normales Insert oder Update (UPDATE bei read_at)
        const i = prev.findIndex((x) => x.id === m.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = m;
          return next;
        }
        return [m, ...prev];
      });
      // Toast nur bei neuer eingehender Nachricht, nicht bei eigenem Echo,
      // und nur wenn Bubble zu ist oder andere Konversation aktiv
      if (m.receiverId === me.id && (!open || activePeerId !== m.senderId)) {
        showToast(m);
      }
      // Wenn aktive Konversation, sofort als gelesen markieren
      if (open && activePeerId === m.senderId) {
        markConversationRead(m.senderId).catch(() => {});
      }
    });
    return unsub;
  }, [me.id, open, activePeerId]);

  // Beim Öffnen oder Peer-Wechsel: konversation als gelesen markieren
  useEffect(() => {
    if (!open || !activePeerId) return;
    markConversationRead(activePeerId).then(() => {
      // Lokale Counter sofort runtersetzen
      setMessages((prev) => prev.map((m) =>
        m.senderId === activePeerId && m.receiverId === me.id && !m.readAt
          ? { ...m, readAt: new Date().toISOString() }
          : m
      ));
    }).catch(() => {});
  }, [open, activePeerId, me.id]);

  // Auto-scroll bei neuen Nachrichten
  useEffect(() => {
    if (!open) return;
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, activePeerId, messages.length]);

  // ESC schließt
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  function showToast(m: Message) {
    setToast({ msg: m, peer: peers.find((p) => p.id === m.senderId) });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function openWithPeer(peerId: string) {
    setActivePeerId(peerId);
    setOpen(true);
    setToast(null);
  }

  const summaries = useMemo(() => summarizeByPeer(messages, me.id), [messages, me.id]);
  const totalUnread = useMemo(() => {
    let n = 0;
    for (const [, s] of summaries) n += s.unreadCount;
    return n;
  }, [summaries]);

  const activePeer = peers.find((p) => p.id === activePeerId) ?? null;
  const conversation = useMemo(() => {
    if (!activePeerId) return [];
    return messages
      .filter((m) =>
        (m.senderId === me.id && m.receiverId === activePeerId) ||
        (m.senderId === activePeerId && m.receiverId === me.id))
      .slice()
      .reverse(); // listAllMyMessages kommt absteigend → wir wollen aufsteigend rendern
  }, [messages, me.id, activePeerId]);

  async function handleSend() {
    if (sending) return;
    const text = draft.trim();
    const hasAtt = pendingAttachments.length > 0;
    if ((!text && !hasAtt) || !activePeerId || !me.companyId) return;

    setSending(true);
    setDraft("");
    const filesToSend = pendingAttachments.slice();
    setPendingAttachments([]);
    setUploadError(null);

    // Optimistisch sofort in der Unterhaltung zeigen — damit nichts "verschwindet"
    const tempId = `opt-${Date.now()}`;
    optimisticIdRef.current = tempId;
    const optimistic: Message = {
      id: tempId,
      companyId: me.companyId,
      senderId: me.id,
      receiverId: activePeerId,
      content: text || "📎",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [optimistic, ...prev]);

    try {
      const doSend = async () => {
        let uploaded: ChatAttachment[] = [];
        if (filesToSend.length > 0) {
          const results = await Promise.allSettled(
            filesToSend.map((p) => uploadChatAttachment(p.file, me.id))
          );
          uploaded = results
            .filter((r): r is PromiseFulfilledResult<ChatAttachment> => r.status === "fulfilled")
            .map((r) => r.value);
          const failed = results.length - uploaded.length;
          if (failed > 0) setUploadError(`${failed} von ${results.length} Bildern konnten nicht hochgeladen werden`);
        }
        filesToSend.forEach((p) => URL.revokeObjectURL(p.preview));
        return sendMessage({
          meId: me.id,
          companyId: me.companyId!,
          receiverId: activePeerId!,
          content: text,
          attachments: uploaded.length > 0 ? uploaded : undefined,
        });
      };

      const sent = await withTimeout(doSend(), SEND_TIMEOUT_MS, "Senden");
      optimisticIdRef.current = null;
      // Optimistischen Platzhalter durch echte Nachricht ersetzen (falls Subscription
      // das noch nicht erledigt hat)
      setMessages((prev) => {
        const withoutOpt = prev.filter((m) => m.id !== tempId);
        if (withoutOpt.find((m) => m.id === sent.id)) return withoutOpt;
        return [sent, ...withoutOpt];
      });
    } catch (err: any) {
      console.warn("[chat] send failed", err);
      // Optimistischen Platzhalter entfernen + Draft zurückgeben
      optimisticIdRef.current = null;
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft((prev) => prev || text);
      setUploadError(err?.message ?? "Senden fehlgeschlagen — bitte erneut versuchen");
    } finally {
      setSending(false);
    }
  }

  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0 && files.length > 0) {
      setUploadError("Aktuell nur Bilder erlaubt (JPG, PNG, WEBP, GIF)");
      return;
    }
    setUploadError(null);
    setPendingAttachments((prev) => [
      ...prev,
      ...images.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
    ]);
  }
  function removePendingAttachment(idx: number) {
    setPendingAttachments((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }
  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* ───── Toast-Vorschau ─────────────────────────────────────── */}
      {toast && !open && (
        <button
          onClick={() => openWithPeer(toast.msg.senderId)}
          aria-label="Neue Nachricht öffnen"
          className="fixed z-[58] right-[108px] bottom-9 max-w-[300px] text-left bg-white border-l-[5px] border-copper rounded-lg shadow-2xl px-4 py-3 animate-[slidein_.5s_ease] hover:shadow-[0_30px_60px_-12px_rgba(0,0,0,.8)] transition-shadow"
          style={{ boxShadow: "0 22px 48px -12px rgba(0,0,0,.65)" }}
        >
          <div className="flex items-center gap-2.5 mb-1">
            <Avatar peer={toast.peer ?? null} size="sm" online={isWorkerOnline(toast.msg.senderId)} />
            <div className="font-bold text-[13px] text-ink">{toast.peer ? `${toast.peer.firstName}` : "Nachricht"}</div>
            <div className="font-mono text-[10.5px] text-ink-mute ml-auto">gerade eben</div>
          </div>
          <div className="text-[13px] text-ink-body leading-snug line-clamp-3">{toast.msg.content}</div>
        </button>
      )}

      {/* ───── Bubble ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Chat schließen" : `Chat öffnen${totalUnread ? `, ${totalUnread} ungelesen` : ""}`}
        className="fixed z-[57] right-5 bottom-5 w-[68px] h-[68px] rounded-full text-white text-3xl flex items-center justify-center cursor-pointer border-2 border-white/20 transition-transform hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(180deg,#E8853F,#C95F22)",
          boxShadow: "0 18px 36px -10px rgba(220,110,45,.65), inset 0 1px 0 rgba(255,255,255,.3)",
        }}
      >
        <span className="leading-none">{open ? "✕" : "💬"}</span>
        {totalUnread > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rust text-white text-[11px] font-bold flex items-center justify-center border-[3px] border-bg-deep">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
        {/* Atmungs-Pulse-Ring */}
        {totalUnread > 0 && !open && (
          <span className="absolute inset-0 rounded-full border-2 border-copper animate-[bpulse_2s_infinite]" aria-hidden />
        )}
      </button>

      {/* ───── Prime-Modal ────────────────────────────────────────── */}
      {open && (
        <ChatModalView
          me={me}
          peers={peers}
          messages={messages}
          summaries={summaries}
          activePeer={activePeer}
          conversation={conversation}
          onlineUsers={onlineUsers}
          onClose={() => setOpen(false)}
          onSelectPeer={(id) => setActivePeerId(id)}
          onRefreshPeers={() => setPeersRefreshKey((k) => k + 1)}
          draft={draft}
          onDraftChange={setDraft}
          onKey={handleKey}
          onSend={handleSend}
          sending={sending}
          streamRef={streamRef}
          pendingAttachments={pendingAttachments}
          onRemoveAttachment={removePendingAttachment}
          onPickFiles={() => fileInputRef.current?.click()}
          onPaste={handlePaste}
          onDrop={handleDrop}
          uploadError={uploadError}
          onOpenLightbox={setLightboxUrl}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) addFiles(files);
          e.target.value = ""; // erlaubt erneutes Wählen der gleichen Datei
        }}
      />

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-[92vw] max-h-[92vh] object-contain shadow-2xl" />
          <button
            className="absolute top-5 right-5 w-10 h-10 bg-white/15 border border-white/30 text-white rounded-full text-xl"
            aria-label="Schließen"
          >✕</button>
        </div>
      )}

      {/* Inline-Animations für Pulse + Toast (Tailwind hat das nicht out-of-the-box).
          Das Chat-Modal nutzt absolute Mittel-Positionierung via translate(-50%,-50%);
          die Einblend-Animation darf den transform-Wert NICHT überschreiben, sonst
          wandert das Modal von der Ecke zur Mitte (Rick-Fix 09.06.). */}
      <style>{`
        @keyframes bpulse { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(1.6); opacity: 0 } }
        @keyframes slidein { from { transform: translateX(110%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @keyframes tdot   { 0%,80%,100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-2px) } }

        /* Chat-Modal sofort zentriert (ohne Wander-Effekt aus der Ecke) */
        @media (min-width: 768px) {
          .chat-prime-modal {
            left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            border-radius: 18px;
            animation: chatfade .22s ease-out;
          }
        }
        @keyframes chatfade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Modal-View · 780×560 Desktop · Vollbild Mobile
   ──────────────────────────────────────────────────────────────────────── */

function ChatModalView(props: {
  me: Worker;
  peers: Worker[];
  messages: Message[];
  summaries: Map<string, { peerId: string; lastMessage?: Message; unreadCount: number }>;
  activePeer: Worker | null;
  conversation: Message[];
  onlineUsers: ReturnType<typeof useOnlineUsers>;
  onClose: () => void;
  onSelectPeer: (id: string) => void;
  onRefreshPeers: () => void;
  pendingAttachments: { file: File; preview: string }[];
  onRemoveAttachment: (idx: number) => void;
  onPickFiles: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  uploadError: string | null;
  onOpenLightbox: (url: string) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  sending: boolean;
  streamRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { me, peers, summaries, activePeer, conversation, onClose, onSelectPeer, onRefreshPeers, draft, onDraftChange, onKey, onSend, sending, streamRef,
          pendingAttachments, onRemoveAttachment, onPickFiles, onPaste, onDrop, uploadError, onOpenLightbox } = props;
  const peerOnline = activePeer ? isWorkerOnline(activePeer.id) : false;

  return (
    <>
      {/* Backdrop: dezent abgedunkelt + Blur, Klick schließt */}
      <div className="fixed inset-0 z-[58] bg-black/55 backdrop-blur-[2px]" onClick={onClose} />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chat"
        className="fixed z-[59] inset-0 md:inset-auto md:w-[820px] md:h-[600px] max-w-full overflow-hidden flex flex-col chat-prime-modal"
        style={{
          background: "linear-gradient(180deg,#1A1C1E,#0E1012)",
          boxShadow: "0 40px 80px -16px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.06)",
        }}
      >
        {/* Top-Bar */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b border-white/8 flex-shrink-0 relative"
          style={{ background: "linear-gradient(180deg,#2B2E31,#1A1C1E)" }}
        >
          <Avatar peer={me} size="md" online />
          <div>
            <div className="font-display font-extrabold uppercase tracking-wider text-[17px] text-white leading-none">
              CHAT<span className="text-copper">·</span>
            </div>
            <div className="font-mono text-[10.5px] text-steel uppercase tracking-wider mt-1">
              {me.firstName} · online
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="ml-auto w-8 h-8 bg-white/10 border border-white/15 text-white rounded-md grid place-items-center hover:bg-white/20 text-[15px]"
          >✕</button>
          {/* Copper-Underline */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg,transparent,#DC6E2D,transparent)" }} />
        </div>

        {/* Body: Sidebar + Chat */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <div className="w-[200px] md:w-[240px] bg-[#0E1012] border-r border-white/6 flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-white/6">
              <div className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-[11.5px] text-ink-mute font-mono">
                ⌕ Suchen
              </div>
            </div>
            <div className="flex-1 overflow-y-auto board-scroll">
              {peers.length === 0 && (
                <div className="px-4 py-6 text-center font-mono text-[11px] text-ink-mute space-y-3">
                  <div>keine weiteren Admins gefunden</div>
                  <div className="text-[10px] opacity-80">
                    Du bist eingeloggt als <b>{me.firstName} {me.lastName}</b><br />
                    Worker-ID: <b>{me.id.slice(0, 8)}</b><br />
                    isAdmin: <b>{String(me.isAdmin)}</b><br />
                    Auth-User: <b>{me.companyId ? "verknüpft" : "—"}</b>
                  </div>
                  <button
                    onClick={onRefreshPeers}
                    className="mt-2 text-[10.5px] font-display font-extrabold uppercase tracking-wider bg-copper text-white px-3 py-1.5 rounded hover:bg-copper-bright transition-colors"
                  >
                    ↻ Workers neu laden
                  </button>
                </div>
              )}
              {peers.map((p) => {
                const s = summaries.get(p.id);
                const isActive = activePeer?.id === p.id;
                const online = isWorkerOnline(p.id);
                const pre = s?.lastMessage
                  ? (s.lastMessage.senderId === me.id ? "Du: " : "") + s.lastMessage.content
                  : "noch keine Nachricht";
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectPeer(p.id)}
                    className={`w-full text-left flex gap-3 items-center px-4 py-3 transition-colors border-l-[3px] ${
                      isActive
                        ? "border-copper bg-gradient-to-r from-copper/15 to-transparent"
                        : "border-transparent hover:bg-white/4"
                    }`}
                  >
                    <Avatar peer={p} size="md" online={online} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[13px] font-semibold truncate ${isActive ? "text-copper-bright" : "text-white"}`}>
                        {p.firstName}
                      </div>
                      <div className="text-[11.5px] text-ink-mute truncate mt-0.5">{pre}</div>
                    </div>
                    {!!s?.unreadCount && (
                      <span className="bg-copper text-white text-[10px] font-bold rounded-full px-2 py-0.5">{s.unreadCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat-Stream */}
          <div className="flex-1 flex flex-col min-w-0" style={{ background: "linear-gradient(180deg,#15171A,#0E1012)" }}>
            {activePeer ? (
              <>
                {/* Konversations-Kopf */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/6 bg-white/2 flex-shrink-0">
                  <Avatar peer={activePeer} size="md" online={peerOnline} />
                  <div>
                    <div className="text-white font-bold text-[14px]">{activePeer.firstName} {activePeer.lastName}</div>
                    <div className={`text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 mt-0.5 ${peerOnline ? "text-moss-bright" : "text-ink-mute"}`}>
                      {peerOnline && (
                        <span className="w-1.5 h-1.5 rounded-full bg-moss-bright" style={{ boxShadow: "0 0 0 3px rgba(34,197,94,.2)" }} />
                      )}
                      {peerOnline ? "online" : "offline"} · {activePeer.role}
                    </div>
                  </div>
                </div>

                {/* Stream */}
                <div ref={streamRef} className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-2.5 board-scroll">
                  {conversation.length === 0 && (
                    <div className="m-auto text-center text-ink-mute text-[12px] font-mono">
                      noch keine Nachrichten · schreib die erste
                    </div>
                  )}
                  {conversation.map((m, i) => {
                    const isMe = m.senderId === me.id;
                    const isPending = m.id.startsWith("opt-");
                    const prev = conversation[i - 1];
                    const showDayLabel = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                    return (
                      <div key={m.id} className={`flex flex-col${isPending ? " opacity-60" : ""}`}>
                        {showDayLabel && (
                          <div className="self-center font-mono text-[10px] text-ink-mute bg-white/5 px-3 py-0.5 rounded-full my-2 uppercase tracking-wider">
                            {fmtDayLabel(m.createdAt)}
                          </div>
                        )}
                        <div className={`flex gap-2.5 items-end max-w-[78%] ${isMe ? "self-end flex-row-reverse" : "self-start"}`}>
                          <Avatar peer={isMe ? me : activePeer} size="xs" online={false} hideDot />
                          <div className={isMe ? "text-right" : ""}>
                            <div
                              className="text-[13.5px] leading-relaxed text-white whitespace-pre-wrap break-words overflow-hidden"
                              style={{
                                background: isMe ? "linear-gradient(180deg,#E8853F,#C95F22)" : "#27272a",
                                borderRadius: "14px",
                                borderBottomLeftRadius: isMe ? "14px" : "4px",
                                borderBottomRightRadius: isMe ? "4px" : "14px",
                                border: isMe ? "none" : "1px solid rgba(255,255,255,.06)",
                              }}
                            >
                              {m.attachments && m.attachments.length > 0 && (
                                <div className={`grid gap-1 ${m.attachments.length === 1 ? "grid-cols-1" : "grid-cols-2"} p-1`}>
                                  {m.attachments.map((att, k) => (
                                    <AttachmentImage
                                      key={k}
                                      att={att}
                                      onOpen={onOpenLightbox}
                                    />
                                  ))}
                                </div>
                              )}
                              {m.content && m.content !== "📎" && (
                                <div className="px-3.5 py-2.5">{m.content}</div>
                              )}
                            </div>
                            <div className={`font-mono text-[9.5px] text-ink-mute mt-1 flex gap-1.5 items-center ${isMe ? "justify-end" : ""}`}>
                              <span>{fmtTime(m.createdAt)}</span>
                              {isMe && (
                                m.readAt
                                  ? <span className="text-moss-bright">✓✓ gelesen</span>
                                  : <span className="text-ink-mute">✓</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Compose mit Drag&Drop für Bilder */}
                <div
                  className="bg-black/40 border-t border-white/6 flex-shrink-0"
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={onDrop}
                >
                  {/* Anhang-Previews */}
                  {pendingAttachments.length > 0 && (
                    <div className="px-3 pt-3 flex gap-2 flex-wrap">
                      {pendingAttachments.map((att, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border border-white/20">
                          <img src={att.preview} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => onRemoveAttachment(i)}
                            className="absolute top-0 right-0 w-5 h-5 bg-rust text-white text-[11px] font-bold flex items-center justify-center rounded-bl-md"
                            aria-label="Anhang entfernen"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {uploadError && (
                    <div className="px-4 pt-2 text-rust text-[11.5px] font-mono">⚠ {uploadError}</div>
                  )}
                  <div className="px-4 py-3 flex items-end gap-2.5">
                    <button
                      onClick={onPickFiles}
                      aria-label="Bild anhängen"
                      title="Bild anhängen (oder Bild reinziehen / Strg+V)"
                      className="w-[42px] h-[42px] rounded-[10px] bg-white/8 border border-white/15 text-white text-lg flex items-center justify-center hover:bg-white/15 transition-colors"
                    >📎</button>
                    <textarea
                      rows={1}
                      value={draft}
                      onChange={(e) => onDraftChange(e.target.value)}
                      onKeyDown={onKey}
                      onPaste={onPaste}
                      placeholder={`Nachricht an ${activePeer.firstName} …`}
                      className="flex-1 bg-[#27272a] border border-white/10 rounded-[10px] px-3.5 py-2.5 text-white text-[13.5px] placeholder:text-ink-mute placeholder:italic focus:outline-none focus:border-copper resize-none max-h-32"
                      autoFocus
                    />
                    <button
                      onClick={onSend}
                      disabled={sending || (!draft.trim() && pendingAttachments.length === 0)}
                      aria-label="Senden"
                      className="w-[42px] h-[42px] rounded-[10px] text-white text-lg flex items-center justify-center transition-opacity disabled:opacity-40"
                      style={{
                        background: "linear-gradient(180deg,#E8853F,#C95F22)",
                        boxShadow: "0 6px 14px -4px rgba(220,110,45,.6)",
                      }}
                    >{sending ? "…" : "➤"}</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-mute font-mono text-[12px]">
                wähle links eine Konversation
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Hilfs-Komponenten + Formatierung
   ──────────────────────────────────────────────────────────────────────── */

const RICK_ID     = "00000000-0000-0000-0000-000000000010";
const WOLFGANG_ID = "00000000-0000-0000-0000-000000000012";
const RICK_AVATAR = "https://vejhsyrxpveunygyhqlo.supabase.co/storage/v1/object/public/avatars/rick.png";

interface AvatarFlavor {
  emoji?: string;
  imageUrl?: string;
  bg: [string, string];
  emojiOffset?: number;
}

function flavorFor(peer: Worker | null): AvatarFlavor {
  if (peer?.id === RICK_ID)     return { imageUrl: RICK_AVATAR, bg: ["#0D1A0D", "#0A2A0A"] };
  if (peer?.id === WOLFGANG_ID) return { emoji: "🐺", bg: ["#5A5D60", "#2B2E31"], emojiOffset: 1.55 };
  if (peer?.isAdmin)            return { bg: ["#E8853F", "#C95F22"] };
  return { bg: pickPalette(peer?.initials ?? "?") };
}

function Avatar({ peer, size, online, hideDot }: {
  peer: Worker | null;
  size: "xs" | "sm" | "md" | "lg";
  online?: boolean;
  hideDot?: boolean;
}) {
  const dims = size === "lg" ? 46 : size === "md" ? 34 : size === "sm" ? 26 : 22;
  const baseFontSize = size === "lg" ? 16 : size === "md" ? 12 : size === "sm" ? 11 : 10;
  const borderWidth = size === "xs" || size === "sm" ? 1.5 : 2;
  const initials = peer?.initials ?? "?";
  const flavor = flavorFor(peer);
  const fontSize = flavor.emoji ? Math.round(baseFontSize * (flavor.emojiOffset ?? 1.55)) : baseFontSize;
  return (
    <div
      className="relative rounded-full inline-flex items-center justify-center text-white font-display font-extrabold flex-shrink-0 overflow-hidden"
      style={{
        width: dims, height: dims, fontSize,
        background: `linear-gradient(180deg, ${flavor.bg[0]}, ${flavor.bg[1]})`,
        border: `${borderWidth}px solid #fff`,
        lineHeight: 1,
      }}
      title={peer ? `${peer.firstName} ${peer.lastName}` : ""}
    >
      {flavor.imageUrl ? (
        <img
          src={flavor.imageUrl}
          alt={peer?.firstName ?? ""}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          draggable={false}
        />
      ) : (
        flavor.emoji ?? initials
      )}
      {online && !hideDot && (
        <span
          className="absolute"
          style={{
            width: Math.max(8, dims / 4),
            height: Math.max(8, dims / 4),
            borderRadius: "50%",
            background: "#22C55E",
            bottom: -1, right: -1,
            border: `${borderWidth}px solid #fff`,
          }}
        />
      )}
    </div>
  );
}

function AttachmentImage({ att, onOpen }: { att: ChatAttachment; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    attachmentUrl(att.path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [att.path]);
  if (!url) {
    return (
      <div className="aspect-video bg-white/5 animate-pulse rounded-[10px]" />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(url); }}
      className="block w-full overflow-hidden rounded-[10px] hover:opacity-90 transition-opacity cursor-zoom-in"
    >
      <img
        src={url}
        alt={att.name ?? "Bild"}
        loading="lazy"
        className="w-full h-auto block"
        style={{ maxHeight: 320, objectFit: "cover" }}
      />
    </button>
  );
}

function pickPalette(initials: string): [string, string] {
  const palettes: [string, string][] = [
    ["#3A8CE8", "#2962C9"], // blau
    ["#22C55E", "#1F7A3D"], // grün
    ["#C9852F", "#8A5A1A"], // bernstein
    ["#888B8F", "#5A5D60"], // stahl
  ];
  let h = 0;
  for (let i = 0; i < initials.length; i++) h = (h * 31 + initials.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function fmtDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Heute";
  if (d.toDateString() === yest.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
