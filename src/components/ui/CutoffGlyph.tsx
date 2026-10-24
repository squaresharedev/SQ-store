import type { LucideIcon } from "lucide-react";

/**
 * The hover scope a CutoffGlyph answers to. Put it on the tile that holds
 * one: it makes the tile the glyph's positioning box and its own stacking
 * context, so the glyph sits behind the tile's words but in front of its
 * background. No `overflow-hidden` needed — the glyph brings its own clip.
 */
export const cutoffGlyphGroupClass = "group/glyph relative isolate";

/** The glyph: bleeding off the bottom-right corner, leaning back, at a low
 *  opacity that steps up on hover and focus, and again once its tile is the
 *  chosen one. Fixed offsets, so it is cut the same on every tile width. */
const GLYPH_CLASS = [
  "absolute -bottom-6 -right-4 size-24 -rotate-12 text-foreground",
  "opacity-10 group-hover/glyph:opacity-20 group-has-[:focus-visible]/glyph:opacity-20 group-has-[:checked]/glyph:opacity-25",
  // The hover: it swings upright, grows and rises, as if the tile were turned
  // towards the light. Under reduced motion only the opacity step remains.
  "transition-[translate,rotate,scale,opacity] duration-slow ease-entrance motion-reduce:transition-none",
  "group-hover/glyph:-translate-y-1 group-hover/glyph:rotate-0 group-hover/glyph:scale-110",
  "group-has-[:focus-visible]/glyph:-translate-y-1 group-has-[:focus-visible]/glyph:rotate-0 group-has-[:focus-visible]/glyph:scale-110",
  "motion-reduce:group-hover/glyph:translate-y-0 motion-reduce:group-hover/glyph:scale-100",
].join(" ");

/**
 * A BIG GLYPH CUT OFF BY ITS TILE'S CORNER: the picture a choice wears so it
 * can be told apart from its neighbours at a glance, before a word is read.
 * Monochrome (the ink at low opacity), so it never competes with the words.
 *
 * Decorative: hidden from assistive tech, never takes a pointer.
 */
export function CutoffGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
    >
      <Icon className={GLYPH_CLASS} strokeWidth={1.25} />
    </span>
  );
}
