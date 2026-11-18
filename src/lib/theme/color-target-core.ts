import {
  PRICE_TAG_SHADOW_TEXT,
  TITLE_SHADOW_DEFAULT_COLOR,
  type CardStyle,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/predicates";
import { readableInkOn } from "@/lib/format/color";

/**
 * The color a non-heading text block or masthead bio renders in when it has no
 * override. Shared by renderers and pickers so they can never disagree.
 */
export const DEFAULT_TEXT_COLOR = "#171717";

/** Gate on the way out: configs come from a jsonb column and these values land
 *  in style attributes, so a non-hex value falls back rather than escaping. */
function gate(hex: string | undefined, fallback: string): string {
  const lower = (hex ?? "").toLowerCase();
  return isStrictHexColor(lower) ? lower : fallback;
}

/**
 * The colors the masthead follows when its two lines carry no override: the
 * store name tracks the theme accent (it is the storefront's heading), the bio
 * the default ink. Shared by the renderer, the inline pickers and the color
 * panel so none of them can disagree about what inheriting looks like.
 */
export function headerThemeColors(accent: string): {
  name: string;
  bio: string;
} {
  return { name: gate(accent, DEFAULT_TEXT_COLOR), bio: DEFAULT_TEXT_COLOR };
}

/**
 * What the price actually paints while `priceTagTextColor` is unset: the theme
 * accent, unless the tag sits unbacked in a `shadow` title area whose gradient
 * is dark by construction and would swallow it. Shared by the renderer and both
 * pickers so none of them can disagree about what "Auto" looks like.
 */
export function priceTagAutoTextColor(card: CardStyle, accent: string): string {
  if (card.priceTagPosition !== "below" || card.titleStyle !== "shadow") {
    return gate(accent, DEFAULT_TEXT_COLOR);
  }
  // A seller-tinted shade can be light; then white would sink into it.
  return card.titleShadowColor === undefined
    ? PRICE_TAG_SHADOW_TEXT
    : readableInkOn(gate(card.titleShadowColor, TITLE_SHADOW_DEFAULT_COLOR));
}
