import { useState } from "react";

/**
 * Bild-Tag mit eigenem Fallback, falls die Quelle nicht lädt.
 * Ersetzt das hässliche Browser-Default-Broken-Image-Icon
 * (graues Quadrat mit Fragezeichen) durch eine schwarze Kachel
 * mit weißem Fragezeichen — passt zur Stahl-&-Beton-Optik.
 *
 * Nutzung wie ein normales <img>, plus optional `fallbackClassName`
 * für Größen-Overrides am Fallback-Container.
 */
export default function ImageWithFallback({
  src,
  alt = "",
  className,
  fallbackClassName,
  loading,
  draggable
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  loading?: "lazy" | "eager";
  draggable?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={
          fallbackClassName ??
          `${className ?? ""} flex items-center justify-center bg-bg-deep`
        }
        role="img"
        aria-label={alt || "Bild konnte nicht geladen werden"}
      >
        <span className="font-display font-black text-white/85 text-2xl leading-none select-none">?</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      draggable={draggable}
      onError={() => setFailed(true)}
    />
  );
}
