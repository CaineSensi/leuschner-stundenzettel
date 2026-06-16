import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { initDiag, reportEvent } from "./lib/diag";
import "./index.css";

// Diagnose initialisieren + globale Fehlerfänger registrieren, damit kein
// Fehler unsichtbar verpufft (window.onerror + unbehandelte Promise-Rejections).
initDiag();

window.addEventListener("error", (e) => {
  reportEvent("error", "window.onerror", String(e.message ?? "Fehler"), {
    source: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: (e.error && e.error.stack) || undefined,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  const r: any = e.reason;
  const msg = String(r?.message ?? r ?? "unbehandelte Promise-Ablehnung");
  // Timeouts melden sich bereits selbst (withTimeout → reportTimeout) — hier
  // nicht doppelt zählen, falls so eine Rejection ungefangen durchrutscht.
  if (msg.startsWith("Zeitüberschreitung")) return;
  reportEvent("error", "unhandledrejection", msg, { stack: r?.stack });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
