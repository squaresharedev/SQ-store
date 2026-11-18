/**
 * Utilities for a seller's uploaded custom typeface.
 *
 * Intentionally import-free: these two functions and their constants are shared
 * by CustomFontFace (buyer-facing PageShell) and storefront-fonts.ts (which
 * also includes the full FONT_CLASSES map). Keeping them here avoids pulling
 * the config-maps module into pages that only need to register one font.
 */

/** The CSS custom property carrying the uploaded family down the canvas tree. */
export const CUSTOM_FONT_VAR = "--ss-custom-font";

/** The uuid segment of `fonts/{ownerId}/{uuid}-{name}`. */
const FONT_KEY_FAMILY =
  /^fonts\/[0-9a-f-]{36}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/;

/**
 * The CSS family name for an uploaded font, or null when the key is not one we
 * minted. Derived from the object's own uuid rather than a fixed name because
 * the storefront LIST renders many storefronts at once, and one shared family
 * name would have the first card's font paint every other card.
 *
 * The result is `[a-z0-9-]` only: a valid CSS custom-ident by construction, so
 * it can never carry anything out of the key into a style attribute.
 */
export function customFontFamily(key: string): string | null {
  const match = FONT_KEY_FAMILY.exec(key);
  return match ? `ss-font-${match[1]}` : null;
}

/**
 * A font URL safe to put inside a `url(...)` source.
 *
 * Both origins are ours: a presigned R2 GET (https) or the object URL for a
 * file the seller just picked (blob). Everything that could break out of the
 * quoted source (quotes, parentheses, backslashes, whitespace) is refused
 * rather than escaped, because a legitimate URL from either source never
 * contains one.
 */
const SAFE_FONT_URL = /^(https:|blob:)[^\s"'()\\]+$/;

export function isSafeFontUrl(url: string): boolean {
  return SAFE_FONT_URL.test(url);
}
