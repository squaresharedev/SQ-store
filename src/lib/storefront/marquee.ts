import { readableInkOn } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import type { ResolvedTextStyle } from "@/lib/storefront/text-styles";
import type { BlockPlacement, MarqueeBlock } from "@/types/storefront";

/**
 * THE SCROLLING TEXT STRIP (MarqueeBlock), as pure rules: how many times its
 * words repeat to fill the strip, the ink they are set in, and what a new
 * strip starts as. The face is components/storefront/MarqueeTileContent; the
 * moving is CSS (globals.css, "motion and finish").
 */

/**
 * How many characters HALF the moving track must hold. The track is two equal
 * halves sliding by one half, which is what makes the loop seamless, so each
 * half has to be at least as wide as the strip. The strip's width is not
 * known without measuring, so this is chosen to outrun the widest board (76rem)
 * at the smallest saved text size, with room to spare.
 */
export const MARQUEE_HALF_MIN_CHARS = 200;

/** The space after each copy, counted in characters for the pace (it is 2em
 *  wide in the CSS, about three characters of most faces). */
export const MARQUEE_GAP_CHARS = 3;

/** How many copies of the words make one half of the track, and how many
 *  characters that half is (the CSS paces the loop by it, so a long line
 *  crosses the strip at the same speed a short one does). */
export function marqueeTrack(text: string): { copies: number; halfChars: number } {
  const unit = Math.max(1, text.length) + MARQUEE_GAP_CHARS;
  const copies = Math.max(1, Math.ceil(MARQUEE_HALF_MIN_CHARS / unit));
  return { copies, halfChars: copies * unit };
}

/**
 * The words' ink: the strip's own colour, else its text style's, else one that
 * reads on what the strip sits on (the band or the board, `backdrop`), else
 * nothing, and the board's own ink carries on, exactly as words always have.
 * Every colour is gated before it can reach a style attribute.
 */
export function marqueeInk(
  block: Pick<MarqueeBlock, "color">,
  style: Pick<ResolvedTextStyle, "color">,
  backdrop: string | undefined,
): string | undefined {
  if (block.color && isStrictHexColor(block.color)) return block.color;
  if (style.color && isStrictHexColor(style.color)) return style.color;
  return backdrop && isStrictHexColor(backdrop) ? readableInkOn(backdrop) : undefined;
}

/** A new strip: the words given, everything else absent (normal speed, the
 *  Small label style, the automatic ink). */
export function newMarqueeBlock(placement: BlockPlacement, text: string): MarqueeBlock {
  return { type: "marquee", id: crypto.randomUUID(), text, ...placement };
}
