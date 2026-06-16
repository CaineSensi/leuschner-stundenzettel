import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { reportEvent } from "./diag";

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
    // window 'focus' triggert in der installierten PWA (Home-Bildschirm)
    // zuverlaessiger als visibilitychange, wenn man zur App zurueckkehrt.
    // 'online' faengt den Fall ab, dass das Netz zwischendurch weg war.
    function onFocus() { refreshRef.current(); }
    function onOnline() { refreshRef.current(); }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, []);
}

/**
 * Ruft `refresh()` auf, sobald sich der Auth-State so ändert, dass neue Daten
 * gefragt sind: nach erfolgtem Sign-In, Token-Refresh oder wenn die initiale
 * Session-Wiederherstellung beim App-Start abgeschlossen ist.
 *
 * Hintergrund: Routes mounten oft, BEVOR Supabase die persistierte Session aus
 * dem Storage rekonstruiert hat. Der erste Fetch läuft dann ohne Token, RLS
 * antwortet leer/fehler — und ohne diesen Hook würde der View leer bleiben,
 * bis der User manuell neu lädt. Mit dem Hook holt sich die Route die Daten
 * automatisch nach, sobald die Session da ist.
 */
export function useRefreshOnAuth(refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let fired = false;
    let safety: ReturnType<typeof setTimeout>;

    // Genau EINMAL laden — egal welcher Auslöser zuerst kommt.
    const fire = () => {
      if (cancelled || fired) return;
      fired = true;
      clearTimeout(safety);
      refreshRef.current();
    };

    // Sicherheitsnetz gegen den Firefox-Hänger: getSession() kann (Web-Locks-/
    // Token-Refresh-Bug) NICHT zurückkehren — dann blieb der View bisher leer,
    // bis man die Seite manuell neu lud. Nach 3 s laden wir TROTZDEM: der
    // Supabase-Client hat das persistierte Token längst angehängt, RLS regelt
    // den Rest. Der Hänger meldet sich dabei selbst im Diagnose-Log.
    safety = setTimeout(() => {
      reportEvent(
        "timeout",
        "getSession-RefreshGuard",
        "getSession kam beim Seitenaufbau nicht zurück — Daten per Sicherheitsnetz nachgeladen"
      );
      fire();
    }, 3000);

    // Normalfall: getSession() erneuert ein abgelaufenes Token und kehrt zurück
    // → sofort laden (mit Token). Auch bei Fehler laden (RLS handled leer).
    supabase.auth.getSession().then(fire).catch(fire);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Nach dem ersten Laden weiterhin auf echte Auth-Wechsel reagieren, damit
      // ein Token-Refresh keinen veralteten/leeren View hinterlässt.
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        refreshRef.current();
      }
    });
    return () => { cancelled = true; clearTimeout(safety); subscription.unsubscribe(); };
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
