import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How faint a corner picture is held, as a whole: it decorates the corner
 *  without competing with the card. */
const CORNER_ART_FADE = "opacity-40";

/**
 * THE FRAME A CARD'S CORNER PICTURE IS DRAWN IN (SettingsCard's `art` sets it
 * flush in the card's top-right corner): the picture's top and right edges
 * are the card's own, so anything drawn past them is cut off by the card, and
 * it is held back to a faint grey as a whole. Grey, black and white only, one
 * per page, on the page's lead card.
 *
 * `overhang` is how far the picture reaches back over the text column, above
 * where the description starts, without taking the column's width. `style`
 * is for what the picture's animations read (its loop length).
 *
 * Decoration, so aria-hidden. Every picture's still pose is in its markup and
 * its motion in globals.css, off under reduced motion.
 */
export function CornerArt({
  name,
  width,
  height,
  overhang = 0,
  style,
  className,
  children,
}: {
  /** Which picture this is (data-corner-art), for harnesses and tests. */
  name: string;
  width: number;
  height: number;
  overhang?: number;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-corner-art={name}
      className={cn("relative block shrink-0", className)}
      style={{ width: width - overhang, height, ...style }}
    >
      <span
        className={cn("absolute right-0 top-0 overflow-hidden", CORNER_ART_FADE)}
        style={{ width, height }}
      >
        {children}
      </span>
    </span>
  );
}
