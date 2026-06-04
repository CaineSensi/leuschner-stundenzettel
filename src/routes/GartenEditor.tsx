import BackButton from "../components/BackButton";

/* ────────────────────────────────────────────────────────────────────────
   Garten-Skizzen-Editor · Desktop-Werkzeug
   Draufsicht-Editor für Wege / Beete / Pflaster (Hardscape) mit Luftbild-
   Vorlage, Maßstab und Drag&Drop. Der Editor selbst ist eine in sich
   geschlossene statische Seite (public/garten-editor.html) und wird hier
   als vollflächiges iframe eingebettet — bewusst isoliert (eigenes CSS,
   eigenes localStorage), damit er die App nicht beeinflusst.
   Speicherung aktuell lokal (localStorage) + JSON-Export. DB-/Baustellen-
   Anbindung ist als nächster Schritt vorgesehen.
   ──────────────────────────────────────────────────────────────────────── */
export default function GartenEditor() {
  return (
    <div className="h-screen flex flex-col">
      <header className="surface-steel px-4 lg:px-8 pt-4 pb-4 flex-shrink-0 safe-top">
        <BackButton title="Zurück zur Betriebs-Übersicht (Dashboard)" />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="dd-eyebrow text-copper-bright block">Werkzeug · Desktop</span>
            <h1 className="font-display font-black uppercase text-2xl lg:text-3xl text-white leading-none mt-1.5">
              Garten-Skizzen
            </h1>
            <p className="font-mono text-[11.5px] mt-2 tracking-wide text-steel">
              Draufsicht-Editor · Wege · Beete · Pflaster · maßstäblich · Luftbild-Vorlage · lokal gespeichert
            </p>
          </div>
        </div>
      </header>
      <iframe
        title="Garten-Skizzen-Editor"
        src="/garten-editor.html"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
