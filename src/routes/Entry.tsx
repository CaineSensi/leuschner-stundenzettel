import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { deleteEntry, getTodayAssignment, listEntries, listSites } from "../lib/api";
import { saveEntryWithSync } from "../lib/sync";
import { queueEntry } from "../lib/offline";
import { currentUser } from "../lib/auth";
import {
  deleteEntryPhoto, getCurrentCompanyId, listEntryPhotos, uploadEntryPhoto
} from "../lib/photos";
import PhotoStrip from "../components/PhotoStrip";
import { fmtHours, fmtTime, todayIso } from "../lib/utils";
import { DEFAULT_PLAN, type Assignment, type Discipline, type EntryPhoto, type EntryType, type Site } from "../lib/types";

type Step = "type" | "activity" | "absence" | "nowork";

interface EntryNavState {
  assignment?: Assignment;
}

const DISCIPLINES: { id: Discipline; label: string; icon: JSX.Element }[] = [
  {
    id: "PFL",
    label: "Pflaster",
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor" className="w-7 h-7">
        <rect x="2" y="2" width="12" height="12" /><rect x="18" y="2" width="12" height="12" />
        <rect x="2" y="18" width="12" height="12" /><rect x="18" y="18" width="12" height="12" />
      </svg>
    )
  },
  {
    id: "GTN",
    label: "Garten",
    icon: (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <path d="M16 4 C 10 10, 10 22, 16 28 C 22 22, 22 10, 16 4 Z" />
        <line x1="16" y1="8" x2="16" y2="26" />
      </svg>
    )
  },
  {
    id: "ZAU",
    label: "Zaun",
    icon: (
      <svg viewBox="0 0 32 32" fill="currentColor" className="w-7 h-7">
        <rect x="4" y="6" width="3" height="22" /><rect x="14" y="6" width="3" height="22" /><rect x="24" y="6" width="3" height="22" />
        <rect x="2" y="12" width="28" height="2" /><rect x="2" y="22" width="28" height="2" />
      </svg>
    )
  }
];

const TYPE_OPTIONS: {
  id: EntryType; label: string; sub: string; emoji: string; tone: "primary" | "rust" | "moss" | "neutral";
}[] = [
  { id: "work",     label: "Arbeit",      sub: "Stunden auf Baustelle",  emoji: "🛠", tone: "primary" },
  { id: "sick",     label: "Krankheit",   sub: "Krankschreibung",        emoji: "🏥", tone: "rust" },
  { id: "vacation", label: "Urlaub",      sub: "Geplant oder spontan",   emoji: "🏖", tone: "moss" }
  // Feiertage werden zentral aus lib/holidays.ts gepflegt — keine Mitarbeiter-Eingabe nötig
];

export default function Entry() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navAssignment = (location.state as EntryNavState | null)?.assignment ?? null;
  // Datum aus URL-Param ?date=YYYY-MM-DD oder vom Assignment, sonst heute
  const targetDate = searchParams.get("date") ?? navAssignment?.date ?? todayIso();
  const isPastDay = targetDate < todayIso();

  const [assignment, setAssignment] = useState<Assignment | null>(navAssignment);
  const [todaySite, setTodaySite] = useState<Site | null>(null);
  const [step, setStep] = useState<Step>(navAssignment ? "activity" : "type");
  const [type, setType] = useState<EntryType>("work");

  const [discipline, setDiscipline] = useState<Discipline>(navAssignment?.discipline ?? "PFL");
  const [startMin, setStartMin] = useState(navAssignment?.plannedStartMin ?? DEFAULT_PLAN.startMin);
  const [endMin, setEndMin] = useState(navAssignment?.plannedEndMin ?? DEFAULT_PLAN.endMin);
  const [pause, setPause] = useState(navAssignment?.plannedPauseMin ?? DEFAULT_PLAN.pauseMin);

  const [absStart, setAbsStart] = useState(targetDate);
  const [absEnd, setAbsEnd] = useState("");
  const [absNote, setAbsNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  // Fotos
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<EntryPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Bestehenden Eintrag für targetDate laden — falls vorhanden, in Edit-Modus springen
  useEffect(() => {
    const me = currentUser();
    if (!me) return;
    listEntries(me.id, targetDate, targetDate)
      .then((entries) => {
        const ex = entries[0];
        if (!ex) return;
        setExistingId(ex.id);
        if (ex.type === "work") {
          setType("work");
          setDiscipline(ex.discipline);
          setStartMin(ex.startMin);
          setEndMin(ex.endMin);
          setPause(ex.pauseMin);
          // Synthetic Assignment, damit ActivityTime die Site rendert
          setAssignment({
            id: "edit",
            workerId: me.id,
            date: targetDate,
            siteId: ex.siteId,
            discipline: ex.discipline
          });
          setStep("activity");
        } else {
          setType(ex.type);
          setAbsStart(ex.date);
          setAbsEnd(ex.endDate ?? "");
          setAbsNote(ex.note ?? "");
          setStep("absence");
        }
      })
      .catch((e) => console.warn("[entry] load existing", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDate]);

  // Zuweisung für targetDate laden, falls nicht via Navigation übergeben
  useEffect(() => {
    if (assignment) return;
    const me = currentUser();
    if (!me) return;
    getTodayAssignment(me.id, targetDate)
      .then((a) => {
        if (!a) return;
        setAssignment(a);
        setDiscipline(a.discipline);
        setStartMin(a.plannedStartMin ?? DEFAULT_PLAN.startMin);
        setEndMin(a.plannedEndMin ?? DEFAULT_PLAN.endMin);
        setPause(a.plannedPauseMin ?? DEFAULT_PLAN.pauseMin);
      })
      .catch((e) => console.warn("[entry] getAssignment", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDate]);

  // Site-Daten zur Anzeige holen, sobald wir wissen welche Baustelle
  useEffect(() => {
    if (!assignment) return;
    listSites()
      .then((sites) => setTodaySite(sites.find((s) => s.id === assignment.siteId) ?? null))
      .catch(() => { });
  }, [assignment]);

  // Bestehende Fotos für Edit-Modus laden
  useEffect(() => {
    if (!existingId) return;
    listEntryPhotos(existingId)
      .then(setExistingPhotos)
      .catch((e) => console.warn("[entry] listEntryPhotos", e));
  }, [existingId]);

  function handleAddPhotos(files: File[]) {
    setPendingPhotos((prev) => [...prev, ...files]);
  }
  function handleRemovePending(index: number) {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index));
  }
  async function handleDeleteExisting(photo: EntryPhoto) {
    await deleteEntryPhoto(photo);
    setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
  }

  const totalMin = Math.max(0, endMin - startMin - pause);

  function handleTypeSelect(t: EntryType) {
    setType(t);
    if (t === "work") {
      setStep(assignment ? "activity" : "nowork");
    } else {
      setStep("absence");
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaveError(null);
    const me = currentUser();
    if (!me) { navigate("/login"); return; }

    const draft =
      type === "work"
        ? {
            type: "work" as const,
            workerId: me.id,
            date: targetDate,
            siteId: assignment!.siteId,
            discipline,
            startMin,
            endMin,
            pauseMin: pause,
            geoVerified: false
          }
        : {
            type,
            workerId: me.id,
            date: absStart,
            endDate: absEnd || absStart,
            note: absNote || undefined
          };

    setSaving(true);
    console.log("[entry] save start", { ...draft, mode: existingId ? "update" : "insert" });
    try {
      const entryId = await Promise.race<string>([
        saveEntryWithSync(draft, existingId ?? undefined),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Zeitüberschreitung beim Speichern")), 30000)
        )
      ]);
      console.log("[entry] save ok", entryId);

      // Fotos hochladen — nur wenn echte UUID (kein local-Offline-Id)
      if (pendingPhotos.length > 0 && !entryId.startsWith("local-")) {
        setPhotoBusy(true);
        const companyId = me.companyId ?? await getCurrentCompanyId();
        if (!companyId) {
          setSaveError("Fotos konnten nicht hochgeladen werden, bitte neu anmelden");
        } else {
          const stampContext = {
            siteName: todaySite?.name,
            projectNumber: todaySite?.projectNumber
          };
          let failed = 0;
          for (let i = 0; i < pendingPhotos.length; i++) {
            try {
              await uploadEntryPhoto({
                file: pendingPhotos[i],
                entryId,
                workerId: me.id,
                companyId,
                stampContext,
                position: existingPhotos.length + i
              });
            } catch (err) {
              console.warn("[entry] photo upload failed", err);
              failed++;
            }
          }
          if (failed > 0) {
            setSaveError(`${failed} von ${pendingPhotos.length} Fotos konnten nicht hochgeladen werden`);
            setPhotoBusy(false);
            setSaving(false);
            // Eintrag ist gespeichert — wir bleiben auf der Seite, damit der User
            // die fehlgeschlagenen Fotos erneut hinzufügen kann
            return;
          }
        }
        setPhotoBusy(false);
      } else if (pendingPhotos.length > 0 && entryId.startsWith("local-")) {
        // Offline: Fotos können noch nicht hochgeladen werden
        setSaveError("Eintrag offline gespeichert, Fotos bitte später hinzufügen, wenn wieder online");
        setSaving(false);
        return;
      }

      navigate("/", { replace: true });
    } catch (err: any) {
      console.warn("[entry] save FAIL", err);
      // Bei echtem Offline ODER Timeout/Netzfehler trotz „onLine": Eintrag
      // lokal in die Outbox legen, damit nichts verloren geht. Der
      // OfflineIndicator zeigt „⏱ 1 Eintrag wartet", sync läuft automatisch
      // beim nächsten Online-Werden bzw. App-Start.
      // Einschränkung: Offline-Update bestehender Einträge wird nicht
      // unterstützt — dort zeigen wir den Fehler und der User probiert neu.
      const looksLikeNetIssue =
        !navigator.onLine
        || /Zeitüberschreitung/i.test(err?.message ?? "")
        || /Failed to fetch|NetworkError|TypeError/i.test(err?.message ?? "");
      if (!existingId && looksLikeNetIssue) {
        try {
          await queueEntry(draft);
          navigate("/", { replace: true });
          return;
        } catch (qErr) {
          console.warn("[entry] queue FAIL", qErr);
        }
      }
      if (!navigator.onLine) {
        navigate("/", { replace: true });
        return;
      }
      setSaveError(err?.message ?? "Speichern fehlgeschlagen");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existingId) return;
    if (!confirm("Diesen Eintrag wirklich löschen?")) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deleteEntry(existingId);
      navigate("/", { replace: true });
    } catch (err: any) {
      setSaveError(err?.message ?? "Löschen fehlgeschlagen");
      setSaving(false);
    }
  }

  if (step === "type") return <TypePicker date={targetDate} onPick={handleTypeSelect} />;
  if (step === "absence")
    return (
      <AbsencePicker
        type={type as Exclude<EntryType, "work">}
        startDate={absStart}
        endDate={absEnd}
        note={absNote}
        onStart={setAbsStart}
        onEnd={setAbsEnd}
        onNote={setAbsNote}
        onBack={() => setStep("type")}
        onSave={handleSave}
        onDelete={existingId ? handleDelete : undefined}
        saving={saving}
        error={saveError}
        existingPhotos={existingPhotos}
        pendingPhotos={pendingPhotos}
        onAddPhotos={handleAddPhotos}
        onRemovePending={handleRemovePending}
        onDeleteExisting={handleDeleteExisting}
        photoBusy={photoBusy}
      />
    );
  if (step === "nowork") return <NoWorkScreen date={targetDate} onBack={() => setStep("type")} />;
  return (
    <ActivityTime
      date={targetDate}
      isPast={isPastDay}
      site={todaySite}
      assignment={assignment!}
      discipline={discipline}
      onDiscipline={setDiscipline}
      startMin={startMin}
      endMin={endMin}
      pause={pause}
      totalMin={totalMin}
      onStart={setStartMin}
      onEnd={setEndMin}
      onPause={setPause}
      onBack={() => navAssignment ? navigate("/") : setStep("type")}
      onSave={handleSave}
      onDelete={existingId ? handleDelete : undefined}
      saving={saving}
      error={saveError}
      existingPhotos={existingPhotos}
      pendingPhotos={pendingPhotos}
      onAddPhotos={handleAddPhotos}
      onRemovePending={handleRemovePending}
      onDeleteExisting={handleDeleteExisting}
      photoBusy={photoBusy}
    />
  );
}

// ===== TYPE PICKER =====

function TypePicker({ date, onPick }: { date: string; onPick: (t: EntryType) => void }) {
  const isToday = date === todayIso();
  const dateLabel = new Date(date).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long"
  });
  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <Link to="/" className="h-mono text-ink-2 text-[12px]">← Zurück</Link>
        <span className="h-mono text-copper text-[11px]">{isToday ? "Heute" : "Nachtrag"}</span>
      </header>

      <h1 className="h-display text-3xl mt-6">Was war {isToday ? "heute" : "an diesem Tag"}?</h1>
      <p className="h-mono text-ink-2 text-[12px] mt-1.5">{dateLabel}</p>

      <div className="grid grid-cols-2 gap-3 mt-8 flex-1 content-start">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onPick(opt.id)}
            className="dd-card is-click aspect-square flex flex-col items-center justify-center gap-3 active:scale-[0.98]"
            style={{ ["--c" as any]:
              opt.tone === "primary" ? "#DC6E2D"
              : opt.tone === "rust" ? "#B91C1C"
              : opt.tone === "moss" ? "#1F7A3D"
              : "#A9AEB3" }}
          >
            <span className="text-4xl">{opt.emoji}</span>
            <div className="text-center">
              <div className="h-display text-xl">{opt.label}</div>
              <div className="h-mono text-ink-2 text-[12px] mt-1 px-2">{opt.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

// ===== NOWORK (kein Plan heute) =====

function NoWorkScreen({ date, onBack }: { date: string; onBack: () => void }) {
  const isToday = date === todayIso();
  const dateLabel = new Date(date).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long"
  });
  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-ink-2 text-[12px]">← Zurück</button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="text-6xl mb-4">🤔</div>
        <h1 className="h-display text-3xl">Keine Baustelle hinterlegt</h1>
        <p className="mt-2 h-mono text-copper text-[11px]">{dateLabel}</p>
        <p className="mt-4 text-ink-body text-sm leading-relaxed max-w-xs">
          {isToday
            ? "Für heute wurde dir vom Büro noch keine Baustelle zugewiesen."
            : "Für diesen Tag wurde dir keine Baustelle zugewiesen, das Büro muss das im Wochenplan nachtragen."}
        </p>
        <p className="mt-4 text-ink-2 text-[13px] leading-relaxed max-w-xs">
          Frag kurz im Büro, sobald die Zuweisung steht, taucht hier die Baustelle automatisch auf.
        </p>
      </div>

      <Link to="/" className="btn-primary w-full">Zurück zur Übersicht</Link>
    </main>
  );
}

// ===== ABSENCE PICKER =====

function AbsencePicker({
  type, startDate, endDate, note, onStart, onEnd, onNote, onBack, onSave, onDelete, saving, error,
  existingPhotos, pendingPhotos, onAddPhotos, onRemovePending, onDeleteExisting, photoBusy
}: {
  type: Exclude<EntryType, "work">;
  startDate: string;
  endDate: string;
  note: string;
  onStart: (s: string) => void;
  onEnd: (s: string) => void;
  onNote: (s: string) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  existingPhotos: EntryPhoto[];
  pendingPhotos: File[];
  onAddPhotos: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onDeleteExisting: (photo: EntryPhoto) => Promise<void>;
  photoBusy: boolean;
}) {
  const labels = {
    sick:     { title: "Krankheit", emoji: "🏥", note: "z. B. Arzt-Attest, Hausarzt …" },
    vacation: { title: "Urlaub",    emoji: "🏖", note: "z. B. Brückentag, Familie …" },
    holiday:  { title: "Feiertag",  emoji: "🎉", note: "z. B. Christi Himmelfahrt" }
  };
  const meta = labels[type];
  const days = endDate
    ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
    : 1;

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top max-w-md mx-auto pb-32">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-ink-2 text-[12px]">← Zurück</button>
      </header>

      <div className="mt-6 flex items-center gap-4">
        <div className="text-5xl">{meta.emoji}</div>
        <div>
          <h1 className="h-display text-3xl">{meta.title}</h1>
          <p className="h-mono text-ink-2 text-[12px] mt-1">{days} {days === 1 ? "Tag" : "Tage"}</p>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <DateField label="Von" value={startDate} onChange={onStart} />
        <DateField label="Bis (optional)" value={endDate} onChange={onEnd} placeholder="leer = nur ein Tag" />

        <div>
          <label className="h-mono text-copper text-[12px] block mb-1.5">Notiz (optional)</label>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={meta.note}
            rows={2}
            className="w-full bg-white border border-steel rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-copper resize-none"
          />
        </div>
      </div>

      <PhotoStrip
        existing={existingPhotos}
        pending={pendingPhotos}
        onAddFiles={onAddPhotos}
        onRemovePending={onRemovePending}
        onDeleteExisting={onDeleteExisting}
        disabled={saving}
        busy={photoBusy}
      />

      <div className="fixed bottom-0 left-0 right-0 bg-bg-DEFAULT border-t border-ink/10 px-6 pt-3 safe-bottom z-30">
        <div className="max-w-md mx-auto">
          {error && <div className="text-[12px] text-rust mb-2 leading-snug">{error}</div>}
          <div className="flex gap-2">
            {onDelete && (
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-4 py-3 rounded-xl border border-rust/40 text-rust font-mono text-xs uppercase tracking-wide disabled:opacity-50"
              >
                Löschen
              </button>
            )}
            <button
              onClick={onSave}
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {saving ? (photoBusy ? "Fotos hoch …" : "Speichert …") : onDelete ? `Speichern · ${days} ${days === 1 ? "Tag" : "Tage"}` : `${meta.title} eintragen · ${days} ${days === 1 ? "Tag" : "Tage"}`}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function DateField({
  label, value, onChange, placeholder
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="h-mono text-copper text-[12px] block mb-1.5">{label}</label>
      <input
        type="date"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-steel rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-copper"
      />
    </div>
  );
}

// ===== ACTIVITY TIME =====

function ActivityTime({
  date, isPast, site, assignment, discipline, onDiscipline,
  startMin, endMin, pause, totalMin,
  onStart, onEnd, onPause,
  onBack, onSave, onDelete, saving, error,
  existingPhotos, pendingPhotos, onAddPhotos, onRemovePending, onDeleteExisting, photoBusy
}: {
  date: string;
  isPast: boolean;
  site: Site | null;
  assignment: Assignment;
  discipline: Discipline;
  onDiscipline: (d: Discipline) => void;
  startMin: number;
  endMin: number;
  pause: number;
  totalMin: number;
  onStart: (m: number) => void;
  onEnd: (m: number) => void;
  onPause: (p: number) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  existingPhotos: EntryPhoto[];
  pendingPhotos: File[];
  onAddPhotos: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onDeleteExisting: (photo: EntryPhoto) => Promise<void>;
  photoBusy: boolean;
}) {
  const dateLabel = new Date(date).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long"
  });
  return (
    <main className="min-h-screen flex flex-col px-6 safe-top max-w-md mx-auto pb-32">
      <header className="pt-3 flex items-center justify-between">
        <button onClick={onBack} className="h-mono text-ink-2 text-[12px]">← Zurück</button>
        <span className="h-mono text-copper">{isPast ? "Nachtrag" : "Heute · vom Büro geplant"}</span>
      </header>

      <div className="mt-3 h-mono text-ink-2 text-[11px]">{dateLabel}</div>

      <div className="mt-3">
        {site?.projectNumber && (
          <div className="h-mono text-ink-2 text-[11px]">Auftrag {site.projectNumber}</div>
        )}
        <h1 className="h-display text-2xl mt-1">{site?.name ?? "Baustelle"}</h1>
        {site && (
          <div className="h-mono text-ink-2 text-[11px] mt-0.5">{site.street} · {site.city}</div>
        )}
        {assignment.note && (
          <div className="mt-2 px-3 py-2 bg-bg-2 border border-copper/30 rounded-lg text-[12px] italic leading-snug">
            „{assignment.note}"
          </div>
        )}
      </div>

      <section className="mt-6">
        <div className="h-mono text-copper text-[12px] mb-2">Was wird gemacht?</div>
        <div className="grid grid-cols-3 gap-2">
          {DISCIPLINES.map((d) => {
            const active = discipline === d.id;
            return (
              <button
                key={d.id}
                onClick={() => onDiscipline(d.id)}
                className={`flex flex-col items-center gap-2 rounded-xl py-4 px-2 border transition-colors ${
                  active
                    ? "bg-copper text-bg-deep border-copper-bright"
                    : "bg-bg-3 border-transparent text-paper"
                }`}
              >
                {d.icon}
                <span className="h-mono text-[12px]">{d.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <div className="h-mono text-copper text-[12px] mb-2">Wann?</div>
        <div className="dd-card p-4 text-center" style={{ ["--c" as any]: "#DC6E2D" }}>
          <div className="h-display text-3xl text-ink">
            {fmtTime(startMin)}<span className="text-copper mx-2">bis</span>{fmtTime(endMin)}
          </div>
          <div className="h-mono text-copper text-[11px] mt-2">
            Σ Arbeitszeit · <span className="font-display text-ink text-sm">{fmtHours(totalMin)} h</span>
          </div>
        </div>

        <TimeSlider value={startMin} onChange={onStart} label="Anfang" />
        <TimeSlider value={endMin}   onChange={onEnd}   label="Ende" />

        <div className="dd-card px-4 py-3 mt-3 flex items-center justify-between" style={{ ["--c" as any]: "#A9AEB3" }}>
          <div>
            <div className="h-mono text-ink-2 text-[12px]">Pause</div>
            <div className="font-semibold text-ink">{pause} Minuten</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => onPause(Math.max(0, pause - 15))} className="w-8 h-8 rounded-full bg-white border border-steel font-bold text-ink">−</button>
            <span className="h-display text-xl w-9 text-center text-ink">{pause}</span>
            <button onClick={() => onPause(pause + 15)} className="w-8 h-8 rounded-full bg-white border border-steel font-bold text-ink">+</button>
          </div>
        </div>
      </section>

      <PhotoStrip
        existing={existingPhotos}
        pending={pendingPhotos}
        onAddFiles={onAddPhotos}
        onRemovePending={onRemovePending}
        onDeleteExisting={onDeleteExisting}
        disabled={saving}
        busy={photoBusy}
      />

      <div className="fixed bottom-0 left-0 right-0 bg-bg-DEFAULT border-t border-ink/10 px-6 pt-3 safe-bottom z-30">
        <div className="max-w-md mx-auto">
          {error && <div className="text-[12px] text-rust mb-2 leading-snug">{error}</div>}
          <div className="flex gap-2">
            {onDelete && (
              <button
                onClick={onDelete}
                disabled={saving}
                className="px-4 py-3 rounded-xl border border-rust/40 text-rust font-mono text-xs uppercase tracking-wide disabled:opacity-50"
              >
                Löschen
              </button>
            )}
            <button
              onClick={onSave}
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {saving ? (photoBusy ? "Fotos hoch …" : "Speichert …") : `Speichern · ${fmtHours(totalMin)} h`}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function TimeSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const min = 6 * 60, max = 18 * 60, step = 15;
  return (
    <div className="mt-3">
      <div className="flex justify-between h-mono text-ink-2 text-[11px] mb-1">
        <span>{label}</span>
        <span>{fmtTime(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-copper"
      />
    </div>
  );
}
