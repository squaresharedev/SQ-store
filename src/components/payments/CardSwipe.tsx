import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Decorative hero animation for the payments onboarding: a card glides through
 * a reader, dwells to be read, a light sheen sweeps across it, and an
 * "approved" badge pops. Purely presentational and `aria-hidden` — it conveys
 * "get paid", the surrounding copy carries the meaning. All motion is defined
 * in globals.css (card-swipe / swipe-sheen / swipe-approve keyframes) and rests
 * as a static "approved" tableau under prefers-reduced-motion. Tokens only.
 */
export function CardSwipe({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative h-32 w-full overflow-hidden rounded-md border border-border bg-secondary",
        className,
      )}
    >
      {/* Reader slot: a faint vertical guide the card passes through. */}
      <span className="absolute inset-y-7 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-foreground/10" />

      {/* The swiping card — flex-centred so the keyframe's translateX(0) dwell
          lands it exactly over the reader slot. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="animate-card-swipe relative h-24 w-40 overflow-hidden rounded-lg border border-border bg-foreground shadow-lg">
          {/* Chip. */}
          <span className="absolute left-4 top-4 h-5 w-6 rounded-sm bg-background/85 ring-1 ring-inset ring-background/20" />
          {/* Brand square — a nod to the SquareShare mark (same radius-sm). */}
          <span className="absolute right-4 top-4 size-4 rounded-sm bg-background" />
          {/* Card number rows. */}
          <span className="absolute bottom-6 left-4 h-1.5 w-24 rounded-full bg-background/30" />
          <span className="absolute bottom-3 left-4 h-1.5 w-14 rounded-full bg-background/20" />
          {/* Light sheen sweeping across as the card is read. */}
          <span className="animate-swipe-sheen absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-background/50 to-transparent" />
        </div>
      </div>

      {/* Reader status: goes green while the card dwells at the slot. */}
      <div className="absolute inset-x-0 top-3 flex justify-center">
        <span className="animate-swipe-approve flex size-7 items-center justify-center rounded-full bg-success text-primary-foreground shadow-md ring-2 ring-background">
          <Check className="size-4" strokeWidth={3} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
