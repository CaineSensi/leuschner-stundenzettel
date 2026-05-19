import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { signInWithPassword, signInWithEmail } from "../lib/auth";
import { isBackendConnected } from "../lib/supabase";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);

  async function sendMagic() {
    if (!email.trim()) { setErrorMsg("Bitte zuerst die E-Mail eintragen"); setStatus("error"); return; }
    setMagicBusy(true); setStatus("idle");
    const res = await signInWithEmail(email.trim());
    setMagicBusy(false);
    if (res.error) { setErrorMsg(res.error); setStatus("error"); return; }
    setMagicSent(true);
  }

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
              className="w-full bg-white border border-steel rounded-xl px-4 py-3 text-ink focus:outline-none focus:border-copper text-sm"
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
              className="w-full bg-white border border-steel rounded-xl px-4 py-3 text-ink focus:outline-none focus:border-copper text-sm tracking-wider"
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

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-steel/50" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">oder</span>
          <div className="flex-1 h-px bg-steel/50" />
        </div>

        {magicSent ? (
          <div className="rounded-xl border-2 border-good/50 bg-good/10 px-4 py-3.5 text-center">
            <div className="font-display font-extrabold uppercase text-[13px] text-good">✓ Link gesendet</div>
            <p className="font-sans text-[13px] text-ink-2 mt-1 leading-snug">
              Prüf dein Postfach ({email}) und tippe auf den Anmelde-Link. Kein Passwort nötig.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={sendMagic}
            disabled={magicBusy || !email.trim()}
            className="btn-ghost w-full disabled:opacity-50"
          >
            {magicBusy ? "Sende Link …" : "Anmelde-Link per E-Mail (ohne Passwort)"}
          </button>
        )}

        <p className="font-sans text-ink-mute text-center text-[11px] leading-relaxed mt-6">
          Der Link-Weg ist für den Inhaber gedacht (kein Passwort nötig).<br />
          Passwort vergessen? Im Supabase-Dashboard zurücksetzen.
        </p>
      </section>
    </main>
  );
}
