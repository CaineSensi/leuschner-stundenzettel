import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { syncWorkerFromSession, completeOnboarding } from "../lib/auth";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Supabase verarbeitet den URL-Hash automatisch (detectSessionInUrl: true).
      // Wir warten kurz und holen dann die Session.
      await new Promise((r) => setTimeout(r, 400));

      const worker = await syncWorkerFromSession();
      if (cancelled) return;

      if (!worker) {
        setError("Konnte deinen Account nicht finden. Frage Rick, ob deine Email hinterlegt ist.");
        return;
      }

      completeOnboarding();
      navigate(worker.isAdmin ? "/admin" : "/", { replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-8 text-center max-w-md mx-auto">
      <Logo />
      {error ? (
        <>
          <p className="h-mono text-rust mt-6 text-[12px]">Anmeldung fehlgeschlagen</p>
          <p className="text-sm text-paper/70 mt-2">{error}</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="btn-ghost mt-6"
          >
            Zurück zum Login
          </button>
        </>
      ) : (
        <>
          <p className="h-mono text-copper mt-6 text-[12px]">Anmelden …</p>
          <p className="text-sm text-paper/70 mt-2">Session wird geprüft</p>
        </>
      )}
    </main>
  );
}
