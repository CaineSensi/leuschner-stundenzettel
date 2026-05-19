import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { signInWithPassword } from "../lib/auth";
import { isBackendConnected } from "../lib/supabase";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("checking");
    const res = await signInWithPassword(email.trim(), password);
    if (res.error) {
      setErrorMsg(res.error);
      setStatus("error");
      return;
    }
    navigate("/admin", { replace: true });
  }

  return (
    <main className="min-h-screen flex flex-col px-6 safe-top safe-bottom max-w-md mx-auto">
      <header className="pt-3">
        <Logo />
        <p className="h-mono text-copper mt-1 text-[11px]">Büro · Admin-Zugang</p>
        {isBackendConnected() ? (
          <p className="h-mono text-good mt-1 text-[11px]">● Live · Frankfurt</p>
        ) : (
          <p className="h-mono text-ink-mute mt-1 text-[11px]">○ Mock-Modus</p>
        )}
      </header>

      <section className="flex-1 flex flex-col justify-center -mt-8">
        <h1 className="h-display text-3xl">Anmelden</h1>
        <p className="text-ink-body text-sm mt-2 leading-relaxed">
          Mit Email und Passwort einloggen.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-3">
          <div>
            <label className="h-mono text-copper text-[11px] block mb-1.5">Email</label>
            <input
              type="email"
              autoFocus
              autoComplete="email"
              required
              placeholder="rick@…"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
              className="w-full bg-bg-2 border border-ink/15 rounded-xl px-4 py-3 text-paper focus:outline-none focus:border-copper text-sm"
            />
          </div>

          <div>
            <label className="h-mono text-copper text-[11px] block mb-1.5">Passwort</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setStatus("idle"); }}
              className="w-full bg-bg-2 border border-ink/15 rounded-xl px-4 py-3 text-paper focus:outline-none focus:border-copper text-sm tracking-wider"
            />
          </div>

          {status === "error" && (
            <p className="text-rust text-[12px]">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === "checking" || !email.trim() || !password}
            className="btn-primary w-full disabled:opacity-50"
          >
            {status === "checking" ? "Prüfe …" : "Anmelden"}
          </button>
        </form>

        <p className="h-mono text-ink-mute text-center text-[11px] leading-relaxed mt-8">
          Passwort vergessen? Im Supabase-Dashboard zurücksetzen.<br />
          Mitarbeiter-Anmeldung läuft über separate URL.
        </p>
      </section>
    </main>
  );
}
