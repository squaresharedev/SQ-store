"use client";

import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { Check, Link2, Package } from "lucide-react";
import { EASE_ENTRANCE, EASE_STANDARD } from "@/components/ui/motion-tokens";

/**
 * The welcome flow's picture: what a seller is about to make, shown rather
 * than written out.
 *
 * Built from the product's own parts (sharp surfaces, the black action colour,
 * monochrome marks, Square Share's squares) and animated with transforms and
 * opacity only, on the shared motion curves. Under reduced motion it renders
 * straight in its finished state: nothing slides, pops or pulses.
 */

/**
 * The first slide's picture: a product page assembling itself, then going live
 * and being shared. Decorative (the slide's line says the same in words), so it
 * is hidden from assistive tech.
 */
export function WelcomeHero() {
  const t = useTranslations("Onboarding.welcome.hero");
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
            {t("buyNow")}
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
        {t("live")}
      </motion.div>

      {/* ...and its link is shared. */}
      <motion.div
        className="absolute bottom-6 right-2 flex items-center gap-1.5 border border-border bg-popover px-2.5 py-1.5 font-inter text-xs font-medium text-foreground shadow-lg sm:right-6"
        {...enter(1.05, { opacity: 0, x: 14, y: 6 })}
      >
        <Link2 className="size-3.5" strokeWidth={2} />
        {t("linkCopied")}
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
