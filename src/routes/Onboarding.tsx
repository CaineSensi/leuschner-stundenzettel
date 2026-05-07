import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";
import {
  completeOnboarding, currentUser, login, signInWithCode
} from "../lib/auth";
import { ADMIN_WORKER } from "../lib/mockData";
import type { Worker } from "../lib/types";

const STEPS = ["Code", "Profil", "PIN", "Berechtigungen", "Fertig"] as const;

export default function Onboarding() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [worker, setWorker] = useState<Worker | null>(currentUser());

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  }

  function finish() {
    completeOnboarding();
    const u = worker ?? currentUser();
    if (u?.isAdmin) navigate("/admin", { replace: true });
    else navigate("/", { replace: true });
  }

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="flex items-center justify-between pt-2">
        <Logo />
        <span className="h-mono text-copper">
          Schritt {step + 1} / {STEPS.length}
        </span>
      </header>

      <div className="mt-6 flex gap-1">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i <= step ? "bg-copper" : "bg-bg-3"}`}
          />
        ))}
      </div>

      <section className="flex-1 flex flex-col mt-10">
        {step === 0 && (
          <CodeStep
            initialCode={params.get("code") ?? ""}
            onSuccess={(w) => { setWorker(w); next(); }}
            onSkip={() => { login(ADMIN_WORKER); setWorker(ADMIN_WORKER); next(); }}
          />
        )}
        {step === 1 && <ProfileStep worker={worker ?? ADMIN_WORKER} onNext={next} />}
        {step === 2 && <PinStep onNext={next} />}
        {step === 3 && <PermissionsStep onNext={next} />}
        {step === 4 && <DoneStep worker={worker ?? ADMIN_WORKER} onNext={finish} />}
      </section>
    </main>
  );
}

function CodeStep({
  initialCode, onSuccess, onSkip
}: {
  initialCode: string;
  onSuccess: (worker: Worker) => void;
  onSkip: () => void;
}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const valid = code.length === 6;

  useEffect(() => {
    // Wenn Code aus URL kam, automatisch versuchen
    if (initialCode.length === 6) {
      setCode(initialCode.toUpperCase());
      handleSubmit(initialCode.toUpperCase());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(c?: string) {
    const codeToUse = (c ?? code).toUpperCase();
    if (codeToUse.length !== 6) return;
    setStatus("checking");
    const res = await signInWithCode(codeToUse);
    if (res.error) {
      setErrorMsg(res.error);
      setStatus("error");
      return;
    }
    if (res.worker) {
      onSuccess(res.worker);
    }
  }

  return (
    <>
      <h1 className="h-display text-3xl">Einladungs-Code</h1>
      <p className="mt-2 text-paper/70 text-sm leading-relaxed">
        Sechs Stellen, die du per WhatsApp bekommen hast — auf Zettel, per SMS oder im Hof zugerufen.
      </p>

      <div className="mt-8 grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-14 rounded-lg flex items-center justify-center font-display font-extrabold text-2xl ${
              i < code.length
                ? "bg-bg-4 text-paper"
                : i === code.length
                ? "bg-bg-3 border border-copper text-copper animate-pulse"
                : "bg-bg-3 text-transparent"
            }`}
          >
            {code[i] ?? "_"}
          </div>
        ))}
      </div>

      <input
        autoFocus
        value={code}
        onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 6)); setStatus("idle"); }}
        className="mt-4 bg-bg-3 border border-ink/10 rounded-lg px-4 py-3 font-mono tracking-widest text-paper focus:outline-none focus:border-copper"
        placeholder="Code eingeben"
        maxLength={6}
      />

      {status === "error" && (
        <p className="text-rust text-[12px] mt-3">{errorMsg}</p>
      )}

      <div className="mt-auto pt-8 space-y-2">
        <button
          disabled={!valid || status === "checking"}
          onClick={() => handleSubmit()}
          className="btn-primary w-full disabled:opacity-40 disabled:active:scale-100"
        >
          {status === "checking" ? "Prüfe Code …" : "Code einlösen"}
        </button>
        <button
          onClick={onSkip}
          className="btn-ghost w-full"
        >
          Demo · ohne Code überspringen
        </button>
      </div>
    </>
  );
}

function ProfileStep({ worker, onNext }: { worker: Worker; onNext: () => void }) {
  return (
    <>
      <h1 className="h-display text-3xl">Bist du das?</h1>

      <div className="flex flex-col items-center mt-10 gap-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-copper-bright to-copper text-bg-deep flex items-center justify-center font-display font-extrabold text-3xl shadow-xl">
          {worker.initials}
        </div>
        <div className="text-center">
          <h2 className="h-display text-2xl">{worker.firstName} {worker.lastName}</h2>
          <p className="h-mono text-paper/55 mt-1">— {worker.role} —</p>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t border-ink/10 text-center">
        <p className="h-mono text-paper/55">
          {worker.isAdmin ? "Inhaber-Account" : "Eingeladen von"}
        </p>
        <p className="font-semibold text-paper mt-1">
          {worker.isAdmin ? "Rund um's Haus Leuschner e.K." : "Rick Kohlberg"}
        </p>
        <p className="h-mono text-paper/40 mt-1">Weener · Ostfriesland</p>
      </div>

      <div className="mt-auto pt-8 space-y-2">
        <button onClick={onNext} className="btn-primary w-full">Ja, das bin ich</button>
        <button className="btn-ghost w-full">Nicht ich? Code prüfen</button>
      </div>
    </>
  );
}

function PinStep({ onNext }: { onNext: () => void }) {
  const [pin, setPin] = useState("");

  function tap(n: string) {
    if (n === "<") return setPin(pin.slice(0, -1));
    if (pin.length < 4) setPin(pin + n);
  }

  const filled = pin.length === 4;

  return (
    <>
      <h1 className="h-display text-3xl">Such dir einen PIN aus</h1>
      <p className="mt-2 text-paper/70 text-sm leading-relaxed">
        Vier Ziffern, die du dir merken kannst. Brauchst du falls Fingerabdruck mal nicht geht.
      </p>

      <div className="flex justify-center gap-4 mt-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 border-copper ${i < pin.length ? "bg-copper" : ""}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-8">
        {["1","2","3","4","5","6","7","8","9","","0","<"].map((n, i) => (
          <button
            key={i}
            onClick={() => n && tap(n)}
            disabled={!n}
            className="h-14 rounded-lg bg-bg-3 border border-ink/10 font-display font-extrabold text-xl active:scale-95 transition-transform disabled:opacity-0"
          >
            {n === "<" ? "←" : n}
          </button>
        ))}
      </div>

      <div className="mt-auto pt-6">
        <button
          disabled={!filled}
          onClick={onNext}
          className="btn-primary w-full disabled:opacity-40"
        >
          PIN bestätigen
        </button>
        <p className="h-mono text-paper/40 text-center mt-3 text-[12px]">
          Wird nur lokal auf dem Gerät gespeichert
        </p>
      </div>
    </>
  );
}

function PermissionsStep({ onNext }: { onNext: () => void }) {
  const [bio, setBio] = useState(true);
  const [geo, setGeo] = useState(true);

  return (
    <>
      <h1 className="h-display text-3xl">Komfort &amp; Standort</h1>

      <div className="mt-8 space-y-3">
        <Toggle
          on={bio}
          onChange={setBio}
          title="Fingerabdruck"
          subtitle="Schnell ohne PIN öffnen"
        />
        <Toggle
          on={geo}
          onChange={setGeo}
          title="Standort erkennen"
          subtitle="Baustelle automatisch vorschlagen"
        />
      </div>

      <div className="mt-6 border-l-2 border-bronze bg-bronze/10 rounded-r-md px-3 py-3 text-xs leading-relaxed">
        <strong className="text-copper">Hinweis:</strong> Standort wird nur einmal beim Eintragen geprüft — kein Tracking, kein Bewegungs­profil.
      </div>

      <div className="mt-auto pt-8">
        <button onClick={onNext} className="btn-primary w-full">
          Einwilligen &amp; weiter
        </button>
      </div>
    </>
  );
}

function DoneStep({ worker, onNext }: { worker: Worker; onNext: () => void }) {
  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-copper-bright to-copper text-bg-deep font-display font-extrabold text-3xl flex items-center justify-center shadow-xl">
          ✓
        </div>
        <h1 className="h-display text-3xl mt-6">Geschafft, {worker.firstName}!</h1>
        <p className="mt-2 text-paper/70 text-sm leading-relaxed max-w-xs">
          Plus drücken, eintragen, fertig. Frag {worker.isAdmin ? "im Team" : "Rick"}, wenn was klemmt.
        </p>

        <ul className="mt-8 space-y-1.5 font-mono text-xs text-paper/70">
          <li><span className="text-good font-bold mr-2">✓</span>Account verknüpft</li>
          <li><span className="text-good font-bold mr-2">✓</span>PIN gesetzt</li>
          <li><span className="text-good font-bold mr-2">✓</span>Fingerabdruck aktiv</li>
          <li><span className="text-good font-bold mr-2">✓</span>Standort-Erkennung an</li>
        </ul>
      </div>

      <button onClick={onNext} className="btn-primary w-full mt-6">
        Los geht's →
      </button>
    </>
  );
}

function Toggle({
  on, onChange, title, subtitle
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="w-full bg-bg-3 rounded-xl px-4 py-3 flex items-center gap-3 text-left active:bg-bg-4 transition-colors"
    >
      <div className="flex-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-paper/55">{subtitle}</div>
      </div>
      <div className={`w-10 h-6 rounded-full relative transition-colors ${on ? "bg-copper" : "bg-bg-4"}`}>
        <div className={`absolute top-1 w-4 h-4 rounded-full transition-all ${on ? "left-5 bg-bg-deep" : "left-1 bg-paper/55"}`} />
      </div>
    </button>
  );
}
