import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { login } from "../lib/auth";
import { listWorkers } from "../lib/api";
import { isBackendConnected } from "../lib/supabase";
import type { Worker } from "../lib/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; workers: Worker[] }
  | { status: "error"; message: string };

export default function Login() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const workers = await listWorkers();
        if (cancelled) return;
        setState({ status: "ready", workers });
      } catch (err: any) {
        if (cancelled) return;
        setState({ status: "error", message: err?.message ?? "Verbindung fehlgeschlagen" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function loginAs(worker: Worker) {
    login(worker);
    navigate(worker.isAdmin ? "/admin" : "/", { replace: true });
  }

  if (state.status === "loading") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-8 text-center">
        <Logo />
        <p className="h-mono text-paper/45 mt-6 text-[12px]">— Mitarbeiter werden geladen …</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-8 text-center">
        <Logo />
        <p className="h-mono text-rust mt-6 text-[12px]">— Verbindungs­fehler</p>
        <p className="text-sm text-paper/70 mt-2">{state.message}</p>
      </main>
    );
  }

  // Admins werden NICHT als Demo-Login angezeigt — Admin-Zugang ausschließlich über Magic-Link.
  const chefs  = state.workers.filter((w) => !w.isAdmin && w.role.startsWith("Inhaber"));
  const team   = state.workers.filter((w) => !w.isAdmin && !w.role.startsWith("Inhaber"));

  return (
    <main className="min-h-screen flex flex-col px-6 py-8 safe-top safe-bottom max-w-md mx-auto">
      <header>
        <Logo />
        <p className="h-mono text-paper/50 mt-1 text-[12px]">
          Rund um's Haus · Stundenzettel
        </p>
        {isBackendConnected() ? (
          <p className="h-mono text-good mt-1 text-[11px]">
            ● Live · {state.workers.length} Mitarbeiter aus Frankfurt
          </p>
        ) : (
          <p className="h-mono text-paper/40 mt-1 text-[11px]">
            ○ Mock-Modus
          </p>
        )}
      </header>

      <section className="flex-1 flex flex-col gap-4 mt-8">

        {chefs.length > 0 && (
          <Section title={chefs.length === 1 ? "Inhaber" : "Inhaber & Geschäftsführung"} tone="paper">
            {chefs.map((w) => (
              <WorkerCard key={w.id} worker={w} onClick={() => loginAs(w)} />
            ))}
          </Section>
        )}

        {team.length > 0 && (
          <Section title="Mitarbeiter" tone="paper">
            {team.map((w) => (
              <WorkerCard key={w.id} worker={w} onClick={() => loginAs(w)} />
            ))}
          </Section>
        )}
      </section>

      <p className="h-mono text-paper/40 text-center text-[11px] leading-relaxed mt-6">
        Im echten Betrieb läuft jede Anmeldung<br />
        über Einladungs-<strong className="text-copper">Code</strong>.
      </p>
    </main>
  );
}

function Section({
  title, tone, children
}: {
  title: string;
  tone: "copper" | "paper";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`h-mono text-[11px] mb-2 ml-1 ${tone === "copper" ? "text-copper" : "text-paper/45"}`}>
        — {title}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function WorkerCard({
  worker, highlight, onClick
}: {
  worker: Worker;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-bg-2 rounded-2xl p-4 flex items-center gap-4 active:scale-[0.99] transition-transform text-left ${
        highlight ? "border border-copper" : "border border-ink/10"
      }`}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-display font-extrabold text-lg flex-shrink-0 ${
        highlight
          ? "bg-gradient-to-br from-copper-bright to-copper text-bg-deep shadow-lg"
          : "bg-bg-4 text-copper-bright"
      }`}>
        {worker.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`h-mono text-[12px] ${highlight ? "text-copper" : "text-paper/55"}`}>
          — {worker.role}
        </div>
        <div className="h-display text-lg mt-0.5">{worker.firstName} {worker.lastName}</div>
      </div>
      <span className={`text-2xl flex-shrink-0 ${highlight ? "text-copper" : "text-paper/40"}`}>→</span>
    </button>
  );
}
