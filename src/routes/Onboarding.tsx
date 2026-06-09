import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";
import {
  completeOnboarding, currentUser, signInWithCode
} from "../lib/auth";
import type { Worker } from "../lib/types";

const STEPS = ["Code", "Profil", "Fertig"] as const;

function isStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-ignore iOS-Standalone
    window.navigator.standalone === true
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [worker, setWorker] = useState<Worker | null>(currentUser());
  const standalone = isStandaloneMode();
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const codeFromUrl = params.get("code") ?? "";

  // Wenn der Mitarbeiter via QR oder Link auf einem iPhone-Browser landet (nicht in PWA),
  // zeigen wir zuerst die Installations-Anleitung. Sonst lebt der Login in der falschen
  // Storage und ist in der PWA-Kachel nicht da.
  if (isIOS && !standalone && codeFromUrl.length === 6 && step === 0) {
    return <InstallFirstScreen code={codeFromUrl} />;
  }

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
    <main className="on-dark min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="flex items-center justify-between pt-2">
        <Logo tone="light" />
        <span className="h-mono text-copper">
          Schritt {step + 1} / {STEPS.length}
        </span>
      </header>

      <BrowserWarning />

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
            initialCode={standalone ? codeFromUrl : ""}
            onSuccess={(w) => { setWorker(w); next(); }}
          />
        )}
        {step === 1 && worker && <ProfileStep worker={worker} onNext={next} />}
        {step === 2 && worker && <DoneStep worker={worker} onNext={finish} />}
      </section>
    </main>
  );
}

function CodeStep({
  initialCode, onSuccess
}: {
  initialCode: string;
  onSuccess: (worker: Worker) => void;
}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const valid = code.length === 6;

  // Browser-Check: in Brave/Chrome/Firefox iOS NICHT automatisch einlösen,
  // sonst wird der Code „verbraucht" bevor der User nach Safari wechselt.
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isNonSafariIOS = isIOS && (/CriOS|FxiOS|EdgiOS/.test(ua) || !!(navigator as any).brave);

  useEffect(() => {
    // Wenn Code aus URL kam UND wir in Safari/Desktop sind → automatisch einlösen.
    // Sonst: Code bleibt unbenutzt, BrowserWarning oben sagt dem User, in Safari zu öffnen.
    if (initialCode.length === 6 && !isNonSafariIOS) {
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
      <p className="mt-2 text-ink-body text-sm leading-relaxed">
        Sechs Stellen, die du per WhatsApp bekommen hast, auf Zettel, per SMS oder im Hof zugerufen.
      </p>

      <div className="mt-8 grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-14 rounded-lg flex items-center justify-center font-display font-extrabold text-2xl border ${
              i < code.length
                ? "bg-white border-steel text-ink"
                : i === code.length
                ? "bg-white border-copper text-copper animate-pulse"
                : "bg-white/60 border-steel/60 text-transparent"
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
        className="mt-4 bg-white border border-steel rounded-lg px-4 py-3 font-mono tracking-widest text-ink focus:outline-none focus:border-copper"
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
          <p className="h-mono text-ink-2 mt-1">{worker.role}</p>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t border-ink/10 text-center">
        <p className="h-mono text-ink-2">
          {worker.isAdmin ? "Admin-Account" : "Eingeladen von"}
        </p>
        <p className="font-semibold text-paper mt-1">
          {worker.isAdmin ? "Rund um's Haus Leuschner e.K." : "dem Büro · Leuschner"}
        </p>
        <p className="h-mono text-ink-mute mt-1">Weener · Ostfriesland</p>
      </div>

      <div className="mt-auto pt-8 space-y-2">
        <button onClick={onNext} className="btn-primary w-full">Ja, das bin ich</button>
        <button className="btn-ghost w-full">Nicht ich? Code prüfen</button>
      </div>
    </>
  );
}

function InstallFirstScreen({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [installDone, setInstallDone] = useState(false);

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;

  useEffect(() => {
    function onBeforeInstall(e: any) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function installAndroid() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallDone(true);
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <main className="on-dark min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-2"><Logo tone="light" /></header>

      <BrowserWarning />

      <div className="mt-6">
        <div className="h-mono text-copper text-[11px]">Letzter Schritt · App installieren</div>
        <h1 className="h-display text-3xl mt-1">Fast fertig</h1>
        <p className="mt-2 text-ink-body text-[14px] leading-snug">
          Damit du die App jeden Morgen schnell findest, leg sie auf deinen Home-Bildschirm.
        </p>
      </div>

      {/* CODE prominent — wird nach Installation in der App gebraucht */}
      <div className="mt-5 bg-copper/10 border-2 border-copper rounded-xl p-4 text-center">
        <div className="h-mono text-copper text-[11px]">Merk dir deinen Code</div>
        <div className="font-display text-4xl tracking-widest mt-2 text-paper">{code}</div>
        <button
          onClick={copyCode}
          className="mt-3 h-mono text-[11px] px-3 py-1.5 rounded-full border border-copper text-copper"
        >
          {copied ? "✓ Kopiert" : "📋 Code kopieren"}
        </button>
      </div>

      {/* ANDROID / Chrome / Edge — echter Ein-Klick-Button */}
      {!isIOS && deferredPrompt && !installDone && (
        <button
          onClick={installAndroid}
          disabled={installing}
          className="mt-5 btn-primary w-full text-base py-4 disabled:opacity-60"
        >
          {installing ? "Wird installiert …" : "📲 App jetzt installieren"}
        </button>
      )}

      {/* ANDROID — fertig installiert */}
      {!isIOS && installDone && (
        <div className="mt-5 bg-good/10 border-2 border-good/40 rounded-xl p-4 text-center">
          <div className="h-display text-xl text-good">✓ App installiert</div>
          <p className="text-[13px] mt-1.5">
            Schließ diesen Browser-Tab, öffne die App vom Home-Bildschirm und gib dort den Code ein.
          </p>
        </div>
      )}

      {/* IOS — Apple lässt programmatic install nicht zu, also klare Anleitung */}
      {isIOS && (
        <div className="mt-5 dd-card p-4">
          <div className="h-mono text-copper text-[11px] mb-3">iPhone · 3 Schritte</div>
          <ol className="space-y-3 text-[13px] leading-snug">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">1</span>
              <span>Unten in Safari das <span className="inline-block px-1.5 py-0.5 bg-bg-3 rounded font-mono text-[13px]">⬆️</span> Teilen-Symbol tippen</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">2</span>
              <span>Scrollen → <strong>„Zum Home-Bildschirm"</strong> antippen → <strong>„Hinzufügen"</strong></span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">3</span>
              <span>Diese Seite schließen, App vom <strong>Home-Bildschirm</strong> öffnen, Code dort eingeben</span>
            </li>
          </ol>

          {/* animierter Pfeil zur Teilen-Schaltfläche unten */}
          <div className="mt-4 flex flex-col items-center text-copper">
            <span className="text-3xl animate-bounce">↓</span>
            <span className="h-mono text-[10px] mt-1">Teilen-Symbol unten in Safari</span>
          </div>
        </div>
      )}

      {/* DESKTOP / kein beforeinstallprompt verfügbar */}
      {!isIOS && !deferredPrompt && !installDone && (
        <div className="mt-5 dd-card p-4">
          <div className="h-mono text-copper text-[11px] mb-2">App installieren</div>
          <p className="text-[13px] leading-snug">
            Im Browser-Menü (oben rechts „⋮") findest du <strong>„App installieren"</strong> bzw. <strong>„Zum Startbildschirm hinzufügen"</strong>.
          </p>
        </div>
      )}

      <p className="mt-auto pt-4 text-[12px] text-ink-2 leading-snug text-center">
        Warum erst installieren? Auf iOS wird dein Login zwischen Safari und der App-Kachel getrennt, also lieber gleich in der App.
      </p>
    </main>
  );
}

function BrowserWarning() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-ignore iOS-Standalone
    window.navigator.standalone === true;

  // Chrome iOS=CriOS, Firefox iOS=FxiOS, Edge iOS=EdgiOS, Brave-spezifisches Object
  const isNonSafari =
    /CriOS|FxiOS|EdgiOS/.test(ua) ||
    !!(navigator as any).brave;

  const [copied, setCopied] = useState(false);

  if (!isIOS || isStandalone || !isNonSafari) return null;

  const browserName = /CriOS/.test(ua) ? "Chrome"
    : /FxiOS/.test(ua) ? "Firefox"
    : /EdgiOS/.test(ua) ? "Edge"
    : (navigator as any).brave ? "Brave"
    : "ein anderer Browser";

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-4 bg-rust/10 border-2 border-rust/40 rounded-xl p-4">
      <div className="font-bold text-[14px] text-rust mb-1">⚠️ Bitte in Safari öffnen</div>
      <p className="text-[13px] leading-snug text-ink-body">
        Du bist gerade in <strong>{browserName}</strong>. Damit du die App nachher zum
        Home-Bildschirm hinzufügen kannst, brauchst du <strong>Safari</strong>, das geht in
        anderen iOS-Browsern leider nicht.
      </p>
      <ol className="mt-3 space-y-2 text-[12px] leading-snug text-ink-body">
        <li>1. Auf <strong>„Link kopieren"</strong> unten tippen</li>
        <li>2. Safari-App auf dem iPhone öffnen</li>
        <li>3. Adressleiste antippen → einfügen → öffnen</li>
      </ol>
      <button
        onClick={copyLink}
        className="mt-3 w-full px-4 py-2.5 rounded-lg bg-copper text-bg-deep font-bold text-[13px]"
      >
        {copied ? "✓ Link kopiert" : "📋 Link kopieren"}
      </button>
    </div>
  );
}

function DoneStep({ worker, onNext }: { worker: Worker; onNext: () => void }) {
  // iOS-Standalone-Erkennung: läuft bereits als PWA?
  const isStandalone =
    (window.matchMedia("(display-mode: standalone)").matches) ||
    // @ts-ignore iOS-spezifisch
    window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  return (
    <>
      <div className="flex flex-col items-center text-center mt-2">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-copper-bright to-copper text-bg-deep font-display font-extrabold text-3xl flex items-center justify-center shadow-xl">
          ✓
        </div>
        <h1 className="h-display text-3xl mt-5">Geschafft, {worker.firstName}!</h1>
        <p className="mt-2 text-ink-body text-sm leading-relaxed max-w-xs">
          Dein Konto ist eingerichtet. Damit du die App jeden Morgen schnell findest, leg dir ein Icon auf den Startbildschirm.
        </p>
      </div>

      {!isStandalone && isIOS && (
        <div className="mt-6 dd-card p-4">
          <div className="h-mono text-copper text-[11px] mb-3">So fügst du die App hinzu</div>
          <ol className="space-y-3 text-[13px] leading-snug">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">1</span>
              <span>Unten in Safari auf das <span className="inline-block px-1.5 py-0.5 bg-bg-3 rounded font-mono text-[12px]">⬆️ Teilen</span>-Symbol tippen</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">2</span>
              <span>Im Menü scrollen bis <strong>„Zum Home-Bildschirm"</strong> erscheint, antippen</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-copper text-bg-deep font-bold flex items-center justify-center text-[12px]">3</span>
              <span>Oben rechts auf <strong>„Hinzufügen"</strong>, fertig</span>
            </li>
          </ol>
        </div>
      )}

      {!isStandalone && !isIOS && (
        <div className="mt-6 dd-card p-4">
          <div className="h-mono text-copper text-[11px] mb-2">App installieren</div>
          <p className="text-[13px] leading-snug">
            Im Browser-Menü („⋮" oben rechts) findest du <strong>„App installieren"</strong> bzw. <strong>„Zum Startbildschirm hinzufügen"</strong>.
          </p>
        </div>
      )}

      {isStandalone && (
        <div className="mt-6 bg-good/10 border border-good/30 rounded-xl p-4 text-center">
          <div className="h-mono text-good text-[11px]">Bereits installiert</div>
          <p className="text-[13px] mt-1">Du startest die App direkt vom Home-Bildschirm, perfekt.</p>
        </div>
      )}

      <button onClick={onNext} className="btn-primary w-full mt-auto mb-2">
        {isStandalone ? "Los geht's →" : "Bin drin, weiter →"}
      </button>
    </>
  );
}

