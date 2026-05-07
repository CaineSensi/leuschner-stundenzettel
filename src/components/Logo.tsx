export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`h-display text-paper text-xl ${className}`}>
      LEUSCHNER<span className="text-copper">.</span>
    </span>
  );
}
