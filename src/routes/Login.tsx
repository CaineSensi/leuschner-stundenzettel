import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { signInWithCode } from "../lib/auth";

export default function Login() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit() {
    const c = code.toUpperCase();
    if (c.length !== 6) return;
    setStatus("checking");
    setErrorMsg("");
    const res = await signInWithCode(c);
    if (res.error) {
      setErrorMsg(res.error);
      setStatus("error");
      return;
    }
    if (res.worker) {
      navigate(res.worker.isAdmin ? "/admin" : "/", { replace: true });
    }
  }

  return (
    <main className="min-h-screen flex flex-col px-6 py-8 safe-top safe-bottom max-w-md mx-auto">
      <header>
        <Logo />
        <p className="h-mono text-paper/55 mt-1 text-[12px]">
          Rund um's Haus · Stundenzettel
        </p>
      </header>

      <section className="flex-1 flex flex-col mt-10">
        <h1 className="h-display text-3xl">Anmelden</h1>
        <p className="mt-2 text-paper/75 text-[14px] leading-relaxed">
          Gib den 6-stelligen Code ein, den du vom Büro per QR oder auf Papier bekommen hast.
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
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
            setStatus("idle");
          }}
          className="mt-4 bg-bg-3 border border-ink/15 rounded-lg px-4 py-3 font-mono tracking-widest text-paper text-center text-xl focus:outline-none focus:border-copper"
          placeholder="······"
          maxLength={6}
        />

        {status === "error" && (
          <p className="text-rust text-[12px] mt-3">{errorMsg}</p>
        )}

        <button
          disabled={code.length !== 6 || status === "checking"}
          onClick={handleSubmit}
          className="btn-primary w-full mt-8 disabled:opacity-40"
        >
          {status === "checking" ? "Prüfe Code …" : "Code einlösen"}
        </button>
      </section>

      <div className="text-center mt-6">
        <Link to="/buero" className="h-mono text-paper/55 text-[11px] hover:text-copper">
          Bist du Admin? → Büro-Login
        </Link>
      </div>
    </main>
  );
}
