import { PAIRING_FACE_CLASSES } from "@/app/fonts/pairing-faces";
import type { FontPairing, StorefrontTheme } from "@/types/storefront";
import { FONT_PAIRING_FACES, fontPairingStyle, isFontPairing } from "./font-pairings";
import { fontPresentation, type FontPresentation } from "./storefront-fonts";

/**
 * A font pairing, ready for the element it is drawn in: the two faces'
 * variable classes (which declare their families there) and the role
 * variables with the body face as the element's own font.
 *
 * Kept apart from font-pairings because this one imports the faces themselves
 * (app/fonts/pairing-faces), and with them their @font-face rules: only what
 * draws a storefront should pull those in.
 */
export function fontPairingPresentation(pairing: FontPairing): FontPresentation {
  const faces = FONT_PAIRING_FACES[pairing];
  return {
    // A plain join, not cn: the two faces' classes never conflict, and a
    // class merger must not get the chance to decide that they do.
    className: `${PAIRING_FACE_CLASSES[faces.heading]} ${PAIRING_FACE_CLASSES[faces.body]}`,
    style: fontPairingStyle(pairing),
  };
}

/**
 * THE BOARD'S TYPEFACE, for every element a storefront is drawn in (the
 * buyer's board, the designer's canvas, the list previews, a product page
 * that follows the storefront's font).
 *
 * A pairing wins over `theme.font` when there is one. Without one this is
 * exactly `fontPresentation(theme.font)`, the same class and the same style a
 * board wore before pairings existed: nothing new on the unchanged path.
 */
export function boardFontPresentation(theme: Pick<StorefrontTheme, "font" | "fontPairing">): FontPresentation {
  return pairingFontPresentation(theme) ?? fontPresentation(theme.font);
}

/**
 * The pairing's half of boardFontPresentation, for a renderer that already
 * resolves its own font: undefined without a pairing, so the hook is
 * `pairingFontPresentation(theme) ?? fontPresentation(theme.font)` and the
 * unchanged path stays the line it always was.
 */
export function pairingFontPresentation(theme: Pick<StorefrontTheme, "fontPairing">): FontPresentation | undefined {
  return isFontPairing(theme.fontPairing) ? fontPairingPresentation(theme.fontPairing) : undefined;
}
