import type { CSSProperties } from "react";
import {
  TEXT_VARIANT_BASE_PX,
  TEXT_VARIANTS,
  type FontRole,
  type StorefrontTextStyles,
  type StorefrontTheme,
  type TextBlock,
  type TextStyleDef,
  type TextValign,
  type TextVariant,
} from "@/types/storefront";
import { contrastRatio, readableInkOn } from "@/lib/format/color";
import { boardInk } from "@/lib/storefront/palette";
import { isStrictHexColor } from "@/lib/validation/predicates";

/**
 * THE SAVED TEXT STYLES, resolved: what Headline, Subheading, Body and Small
 * label look like on one storefront, as the theme's own definition laid over
 * each style's coded default. Pure, so every face that sets words in a style
 * (a text block, a scrolling strip) reads it the same way.
 *
 * `size` and `font` always resolve to a value. Everything else stays ABSENT
 * when the storefront has not set it, because absent is the look each variant
 * has always had (its weight class, the typeface's own spacing, the default
 * ink) and a renderer must be able to tell "not set" from a value.
 */
export type ResolvedTextStyle = Omit<TextStyleDef, "font" | "size"> & {
  font: FontRole;
  size: number;
};

/** Which of a pairing's faces each style wears until the storefront says. */
export const TEXT_STYLE_DEFAULT_FONT: Record<TextVariant, FontRole> = {
  heading: "heading",
  subheading: "heading",
  body: "body",
  label: "body",
};

export function resolveTextStyle(theme: Pick<StorefrontTheme, "textStyles">, variant: TextVariant): ResolvedTextStyle {
  const saved = theme.textStyles?.[variant];
  return {
    ...saved,
    font: saved?.font ?? TEXT_STYLE_DEFAULT_FONT[variant],
    size: saved?.size ?? TEXT_VARIANT_BASE_PX[variant],
  };
}

/**
 * Where a text block's words sit in its box, as the class its column takes.
 * Middle is `justify-center`, the class every text block has always had, so
 * a block that stores no `valign` renders exactly as it did.
 */
export const TEXT_VALIGN_CLASSES: Record<TextValign, string> = {
  top: "justify-start",
  middle: "justify-center",
  bottom: "justify-end",
};

/** The style's own weight, when it sets one: absent leaves the variant's
 *  weight class (TEXT_VARIANT_WEIGHT_CLASSES), which is how it always was. */
export function textStyleWeightClass(saved: TextStyleDef | undefined): string | undefined {
  if (saved?.bold === true) return "font-bold";
  if (saved?.bold === false) return "font-normal";
  return undefined;
}

/**
 * A text block's colour when it has none of its own: its style's saved
 * colour, else what it has always followed (a heading the accent, the rest the
 * board's ink, `undefined`). Re-gated: it lands in a style attribute.
 */
export function textStyleColor(
  theme: Pick<StorefrontTheme, "accent" | "textStyles">,
  variant: TextVariant,
): string | undefined {
  const saved = theme.textStyles?.[variant]?.color;
  if (saved && isStrictHexColor(saved)) return saved;
  return variant === "heading" && isStrictHexColor(theme.accent) ? theme.accent : undefined;
}

/** What body text needs against its background to pass WCAG AA. */
const TEXT_CONTRAST_AA = 4.5;

/**
 * The ink for words on a BACKDROP they did not choose a colour for (a band,
 * see lib/storefront/backdrop). `automatic` is what the words would wear
 * anyway (textStyleColor: a style's colour, a heading's accent, or nothing,
 * which is the board's own ink). It is kept wherever it reads on the backdrop
 * at AA; where it does not, the words take whichever of the two inks does.
 *
 * With no backdrop the automatic colour comes straight back, so a block that
 * is not on a band is drawn exactly as it always was.
 */
export function textInkOnBackdrop(
  theme: StorefrontTheme,
  automatic: string | undefined,
  backdrop: string | undefined,
): string | undefined {
  if (!backdrop || !isStrictHexColor(backdrop)) return automatic;
  const worn = automatic ?? boardInk(theme);
  return contrastRatio(worn, backdrop) >= TEXT_CONTRAST_AA ? automatic : readableInkOn(backdrop);
}

/**
 * A block's own spacing over its style's: whichever the block sets wins, and
 * with neither set nothing is returned, so the typeface's own spacing (and
 * textSizeStyle's line height) stand exactly as before styles existed.
 */
export function textStyleSpacing(
  block: Pick<TextBlock, "letterSpacing" | "lineHeight">,
  saved: TextStyleDef | undefined,
): Pick<TextBlock, "letterSpacing" | "lineHeight"> {
  return {
    letterSpacing: block.letterSpacing ?? saved?.letterSpacing,
    lineHeight: block.lineHeight ?? saved?.lineHeight,
  };
}

/**
 * Write one style's definition back onto the theme's styles, dropping what
 * returns to the coded default: an emptied style leaves no entry, and no
 * styles at all leaves no `textStyles`, so a storefront that tried a change
 * and put it back is the storefront it was.
 */
export function withTextStyle(
  styles: StorefrontTextStyles | undefined,
  variant: TextVariant,
  def: TextStyleDef,
): StorefrontTextStyles | undefined {
  const cleaned: TextStyleDef = {};
  for (const [key, value] of Object.entries(def) as [keyof TextStyleDef, TextStyleDef[keyof TextStyleDef]][]) {
    if (value === undefined) continue;
    if (key === "font" && value === TEXT_STYLE_DEFAULT_FONT[variant]) continue;
    if (key === "size" && value === TEXT_VARIANT_BASE_PX[variant]) continue;
    (cleaned as Record<string, unknown>)[key] = value;
  }
  const next: StorefrontTextStyles = { ...styles };
  if (Object.keys(cleaned).length > 0) next[variant] = cleaned;
  else delete next[variant];
  return TEXT_VARIANTS.some((name) => next[name] !== undefined) ? next : undefined;
}

/** The style a preview of a saved style is drawn in: its size, weight,
 *  slant, caps, spacing and colour, as one inline style. */
export function textStylePreviewStyle(style: ResolvedTextStyle): CSSProperties {
  return {
    fontSize: `${style.size}px`,
    ...(style.bold !== undefined ? { fontWeight: style.bold ? 700 : 400 } : {}),
    ...(style.italic ? { fontStyle: "italic" } : {}),
    ...(style.uppercase ? { textTransform: "uppercase" } : {}),
    ...(style.letterSpacing !== undefined ? { letterSpacing: `${style.letterSpacing / 100}em` } : {}),
    ...(style.color && isStrictHexColor(style.color) ? { color: style.color } : {}),
  };
}
