// Chat-Backend zwischen Workers (1:1) · Realtime · ✓✓ gelesen · RLS-geschützt.
// DB-Schema: messages-Tabelle + mark_messages_read-RPC (siehe Management-API-Schema 09.06.2026).

import { isBackendConnected, supabase } from "./supabase";
import type { Worker } from "./types";

export interface ChatAttachment {
  path: string;       // Storage-Pfad innerhalb chat-attachments
  mime: string;
  name?: string;
  width?: number;
  height?: number;
  size?: number;
}

export interface Message {
  id: string;
  companyId: string;
  senderId: string;
  receiverId: string;
  content: string;
  attachments?: ChatAttachment[];
  cardId?: string;
  createdAt: string;
  editedAt?: string;
  readAt?: string;
}

function rowToMessage(r: any): Message {
  return {
    id: r.id,
    companyId: r.company_id,
    senderId: r.sender_id,
    receiverId: r.receiver_id,
    content: r.content,
    attachments: Array.isArray(r.attachments) ? r.attachments : undefined,
    cardId: r.card_id ?? undefined,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? undefined,
    readAt: r.read_at ?? undefined,
  };
}

const COLS = "id, company_id, sender_id, receiver_id, content, attachments, card_id, created_at, edited_at, read_at";

/** Alle Nachrichten zwischen mir und peer (chronologisch aufsteigend). */
export async function listConversation(meId: string, peerId: string, limit = 200): Promise<Message[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("messages")
    .select(COLS)
    .or(`and(sender_id.eq.${meId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${meId})`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[chat] listConversation failed", error.message);
    return [];
  }
  return (data ?? []).map(rowToMessage);
}

/** Alle Nachrichten, an denen ich beteiligt bin (für Sidebar-Liste). */
export async function listAllMyMessages(meId: string, limit = 500): Promise<Message[]> {
  if (!isBackendConnected() || !supabase) return [];
  const sb: any = supabase;
  const { data, error } = await sb
    .from("messages")
    .select(COLS)
    .or(`sender_id.eq.${meId},receiver_id.eq.${meId}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[chat] listAllMyMessages failed", error.message);
    return [];
  }
  return (data ?? []).map(rowToMessage);
}

export async function sendMessage(input: {
  meId: string;
  companyId: string;
  receiverId: string;
  content: string;
  cardId?: string;
  attachments?: ChatAttachment[];
}): Promise<Message> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const sb: any = supabase;
  // Content darf leer sein wenn Anhänge dabei — DB-Check wird via Platzhalter umgangen
  const hasAtt = (input.attachments?.length ?? 0) > 0;
  const content = input.content.trim() || (hasAtt ? "📎" : "");
  const { data, error } = await sb
    .from("messages")
    .insert({
      company_id: input.companyId,
      sender_id: input.meId,
      receiver_id: input.receiverId,
      content,
      card_id: input.cardId ?? null,
      attachments: hasAtt ? input.attachments : null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToMessage(data);
}

/** Komprimiert ein Bild client-seitig (max 1600 px, JPEG q=.85) und lädt es
 *  in den chat-attachments-Bucket hoch. Liefert den ChatAttachment-Eintrag. */
export async function uploadChatAttachment(
  file: File, meId: string
): Promise<ChatAttachment> {
  if (!isBackendConnected() || !supabase) throw new Error("Backend nicht verbunden");
  const compressed = file.type.startsWith("image/") ? await compressImage(file) : { blob: file, width: undefined, height: undefined };
  const ext = compressed.blob.type === "image/jpeg" ? "jpg" :
              compressed.blob.type === "image/png"  ? "png" :
              compressed.blob.type === "image/webp" ? "webp" :
              compressed.blob.type === "image/gif"  ? "gif" : "bin";
  const path = `${meId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const sb: any = supabase;
  const { error } = await sb.storage.from("chat-attachments").upload(path, compressed.blob, {
    contentType: compressed.blob.type,
    upsert: false,
  });
  if (error) throw error;
  return {
    path,
    mime: compressed.blob.type,
    name: file.name,
    width: compressed.width,
    height: compressed.height,
    size: compressed.blob.size,
  };
}

async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas ctx fehlt"));
      ctx.drawImage(img, 0, 0, w, h);
      // PNG/GIF mit Transparenz behalten; alles andere als JPEG
      const outType = (file.type === "image/png" || file.type === "image/gif") ? file.type : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("toBlob fehlgeschlagen"));
          resolve({ blob, width: w, height: h });
        },
        outType,
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild laden fehlgeschlagen")); };
    img.src = url;
  });
}

/** Signed URL für ein Chat-Attachment (60 min gültig). Cached. */
const urlCache = new Map<string, { url: string; until: number }>();
export async function attachmentUrl(path: string): Promise<string | null> {
  if (!supabase) return null;
  const now = Date.now();
  const cached = urlCache.get(path);
  if (cached && cached.until > now + 60_000) return cached.url;
  const sb: any = supabase;
  const { data, error } = await sb.storage.from("chat-attachments").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, until: now + 3600_000 });
  return data.signedUrl;
}

/** Markiert alle ungelesenen Nachrichten vom Peer an mich als gelesen.
 *  Geht über RPC, weil der Empfänger via RLS nicht direkt update darf. */
export async function markConversationRead(peerId: string): Promise<number> {
  if (!isBackendConnected() || !supabase) return 0;
  const sb: any = supabase;
  const { data, error } = await sb.rpc("mark_messages_read", { p_peer_id: peerId });
  if (error) {
    console.warn("[chat] markConversationRead failed", error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** Subscribed auf neue Nachrichten an mich. Callback bekommt die rohe row. */
export function subscribeToInbox(meId: string, onNew: (m: Message) => void): () => void {
  if (!isBackendConnected() || !supabase) return () => {};
  const sb: any = supabase;
  const channel = sb
    .channel(`chat-inbox-${meId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${meId}` },
      (payload: any) => onNew(rowToMessage(payload.new))
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${meId}` },
      (payload: any) => onNew(rowToMessage(payload.new))
    )
    .subscribe();
  return () => { try { sb.removeChannel(channel); } catch { /* ignore */ } };
}

/** Vereinfachter Worker-Pick: nur ID + Anzeige-Info, ohne den ganzen Worker zu laden. */
export interface ChatPeer {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  role: string;
  isAdmin: boolean;
}

export function workerToPeer(w: Worker): ChatPeer {
  return {
    id: w.id,
    initials: w.initials,
    firstName: w.firstName,
    lastName: w.lastName,
    role: w.role,
    isAdmin: w.isAdmin === true,
  };
}

/** Aggregiert: pro Peer letzte Nachricht + ungelesen-Counter. */
export interface ConversationSummary {
  peerId: string;
  lastMessage?: Message;
  unreadCount: number;
}

export function summarizeByPeer(messages: Message[], meId: string): Map<string, ConversationSummary> {
  const byPeer = new Map<string, ConversationSummary>();
  for (const m of messages) {
    const peer = m.senderId === meId ? m.receiverId : m.senderId;
    const cur = byPeer.get(peer) ?? { peerId: peer, unreadCount: 0 };
    // Liste kommt absteigend → erste Nachricht je Peer ist die neueste
    if (!cur.lastMessage) cur.lastMessage = m;
    if (m.receiverId === meId && !m.readAt) cur.unreadCount += 1;
    byPeer.set(peer, cur);
  }
  return byPeer;
}
