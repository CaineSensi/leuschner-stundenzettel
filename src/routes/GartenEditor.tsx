import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BackButton from "../components/BackButton";
import { getSketchForSite, saveSketchForSite, getSiteName } from "../lib/sketches";

/* ────────────────────────────────────────────────────────────────────────
   Garten-Skizzen-Editor · Desktop-Werkzeug
   Der Editor selbst ist eine isolierte statische Seite
   (public/garten-editor.html, eigenes CSS/localStorage). Diese Route bettet
   ihn als iframe ein und — wenn ?site=<id> gesetzt ist — übernimmt das
   Laden/Speichern der Skizze in Supabase (`site_sketches`) über eine
   postMessage-Brücke. Ohne ?site läuft der Editor rein lokal (localStorage).
   ──────────────────────────────────────────────────────────────────────── */
export default function GartenEditor() {
  const [params] = useSearchParams();
  const siteId = params.get("site") || "";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const readyRef = useRef(false);
  const dataRef = useRef<any>(null);     // geladene Skizze (null = noch keine)
  const titleRef = useRef<string>("Skizze");
  const lastRef = useRef<any>(null);     // zuletzt vom Editor gemeldeter Stand
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [siteName, setSiteName] = useState<string>("");
  const [status, setStatus] = useState<string>(siteId ? "Lädt …" : "Lokal (kein Baustellen-Bezug)");

  function trySend() {
    if (!siteId || !readyRef.current) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "gp-load", data: dataRef.current, title: titleRef.current }, "*");
  }

  function doSave(data: any) {
    if (!siteId) return;
    setStatus("Speichert …");
    saveSketchForSite(siteId, data, titleRef.current)
      .then(() => setStatus("Gespeichert · " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })))
      .catch((e) => setStatus("Fehler: " + (e?.message ?? "Speichern fehlgeschlagen")));
  }

  useEffect(() => {
    let cancelled = false;
    if (siteId) {
      (async () => {
        try {
          const [name, sketch] = await Promise.all([
            getSiteName(siteId).catch(() => null),
            getSketchForSite(siteId).catch(() => null),
          ]);
          if (cancelled) return;
          titleRef.current = name || "Baustelle";
          setSiteName(name || "Baustelle");
          dataRef.current = sketch?.data ?? null;
          setStatus(sketch ? "Geladen" : "Neue Skizze");
          trySend();
        } catch (e: any) {
          if (!cancelled) setStatus("Laden fehlgeschlagen: " + (e?.message ?? ""));
        }
      })();
    }

    function onMsg(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const m: any = ev.data || {};
      if (m.type === "gp-ready") {
        readyRef.current = true;
        trySend();
      } else if (m.type === "gp-change" && siteId) {
        lastRef.current = m.data;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => doSave(m.data), 1200);
        setStatus("Änderung erkannt …");
      }
    }
    window.addEventListener("message", onMsg);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMsg);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  return (
    <div className="h-screen flex flex-col">
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4 flex-shrink-0 safe-top">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">
              {siteId ? "Garten-Planer · Baustelle" : "Werkzeug · Desktop"}
            </span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1.5">
              {siteId ? `Skizze · ${siteName || "…"}` : "Garten-Skizzen"}
            </h1>
            <p className="font-mono text-[11.5px] mt-2 tracking-wide text-steel">
              Wege · Beete · Pflaster · maßstäblich · Luftbild-Vorlage
              {siteId ? " · in Baustelle gespeichert" : " · lokal gespeichert"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[11.5px] tracking-wide ${status.startsWith("Fehler") || status.startsWith("Laden fehl") ? "text-rust" : "text-moss-bright"}`}>
              ● {status}
            </span>
            {siteId && (
              <button
                onClick={() => { if (lastRef.current) doSave(lastRef.current); }}
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-copper text-white text-[12px] font-display font-extrabold uppercase tracking-wide hover:bg-copper-bright transition-colors !min-h-[44px]"
                title="Aktuellen Stand sofort in die Baustelle speichern"
              >
                Speichern ↗
              </button>
            )}
          </div>
        </div>
      </header>
      <iframe
        ref={iframeRef}
        title="Garten-Skizzen-Editor"
        src="/garten-editor.html"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
