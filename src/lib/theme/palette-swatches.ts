import type { MessageKey } from "@/i18n/types";
import { backgroundIsPhoto, derivePalette } from "@/lib/storefront/palette";
import type { PaletteSlot, StorefrontPalette, StorefrontTheme } from "@/types/storefront";
import type { ColorPreset } from "./color-presets";

/**
 * THE PALETTE AS SWATCHES: the five named colours (lib/storefront/palette) in
 * the shape every picker row already draws. For the EDITOR: the names are the
 * panel's own words, so the shared ColorPicker is handed the swatches
 * ready-made (paletteContext) rather than importing them.
 */

/** Each slot's name on its own (a caption, a tooltip) and as a swatch's whole
 *  accessible name, which takes the hex as `{value}`. In slot order: the
 *  order the palette row and every picker show them in. */
export const PALETTE_SLOT_LABELS = {
  background: {
    name: "EditorType.panel.palette.slots.background.name",
    label: "EditorType.panel.palette.slots.background.label",
  },
  text: {
    name: "EditorType.panel.palette.slots.text.name",
    label: "EditorType.panel.palette.slots.text.label",
  },
  accent: {
    name: "EditorType.panel.palette.slots.accent.name",
    label: "EditorType.panel.palette.slots.accent.label",
  },
  surface: {
    name: "EditorType.panel.palette.slots.surface.name",
    label: "EditorType.panel.palette.slots.surface.label",
  },
  muted: {
    name: "EditorType.panel.palette.slots.muted.name",
    label: "EditorType.panel.palette.slots.muted.label",
  },
} as const satisfies Record<PaletteSlot, { name: MessageKey; label: MessageKey }>;

/** The slots in the order they are shown. */
export const PALETTE_SLOT_ORDER = Object.keys(PALETTE_SLOT_LABELS) as PaletteSlot[];

/**
 * The palette as picker swatches, in slot order. Two slots wearing one colour
 * (a new storefront's text and accent are one ink) show once, under the first
 * slot's name: a row of two identical dots says nothing, and the hex is a
 * swatch's identity. `omit` leaves a slot out: the Background of a board that
 * is a photo, which no flat colour stands for.
 */
export function paletteSwatches(palette: StorefrontPalette, omit: readonly PaletteSlot[] = []): ColorPreset[] {
  const seen = new Set<string>();
  const swatches: ColorPreset[] = [];
  for (const slot of PALETTE_SLOT_ORDER) {
    if (omit.includes(slot)) continue;
    const value = palette[slot].toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    swatches.push({ ...PALETTE_SLOT_LABELS[slot], value });
  }
  return swatches;
}

/** What the designer hands its colour provider (lib/theme/color-context):
 *  the storefront's palette, own or derived, the same as swatches, and whether
 *  the board's background is a photo (then it is no swatch of the five). */
export function paletteContext(theme: StorefrontTheme): {
  palette: StorefrontPalette;
  paletteSwatches: ColorPreset[];
  photoBackdrop: boolean;
} {
  const palette = derivePalette(theme);
  const photoBackdrop = backgroundIsPhoto(theme);
  return { palette, paletteSwatches: paletteSwatches(palette, photoBackdrop ? ["background"] : []), photoBackdrop };
}
