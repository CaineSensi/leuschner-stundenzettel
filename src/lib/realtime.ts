import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Ruft `refresh()` jedes Mal auf, wenn die App vom Hintergrund zurückkommt
 * (Tab wieder sichtbar, PWA aus dem Home-Bildschirm geöffnet, BFCache-Restore).
 * So sieht der User immer den aktuellen Stand.
 */
export function useRefreshOnVisible(refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshRef.current();
      }
    }
    function onPageShow(e: PageTransitionEvent) {
      // BFCache-Restore (Safari behält die Page samt State im Speicher)
      if (e.persisted) refreshRef.current();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}

/**
 * Abonniert Postgres-Changes für eine oder mehrere Tabellen.
 * Bei JEDEM Insert/Update/Delete wird `onChange()` aufgerufen.
 *
 * Beispiel:
 *   useRealtime("plan", ["assignments", "sites"], refresh);
 *
 * `refresh` darf gerne via useCallback stabil sein — der Hook hält die
 * aktuelle Referenz in einem Ref, sodass er nur bei Änderung von
 * `channelKey` oder `tables` neu subscribt.
 */
export function useRealtime(
  channelKey: string,
  tables: string[],
  onChange: () => void
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!supabase || tables.length === 0) return;
    const ch = supabase.channel(`rt:${channelKey}`);
    tables.forEach((t) => {
      ch.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: t },
        () => onChangeRef.current()
      );
    });
    ch.subscribe();
    return () => {
      supabase!.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, tables.join(",")]);
}
