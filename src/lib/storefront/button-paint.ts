import type { CSSProperties } from "react";
import { ctaStyle, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { contrastRatio, readableInkOn } from "@/lib/format/color";
import { cn } from "@/lib/utils";
import type { ButtonLook } from "@/types/storefront";

/**
 * WHAT A BUTTON BLOCK PAINTS (ButtonTileContent), resolved from the
 * storefront's own button (TileLook.buy, resolveCta) so a button on the board
 * is the product page's button, not a second design.
 *
 *   - solid: the button exactly: its fill, its ink (already chosen to read on
 *     the fill), its roundness and outline;
 *   - outline: no fill, the button's colour as a ring and as the words;
 *   - link: just the words, in the button's colour.
 *
 * Outline and link put the colour on whatever the button sits on (a band, the
 * board), so it is kept only where words in it read at WCAG AA there (4.5:1:
 * a button's words are body-sized), and swapped for the ink that does
 * otherwise. A pale button colour on a pale band stays a pale button, with
 * readable words.
 */

/** WCAG AA for words of a button's size. */
const BUTTON_TEXT_CONTRAST = 4.5;

/** The button's colour where it reads on `backdrop`, else the ink that does. */
export function buttonInk(color: string, backdrop: string): string {
  return contrastRatio(color, backdrop) >= BUTTON_TEXT_CONTRAST ? color : readableInkOn(backdrop);
}

export function buttonBlockPaint(look: ButtonLook, cta: CtaAppearance, backdrop: string): CSSProperties {
  if (look === "solid") return ctaStyle(cta);
  const ink = buttonInk(cta.fill, backdrop);
  if (look === "outline") {
    return {
      color: ink,
      borderRadius: `${cta.radius}px`,
      boxShadow: `inset 0 0 0 ${Math.max(cta.borderWidth, 2)}px ${ink}`,
    };
  }
  return { color: ink };
}

/**
 * The face: fills the block, the button centred in it. A size container, so
 * the words follow the button's height (BUTTON_TEXT_SIZE): a board scaled down
 * whole on a phone leaves a half-cell button only a few pixels tall.
 */
export const BUTTON_FACE_CLASS =
  "flex min-h-0 flex-1 items-center justify-center overflow-hidden font-semibold [container-type:size]";

/** The words' size: the small text size, down to the smallest label size as
 *  the button gets short (in its own height, cqh). */
export const BUTTON_TEXT_SIZE_CLASS = "text-[length:clamp(var(--text-2xs),32cqh,var(--text-lg))]";

/** The words: up to two balanced lines (a phone's reflow can leave a button
 *  one cell wide), cut short past that rather than pushing the button wider;
 *  the link look underlines them, since it has no shape to say "press me". */
export function buttonLabelClass(look: ButtonLook): string {
  return cn(
    "min-w-0 line-clamp-2 text-balance text-center leading-tight",
    BUTTON_TEXT_SIZE_CLASS,
    look === "link" && "underline underline-offset-4",
  );
}
