import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { currentUser } from "./auth";
import { listAssignments, listEntries, listSites } from "./api";
import type { Assignment, Entry, Site } from "./types";

// ─── Typen ───────────────────────────────────────────────────────────────────

interface LiveDataContextValue {
  entries: Entry[];
  assignments: Assignment[];
  sites: Site[];
  isLoaded: boolean;
  refresh: () => void;
  /** Optimistisch einen neuen Eintrag in den Cache legen (vor Server-Antwort). */
  addEntry: (e: Entry) => void;
  /** Optimistisch einen bestehenden Eintrag ersetzen. */
  patchEntry: (e: Entry) => void;
  /** Optimistisch einen Eintrag entfernen. */
  removeEntry: (id: string) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const LiveDataContext = createContext<LiveDataContextValue>({
  entries: [],
  assignments: [],
  sites: [],
  isLoaded: false,
  refresh: () => {},
  addEntry: () => {},
  patchEntry: () => {},
  removeEntry: () => {},
});

export function useLiveData(): LiveDataContextValue {
  return useContext(LiveDataContext);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/** 2 Wochen zurück bis 1 Woche voraus — deckt Home + Day + offene-Tage-Banner ab. */
function getRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 14);
  const to = new Date(now);
  to.setDate(to.getDate() + 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function rowToEntry(r: any): Entry {
  if (r.entry_type === "work") {
    return {
      id: r.id,
      type: "work",
      workerId: r.worker_id,
      date: r.date,
      siteId: r.site_id,
      discipline: r.discipline,
      startMin: r.start_min,
      endMin: r.end_min,
      pauseMin: r.pause_min,
      weather: r.weather ?? undefined,
      geoVerified: r.geo_verified,
      note: r.note ?? undefined,
      submittedAt: r.submitted_at ?? null,
    };
  }
  return {
    id: r.id,
    type: r.entry_type,
    workerId: r.worker_id,
    date: r.date,
    endDate: r.end_date ?? undefined,
    note: r.note ?? undefined,
    submittedAt: r.submitted_at ?? null,
  };
}

function rowToAssignment(r: any): Assignment {
  return {
    id: r.id,
    workerId: r.worker_id,
    date: r.date,
    siteId: r.site_id,
    discipline: r.discipline,
    plannedStartMin: r.planned_start_min ?? undefined,
    plannedEndMin: r.planned_end_min ?? undefined,
    plannedPauseMin: r.planned_pause_min ?? undefined,
    note: r.note ?? undefined,
    publishedAt: r.published_at ?? undefined,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  // workerId in React-State → reaktive Deps für alle useEffects
  const [workerId, setWorkerId] = useState<string | null>(currentUser()?.id ?? null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [channelKey, setChannelKey] = useState(0); // inkrementiert → Subscription neu aufbauen

  // ─ Auth-State verfolgen ─
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      const id = currentUser()?.id ?? null;
      setWorkerId(id);
      if (!id) {
        setEntries([]);
        setAssignments([]);
        setIsLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─ Alle Daten laden ─
  const fetchAll = useCallback(async () => {
    const id = workerId;
    if (!id) return;
    const { from, to } = getRange();
    try {
      const [e, a, s] = await Promise.all([
        listEntries(id, from, to).catch(() => [] as Entry[]),
        listAssignments(id, from, to).catch(() => [] as Assignment[]),
        listSites().catch(() => [] as Site[]),
      ]);
      // Nur setzen wenn noch derselbe Worker aktiv (kein veralteter Fetch)
      setWorkerId((cur) => {
        if (cur === id) {
          setEntries(e);
          setAssignments(a);
          setSites(s);
          setIsLoaded(true);
        }
        return cur;
      });
    } catch (err) {
      console.warn("[live] fetchAll failed", err);
    }
  }, [workerId]);

  // ─ Erst-Laden wenn Worker bekannt ─
  useEffect(() => {
    if (!workerId) return;
    fetchAll();
  }, [workerId, fetchAll]);

  // ─ App aus Hintergrund / wieder online ─
  useEffect(() => {
    if (!workerId) return;
    const onVisible = () => { if (document.visibilityState === "visible") fetchAll(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", fetchAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", fetchAll);
    };
  }, [workerId, fetchAll]);

  // ─ Realtime-Subscription mit Payload-Updates ─
  useEffect(() => {
    if (!workerId || !supabase) return;

    const ch = supabase
      .channel(`live:${workerId}:${channelKey}`)

      // entries – INSERT (bereinigt auch optimistische Platzhalter mit gleicher date)
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "entries" }, (p: any) => {
        if (p.new?.worker_id !== workerId) return;
        setEntries((prev) => {
          if (prev.some((e) => e.id === p.new.id)) return prev;
          const cleaned = prev.filter(
            (e) => !(e.id.startsWith("optimistic-") && e.date === p.new.date)
          );
          return [...cleaned, rowToEntry(p.new)];
        });
      })
      // entries – UPDATE
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "entries" }, (p: any) => {
        if (p.new?.worker_id !== workerId) return;
        setEntries((prev) => prev.map((e) => e.id === p.new.id ? rowToEntry(p.new) : e));
      })
      // entries – DELETE (old hat nur die PK id, kein worker_id ohne REPLICA IDENTITY FULL → immer filtern)
      .on("postgres_changes" as any, { event: "DELETE", schema: "public", table: "entries" }, (p: any) => {
        setEntries((prev) => prev.filter((e) => e.id !== p.old.id));
      })

      // assignments – INSERT
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "assignments" }, (p: any) => {
        if (p.new?.worker_id !== workerId) return;
        setAssignments((prev) => prev.some((a) => a.id === p.new.id) ? prev : [...prev, rowToAssignment(p.new)]);
      })
      // assignments – UPDATE
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "assignments" }, (p: any) => {
        if (p.new?.worker_id !== workerId) return;
        setAssignments((prev) => prev.map((a) => a.id === p.new.id ? rowToAssignment(p.new) : a));
      })
      // assignments – DELETE
      .on("postgres_changes" as any, { event: "DELETE", schema: "public", table: "assignments" }, (p: any) => {
        setAssignments((prev) => prev.filter((a) => a.id !== p.old.id));
      })

      // sites – bei jeder Änderung neu laden (selten, kein Payload-Update nötig)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "sites" }, () => {
        listSites().then(setSites).catch(() => {});
      })

      // Reconnect-Wächter: Channel-Fehler → 5s warten, neu laden + neu subscriben
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[live] Realtime-Channel", status, "— reconnect in 5s");
          setTimeout(() => {
            fetchAll();
            setChannelKey((k) => k + 1);
          }, 5000);
        }
      });

    return () => { supabase!.removeChannel(ch); };
  }, [workerId, channelKey, fetchAll]);

  const addEntry = useCallback((e: Entry) => {
    setEntries((prev) => prev.some((x) => x.id === e.id) ? prev : [...prev, e]);
  }, []);

  const patchEntry = useCallback((e: Entry) => {
    setEntries((prev) => prev.map((x) => x.id === e.id ? e : x));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return (
    <LiveDataContext.Provider value={{
      entries, assignments, sites, isLoaded,
      refresh: fetchAll, addEntry, patchEntry, removeEntry
    }}>
      {children}
    </LiveDataContext.Provider>
  );
}
