import { cn } from "@/lib/utils";

/**
 * Checkmark that draws itself in (stroke) with a small pop on mount. Mount it
 * exactly when success appears — the CSS animations run once per mount, so
 * unmounting on dismiss and remounting on the next success replays them.
 * Reduced-motion safe (falls back to a static, fully-drawn check).
 */
export function AnimatedCheck({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-check-pop", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="animate-check-draw" d="M5 13l4 4L19 7" />
    </svg>
  );
}
