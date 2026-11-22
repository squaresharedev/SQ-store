import { TEXT_VARIANT_BASE_PX, type FontRole, type StorefrontTheme, type TextStyleDef, type TextVariant } from "@/types/storefront";

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
