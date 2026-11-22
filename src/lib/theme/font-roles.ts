import type { CSSProperties } from "react";
import type { FontRole } from "@/types/storefront";

/**
 * A FONT PAIRING'S TWO FACES, as the board hands them down.
 *
 * The board's root declares two custom properties naming the pairing's heading
 * and body families (lib/theme/font-pairings sets them, on the same element
 * that carries the custom font's). Anything on the board that should wear one
 * of the two reads it through {@link fontRoleStyle}: a card's name, a button's
 * label, a text style.
 *
 * WITH NO PAIRING the properties are simply unset, and the `inherit` fallback
 * leaves the element on the board's own font: exactly how it rendered before
 * pairings existed. So a face can ask for a role unconditionally.
 */
export const FONT_ROLE_VARS: Record<FontRole, string> = {
  heading: "--ss-font-heading",
  body: "--ss-font-body",
};

/** The inline style that sets something in the pairing's heading or body face. */
export function fontRoleStyle(role: FontRole): CSSProperties {
  return { fontFamily: `var(${FONT_ROLE_VARS[role]}, inherit)` };
}
