import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The hover scopes a CutoffGlyph answers to, one per nesting level: a CARD
 * (a form section) and a TILE inside it (a choice, an extra). Two names, not
 * one, because a named group matches ANY ancestor carrying it — with one name,
 * hovering a section would set off every tile's glyph inside it, and one
 * checked tile would mark them all as checked.
 *
 * Each scope also makes its element the glyph's positioning box and its own
 * stacking context, so the glyph sits behind the content but in front of the
 * background. No `overflow-hidden` needed (or wanted: it would clip the card's
 * menus and popovers) — the glyph brings its own clip.
 */
export const cutoffGlyphGroupClass = {
  card: "group/card-glyph relative isolate",
  tile: "group/tile-glyph relative isolate",
} as const;

export type CutoffGlyphScope = keyof typeof cutoffGlyphGroupClass;

/** Where the glyph bleeds off its box, and which way it leans. Fixed offsets
 *  rather than percentages, so it is cut the same on a wide card as a narrow
 *  tile. */
const CORNERS = {
  "top-right": "-right-6 -top-8 rotate-12",
  "bottom-right": "-bottom-6 -right-4 -rotate-12",
} as const;

const SIZES = {
  md: "size-24",
  lg: "size-36",
} as const;

/** How strongly it shows: a watermark behind a whole card, or a picture on a
 *  tile (which also darkens once its tile is the chosen one). */
const TONES = {
  card: {
    faint: "opacity-5 group-hover/card-glyph:opacity-10",
    bold: "opacity-10 group-hover/card-glyph:opacity-20",
  },
  tile: {
    faint: "opacity-5 group-hover/tile-glyph:opacity-10 group-has-[:focus-visible]/tile-glyph:opacity-10",
    bold: "opacity-10 group-hover/tile-glyph:opacity-20 group-has-[:focus-visible]/tile-glyph:opacity-20 group-has-[:checked]/tile-glyph:opacity-25",
  },
} as const;

/** The hover: the glyph swings upright, grows and rises, as if its box were
 *  turned towards the light. Transform only; under reduced motion only the
 *  opacity step remains. Spelled out per scope because Tailwind needs every
 *  class whole. */
const MOTION_BASE =
  "transition-[translate,rotate,scale,opacity] duration-slow ease-entrance motion-reduce:transition-none";
const MOTION = {
  card: "group-hover/card-glyph:-translate-y-1 group-hover/card-glyph:rotate-0 group-hover/card-glyph:scale-110 motion-reduce:group-hover/card-glyph:translate-y-0 motion-reduce:group-hover/card-glyph:scale-100",
  tile: "group-hover/tile-glyph:-translate-y-1 group-hover/tile-glyph:rotate-0 group-hover/tile-glyph:scale-110 group-has-[:focus-visible]/tile-glyph:-translate-y-1 group-has-[:focus-visible]/tile-glyph:rotate-0 group-has-[:focus-visible]/tile-glyph:scale-110 motion-reduce:group-hover/tile-glyph:translate-y-0 motion-reduce:group-hover/tile-glyph:scale-100",
} as const;

/**
 * A BIG GLYPH CUT OFF BY ITS BOX'S EDGE: the picture a container wears so it
 * can be told apart from its neighbours at a glance, before a word is read.
 * Monochrome (it is the ink at low opacity), so it never competes with the
 * content, and it answers its scope's hover (and, on a tile, keyboard focus).
 * Put `cutoffGlyphGroupClass[scope]` on the box that holds it.
 *
 * Decorative: hidden from assistive tech, never takes a pointer.
 */
export function CutoffGlyph({
  icon: Icon,
  scope,
  corner = "bottom-right",
  size = "md",
  tone = "bold",
}: {
  icon: LucideIcon;
  scope: CutoffGlyphScope;
  corner?: keyof typeof CORNERS;
  size?: keyof typeof SIZES;
  tone?: "faint" | "bold";
}) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
    >
      <Icon
        className={cn(
          "absolute text-foreground",
          CORNERS[corner],
          SIZES[size],
          TONES[scope][tone],
          MOTION_BASE,
          MOTION[scope],
        )}
        strokeWidth={1.25}
      />
    </span>
  );
}
