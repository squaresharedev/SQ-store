import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A glyph a mark can wear: any lucide icon, or a component of our own that
 *  sizes itself from `className` (the animated fingerprint). */
export type MarkGlyph = ComponentType<{ className?: string; strokeWidth?: number | string }>;

/**
 * The box, glyph and corner-badge sizes every "mark" shares: this one, and the
 * animated SuccessMark that replaces it when the thing it stood for goes
 * through. One table, so the two can never drift apart.
 */
export const MARK_SIZES = {
  lg: { box: "size-20", glyph: "size-9", badge: "size-7", badgeGlyph: "size-4" },
  md: { box: "size-14", glyph: "size-7", badge: "size-6", badgeGlyph: "size-3.5" },
} as const;

export type MarkSize = keyof typeof MARK_SIZES;

/** Monochrome by default, like the rest of the dashboard. Colour is spent only
 *  where it means something: red for what cannot be undone, green for done. */
const TONES = {
  neutral: { disc: "bg-secondary text-foreground", badge: "bg-foreground text-background" },
  danger: {
    disc: "bg-destructive/10 text-destructive",
    badge: "bg-destructive text-destructive-foreground",
  },
  success: {
    disc: "bg-success/15 text-success",
    badge: "bg-success text-background dark:bg-success-dark",
  },
} as const;

export type MarkTone = keyof typeof TONES;

/**
 * A DIALOG'S CENTRAL ELEMENT: the one thing that still reads when the words are
 * a blur (styles.md §8.14). Pass an `icon` for a glyph on a tinted disc, or
 * `children` for the thing itself (a product photo, an animated glyph), which
 * is then shown as it is. A `badge` pins a small glyph to the corner, for what
 * is about to happen to it (a bin on the photo of a product being deleted).
 *
 * Decorative (aria-hidden): the title beside it carries the meaning. Static and
 * server-compatible; the moment something SUCCEEDS is auth/SuccessMark's.
 */
export function HeroMark({
  icon: Icon,
  children,
  tone = "neutral",
  size = "md",
  badge: Badge,
  className,
}: {
  icon?: MarkGlyph;
  children?: ReactNode;
  tone?: MarkTone;
  size?: MarkSize;
  badge?: MarkGlyph;
  className?: string;
}) {
  const s = MARK_SIZES[size];
  const t = TONES[tone];
  return (
    <div
      aria-hidden="true"
      data-hero-mark={tone}
      className={cn(
        "relative mx-auto grid shrink-0 place-items-center",
        s.box,
        Icon && "rounded-full",
        Icon && t.disc,
        className,
      )}
    >
      {Icon ? <Icon className={s.glyph} strokeWidth={1.75} /> : children}
      {Badge && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full border-2 border-background",
            s.badge,
            t.badge,
          )}
        >
          <Badge className={s.badgeGlyph} strokeWidth={2.5} />
        </span>
      )}
    </div>
  );
}
