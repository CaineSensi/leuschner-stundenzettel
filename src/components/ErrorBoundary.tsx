import React from "react";
import { reportEvent } from "../lib/diag";

interface Props { children: React.ReactNode }
interface State { hasError: boolean; message: string }

/**
 * Fängt Render-Crashes der App ab, damit statt eines weißen Bildschirms eine
 * verständliche Meldung erscheint — und meldet den Crash automatisch ins
 * Diagnose-Log (Komponenten-Stack im Kontext). So sehen wir Fehler, die nur
 * bei einem bestimmten Nutzer/Browser auftreten, auch wenn sie bei uns nie kommen.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: any): State {
    return { hasError: true, message: String(err?.message ?? err ?? "Unbekannter Fehler") };
  }

  componentDidCatch(err: any, info: React.ErrorInfo) {
    reportEvent("crash", "React-Render", String(err?.message ?? err), {
      stack: err?.stack,
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-bg">
        <div className="dd-card max-w-md w-full p-6" style={{ ["--c" as any]: "#B91C1C" }}>
          <div className="dd-eyebrow text-rust">Es ist ein Fehler aufgetreten</div>
          <h1 className="font-display font-black uppercase text-xl text-ink mt-2 leading-tight">
            Die Ansicht konnte nicht geladen werden
          </h1>
          <p className="text-[13px] text-ink-body mt-3 leading-snug">
            Der Fehler wurde automatisch im Diagnose-Protokoll vermerkt. Du kannst die
            Seite neu laden — meist ist danach alles wieder da.
          </p>
          <p className="font-mono text-[11px] text-ink-mute mt-3 break-words">{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary mt-5 px-5 py-2.5 rounded-lg text-white font-mono text-[12px] tracking-wider uppercase"
          >
            Seite neu laden
          </button>
        </div>
      </div>
    );
  }
}
