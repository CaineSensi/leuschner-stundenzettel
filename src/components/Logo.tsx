export default function Logo({
  className = "",
  tone = "ink"
}: {
  className?: string;
  tone?: "ink" | "light";
}) {
  return (
    <span
      className={`h-display text-xl ${tone === "light" ? "text-white" : "text-paper"} ${className}`}
    >
      LEUSCHNER<span className="text-copper">.</span>
    </span>
  );
}
