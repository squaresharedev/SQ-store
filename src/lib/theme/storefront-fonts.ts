import type { CSSProperties } from "react";
import type { StorefrontCustomFont, StorefrontFont } from "@/types/storefront";
import { FONT_CLASSES } from "@/components/storefront/config-maps";
import { CUSTOM_FONT_VAR, customFontFamily, isSafeFontUrl } from "./custom-font";

/**
 * Turning a font CHOICE into something a renderer can apply.
 *
 * The built-in faces resolve through the fixed class map, exactly like every
 * other config enum. An uploaded face cannot: it has no class, only bytes in
 * R2. So the canvas root declares ONE custom property naming the family
 * {@link CustomFontFace} registered, and anything set to "custom" reads that
 * property: the canvas itself, or a single text block inside it.
 *
 * The indirection is what keeps the display URL in one place. Only the root
 * knows it; blocks inherit the resolved family down the tree, so no tile
 * component has to carry a font URL it does not otherwise care about. When
 * nothing resolves (no upload, or a surface that signs no URL, which the
 * list-card previews never do), the property is simply unset and its `inherit`
 * fallback leaves the canvas on the page font and every block on the canvas
 * font.
 *
 * Nothing here ever touches a URL the config supplied: the config stores keys,
 * and display URLs are signed server-side and handed in.
 */

export { CUSTOM_FONT_VAR, customFontFamily, isSafeFontUrl };

/** What an uploaded face falls back to per character it does not carry, and
 *  while it is still loading. Same stack the `font-sans` utility resolves to. */
const CUSTOM_FONT_FALLBACK =
  "var(--font-geist), ui-sans-serif, system-ui, sans-serif";

/**
 * The canvas root's style contribution: the uploaded family, ready for anything
 * inside to inherit. Undefined when there is nothing to declare, which leaves
 * every "custom" font choice below falling back to plain inheritance.
 */
export function customFontVars(
  customFont: StorefrontCustomFont | undefined,
  customFontUrl: string | null | undefined,
): CSSProperties | undefined {
  if (!customFont || !customFontUrl || !isSafeFontUrl(customFontUrl)) {
    return undefined;
  }
  const family = customFontFamily(customFont.key);
  return family
    ? ({
        [CUSTOM_FONT_VAR]: `${family}, ${CUSTOM_FONT_FALLBACK}`,
      } as CSSProperties)
    : undefined;
}

/** How a renderer applies a font choice: a tokenized class, an inline family
 *  for an uploaded face, or nothing at all (inherit). */
export type FontPresentation = {
  className?: string;
  style?: CSSProperties;
};

/**
 * Resolve a font choice for rendering. An absent choice inherits (that is what
 * a block with no override means); "custom" reads the canvas's custom property
 * and inherits when it is not set.
 */
export function fontPresentation(
  font: StorefrontFont | undefined,
): FontPresentation {
  if (!font) return {};
  if (font !== "custom") return { className: FONT_CLASSES[font] };
  return { style: { fontFamily: `var(${CUSTOM_FONT_VAR}, inherit)` } };
}