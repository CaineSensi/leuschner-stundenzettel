export default function Logo({
  className = "",
  tone = "ink",
  size = "default",
}: {
  className?: string;
  tone?: "ink" | "light";
  /** "default" = Sidebar-/Standardgröße (2xl), "lg" = sehr groß, "sm" = klein. */
  size?: "default" | "lg" | "sm";
}) {
  const sizeCls =
    size === "lg"  ? "text-4xl tracking-[0.02em]" :
    size === "sm"  ? "text-base tracking-[0.04em]" :
                     "text-[28px] tracking-[0.025em]";
  return (
    <span
      className={`font-display font-black uppercase leading-none ${sizeCls} ${tone === "light" ? "text-white" : "text-paper"} ${className}`}
    >
      LEUSCHNER<span className="text-copper">.</span>
    </span>
  );
}

/** Brand-Footer · Doll(ART) als „erstellt von"-Element für die Sidebar.
 *  Pixel-Zerfall-Aesthetik aus der Coding-Sub-Marke, als kleines SVG-Icon
 *  plus Text-Mark. */
export function BuiltByDollart({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://dollartdrops.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`group inline-flex items-center gap-2 ${className}`}
      title="Diese App wurde gebaut von Doll(ART) · Rick Kohlberg"
    >
      <img
        src="/dollart-coding-icon.svg"
        alt=""
        aria-hidden
        className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity"
      />
      <span className="flex flex-col leading-tight">
        <span className="dd-eyebrow text-steel group-hover:text-copper-bright transition-colors">
          gebaut von
        </span>
        <span className="font-display font-black uppercase text-[11px] tracking-[0.06em] text-white group-hover:text-copper-bright transition-colors">
          Doll<span className="text-copper">(</span>ART<span className="text-copper">)</span>
        </span>
      </span>
    </a>
  );
}
