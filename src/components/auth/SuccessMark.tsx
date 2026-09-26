"use client";

import { motion, useReducedMotion } from "motion/react";
import { Smartphone } from "lucide-react";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, POP } from "@/components/ui/motion-tokens";
import { cn } from "@/lib/utils";

/**
 * The two-factor flow's moment of success, played once on mount: a ring draws
 * itself around the mark, the mark arrives (a passkey's ridges record
 * themselves in; an authenticator app's phone settles in), a check badge pops
 * onto the ring and a ripple leaves it.
 *
 * Mount it exactly when the success happens. Decorative (aria-hidden): the
 * words beside it carry the news, and reduced motion shows the finished mark
 * with nothing moving.
 *
 * Monochrome like the rest of the dashboard, with the one success green on the
 * badge (the same token pair the success toast uses), so the colour says only
 * "done".
 */

const SIZES = {
  lg: { box: "size-20", glyph: "size-9", badge: "size-7", check: "size-4" },
  md: { box: "size-14", glyph: "size-7", badge: "size-6", check: "size-3.5" },
} as const;

/**
 * The choreography, in seconds from mount. The badge lands once the ring has
 * closed and most of the ridges are in; the ripple leaves just after.
 */
const TIMING = { ring: 0.6, glyphAt: 0.15, glyph: 0.4, badgeAt: 0.7, ripple: 0.8 } as const;

export function SuccessMark({
  kind,
  size = "lg",
  className,
}: {
  kind: "passkey" | "app";
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const s = SIZES[size];
  const still = Boolean(reducedMotion);

  return (
    <div
      aria-hidden="true"
      data-success-mark={kind}
      className={cn("relative mx-auto grid shrink-0 place-items-center text-foreground", s.box, className)}
    >
      {!still && (
        <motion.span
          className="absolute inset-0 rounded-full border border-foreground/30"
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: TIMING.ripple, delay: TIMING.badgeAt + 0.1, ease: EASE_STANDARD }}
        />
      )}

      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90 overflow-visible">
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={2} />
        <motion.circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: TIMING.ring, ease: EASE_ENTRANCE }}
        />
      </svg>

      {kind === "passkey" ? (
        // Its own choreography: the ridges draw in from the core outward.
        <AnimatedFingerprint state="success" className={s.glyph} />
      ) : (
        <motion.span
          className="grid place-items-center"
          initial={still ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: TIMING.glyph, delay: TIMING.glyphAt, ease: EASE_ENTRANCE }}
        >
          <Smartphone className={s.glyph} strokeWidth={1.75} />
        </motion.span>
      )}

      <motion.span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full border-2 border-background bg-success text-background dark:bg-success-dark",
          s.badge,
        )}
        initial={still ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...POP, delay: TIMING.badgeAt }}
      >
        <svg
          viewBox="0 0 24 24"
          className={s.check}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <motion.path
            d="M5 13l4 4L19 7"
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: DURATION.slow, delay: TIMING.badgeAt + 0.12, ease: EASE_STANDARD }}
          />
        </svg>
      </motion.span>
    </div>
  );
}
