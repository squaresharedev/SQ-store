"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  BadgeCheck,
  Check,
  LayoutGrid,
  Link2,
  Package,
  type LucideIcon,
} from "lucide-react";
import { EASE_ENTRANCE, EASE_STANDARD } from "@/components/ui/motion-tokens";

/**
 * The welcome flow's pictures: what a seller is about to make, and the four
 * steps to it, shown rather than written out.
 *
 * Built from the product's own parts (sharp surfaces, the black action colour,
 * monochrome marks, Square Share's squares) and animated with transforms and
 * opacity only, on the shared motion curves. Under reduced motion both render
 * straight in their finished state: nothing slides, pops or pulses.
 */

/** The four steps, in the order the setup checklist tracks them. */
export const SETUP_PATH: readonly { icon: LucideIcon; label: string }[] = [
  { icon: BadgeCheck, label: "Add your details" },
  { icon: Package, label: "Add a product" },
  { icon: LayoutGrid, label: "Design a storefront" },
  { icon: Link2, label: "Share its page" },
];

/**
 * The first slide's picture: a product page assembling itself, then going live
 * and being shared. Decorative (the slide's line says the same in words), so it
 * is hidden from assistive tech.
 */
export function WelcomeHero() {
  const reduced = useReducedMotion();

  /** Entrance props: `from` animates to rest after `delay`, or nothing at all. */
  const enter = (delay: number, from: Record<string, number>, duration = 0.45) =>
    reduced
      ? { initial: false as const }
      : {
          initial: from,
          animate: Object.fromEntries(
            Object.keys(from).map((key) => [key, key.startsWith("scale") ? 1 : key === "opacity" ? 1 : 0]),
          ),
          transition: { delay, duration, ease: EASE_ENTRANCE },
        };

  return (
    <div aria-hidden className="relative mx-auto flex h-52 w-full max-w-sm items-center justify-center">
      {/* The squares behind it: the grid a storefront is made of. */}
      <div className="absolute inset-x-6 inset-y-3 grid grid-cols-6 grid-rows-4 gap-1.5">
        {Array.from({ length: 24 }, (_, index) => (
          <motion.span
            key={index}
            className="bg-muted/70"
            {...enter(0.02 * index, { opacity: 0, scale: 0.6 }, 0.35)}
          />
        ))}
      </div>

      {/* The product page. */}
      <motion.div
        className="relative w-40 border border-border bg-background shadow-lg sm:w-44"
        {...enter(0.15, { opacity: 0, y: 18, scale: 0.96 }, 0.55)}
      >
        <div className="flex aspect-[4/3] items-center justify-center bg-muted">
          <motion.span {...enter(0.4, { opacity: 0, scale: 0.7 })}>
            <Package className="size-9 text-muted-foreground" strokeWidth={1.5} />
          </motion.span>
        </div>
        <div className="space-y-1.5 p-2.5">
          <motion.div
            className="h-2 w-4/5 origin-left bg-foreground"
            {...enter(0.5, { scaleX: 0 }, 0.4)}
          />
          <motion.div
            className="h-2 w-2/5 origin-left bg-muted-foreground/40"
            {...enter(0.58, { scaleX: 0 }, 0.4)}
          />
          <motion.div
            className="mt-2.5 flex h-6 items-center justify-center bg-primary font-inter text-xs font-medium text-primary-foreground"
            {...enter(0.7, { opacity: 0, y: 6 })}
          >
            Buy now
          </motion.div>
        </div>
      </motion.div>

      {/* It goes live... */}
      <motion.div
        className="absolute left-2 top-8 flex items-center gap-1.5 border border-border bg-popover px-2 py-1 font-inter text-xs font-medium text-foreground shadow-md sm:left-6"
        {...enter(0.9, { opacity: 0, x: -12 })}
      >
        <span className="relative flex size-2">
          {!reduced && (
            <motion.span
              className="absolute inset-0 bg-foreground"
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ delay: 1.2, duration: 1.4, repeat: Infinity, ease: EASE_STANDARD }}
            />
          )}
          <span className="relative size-2 bg-foreground" />
        </span>
        Live
      </motion.div>

      {/* ...and its link is shared. */}
      <motion.div
        className="absolute bottom-6 right-2 flex items-center gap-1.5 border border-border bg-popover px-2.5 py-1.5 font-inter text-xs font-medium text-foreground shadow-lg sm:right-6"
        {...enter(1.05, { opacity: 0, x: 14, y: 6 })}
      >
        <Link2 className="size-3.5" strokeWidth={2} />
        Link copied
        <motion.span
          className="flex size-4 items-center justify-center bg-foreground text-background"
          {...enter(1.35, { scale: 0 }, 0.3)}
        >
          <Check className="size-3" strokeWidth={3} />
        </motion.span>
      </motion.div>
    </div>
  );
}

/** When the track has drawn up to step `index`. */
const TRACK_DELAY = 0.2;
const TRACK_DURATION = 1.2;
const reachedAt = (index: number) =>
  TRACK_DELAY + (TRACK_DURATION * index) / (SETUP_PATH.length - 1);

/**
 * The second slide's picture: the four steps as a timeline. The track draws
 * across, and each step fills and takes its check as the line reaches it, the
 * last one pulsing once it is live. A real list, so the steps are read out in
 * order; the line, fills and checks are decoration.
 */
export function SetupPath() {
  const reduced = useReducedMotion();
  const last = SETUP_PATH.length - 1;

  return (
    <ol className="relative grid grid-cols-4 gap-2 pt-2">
      {/* Track and progress, through the centres of the first and last tiles
          (tiles are size-12, under the list's pt-2). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12.5%] top-8 h-0.5 -translate-y-1/2 bg-border"
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12.5%] top-8 h-0.5 origin-left -translate-y-1/2 bg-primary"
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: TRACK_DELAY, duration: TRACK_DURATION, ease: EASE_STANDARD }}
      />

      {SETUP_PATH.map((step, index) => (
        <li key={step.label} className="relative flex flex-col items-center gap-2.5 text-center">
          <div className="relative size-12">
            <div
              aria-hidden
              className="absolute inset-0 flex items-center justify-center border border-border bg-background text-muted-foreground"
            >
              <step.icon className="size-5" strokeWidth={1.75} />
            </div>
            <motion.div
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-primary text-primary-foreground"
              initial={reduced ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: reachedAt(index), duration: 0.35, ease: EASE_ENTRANCE }}
            >
              <step.icon className="size-5" strokeWidth={1.75} />
            </motion.div>
            <motion.span
              aria-hidden
              className="absolute -right-2 -top-2 flex size-5 items-center justify-center border-2 border-background bg-foreground text-background"
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: reachedAt(index) + 0.2, duration: 0.3, ease: EASE_ENTRANCE }}
            >
              <Check className="size-3" strokeWidth={3} />
            </motion.span>
            {index === last && !reduced && (
              <motion.span
                aria-hidden
                className="absolute inset-0 border-2 border-primary"
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                transition={{
                  delay: reachedAt(index) + 0.4,
                  duration: 1.1,
                  repeat: 2,
                  ease: EASE_STANDARD,
                }}
              />
            )}
          </div>
          <motion.span
            className="font-inter text-xs font-medium leading-snug text-foreground sm:text-sm"
            initial={reduced ? false : { opacity: 0.45 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reachedAt(index), duration: 0.3, ease: EASE_STANDARD }}
          >
            {step.label}
          </motion.span>
        </li>
      ))}
    </ol>
  );
}
