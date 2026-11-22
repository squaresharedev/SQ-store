import type { MessageKey } from "@/i18n/types";
import type { FontPairing } from "@/types/storefront";
import { isFontPairing } from "./font-pairings";

// The pairings' names, for the EDITOR only: message keys of the panel's own
// catalogue, which buyers' pages never ship (font-pairings itself is read by
// the faces a buyer sees, so the words live here instead).

/** Each pairing's name and its one-line description, as message keys. */
export const FONT_PAIRING_LABELS: Record<FontPairing, { name: MessageKey; hint: MessageKey }> = {
  editorial: { name: "EditorType.panel.pairings.editorial.name", hint: "EditorType.panel.pairings.editorial.hint" },
  classic: { name: "EditorType.panel.pairings.classic.name", hint: "EditorType.panel.pairings.classic.hint" },
  modern: { name: "EditorType.panel.pairings.modern.name", hint: "EditorType.panel.pairings.modern.hint" },
  soft: { name: "EditorType.panel.pairings.soft.name", hint: "EditorType.panel.pairings.soft.hint" },
  studio: { name: "EditorType.panel.pairings.studio.name", hint: "EditorType.panel.pairings.studio.hint" },
};

/** What the Typography menu entry says the storefront is set in: the
 *  pairing's name when it has one, else undefined (and the entry keeps naming
 *  the single font, as it always did). */
export function typographyMenuHint(
  theme: { fontPairing?: string },
  t: (key: MessageKey) => string,
): string | undefined {
  return isFontPairing(theme.fontPairing) ? t(FONT_PAIRING_LABELS[theme.fontPairing].name) : undefined;
}
