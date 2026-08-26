import type { CardStyle, CardStyleOverrides } from "@/types/storefront";

/**
 * The handful of tile layouts sellers actually reach for, each one a single
 * choice instead of four.
 *
 * Placing a title and a price well means setting `titleStyle`, `titlePosition`,
 * `showTitle` and `priceTagPosition` so they agree with each other, and a
 * seller meeting those four controls cold has to discover the agreement by
 * trial. These presets ARE the agreement, written down. The four controls stay
 * available for anyone who wants past them; the presets just mean most people
 * never have to go there.
 *
 * They deliberately write nothing else. Roundness, colours, fonts and the chip's
 * own appearance are the seller's, and a layout choice has no business
 * resetting them.
 */

export const LAYOUT_PRESETS = [
  "standard",
  "caption",
  "header",
  "gallery",
  "bare",
] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** The four fields a preset decides. Anything outside this is left alone. */
export type LayoutPresetValues = Pick<
  CardStyle,
  "titleStyle" | "titlePosition" | "showTitle" | "priceTagPosition"
>;

export const LAYOUT_PRESET_VALUES: Record<LayoutPreset, LayoutPresetValues> = {
  // The default a storefront starts on: a plain bar under the picture with the
  // name and the price sharing it.
  standard: {
    titleStyle: "bar",
    titlePosition: "bottom-left",
    showTitle: true,
    priceTagPosition: "below",
  },
  // Words on the picture, price out of their way in the far corner.
  caption: {
    titleStyle: "overlay",
    titlePosition: "bottom-left",
    showTitle: true,
    priceTagPosition: "top-right",
  },
  // The bar above the picture instead of below it, which reads as a label on a
  // specimen rather than a caption under a photo.
  header: {
    titleStyle: "bar",
    titlePosition: "top-left",
    showTitle: true,
    priceTagPosition: "below",
  },
  // Picture first: the name sits on a gradient and the price is not shown at
  // all, which is how a lookbook behaves.
  gallery: {
    titleStyle: "shadow",
    titlePosition: "bottom-left",
    showTitle: true,
    priceTagPosition: "hidden",
  },
  // Nothing but the picture and a price chip on it.
  bare: {
    titleStyle: "overlay",
    titlePosition: "bottom-left",
    showTitle: false,
    priceTagPosition: "bottom-right",
  },
};

export const LAYOUT_PRESET_LABELS: Record<LayoutPreset, string> = {
  standard: "Standard",
  caption: "Caption",
  header: "Header",
  gallery: "Gallery",
  bare: "Bare",
};

/**
 * Which preset a tile is currently on, or null once it has been tuned past all
 * of them.
 *
 * Null is a real answer, not a failure: it is what makes the preset row honest
 * rather than a set of buttons one of which is always lit. A seller who nudged
 * the price one spot has left Standard, and the row should say so.
 */
export function matchLayoutPreset(card: CardStyle): LayoutPreset | null {
  for (const preset of LAYOUT_PRESETS) {
    const values = LAYOUT_PRESET_VALUES[preset];
    if (
      card.titleStyle === values.titleStyle &&
      card.showTitle === values.showTitle &&
      card.priceTagPosition === values.priceTagPosition &&
      // Position only has to agree while the title is shown: two tiles with no
      // title differ in nothing a buyer can see, so holding them apart on a
      // field neither renders would light no preset at all.
      (!card.showTitle || card.titlePosition === values.titlePosition)
    ) {
      return preset;
    }
  }
  return null;
}

/** A preset as a patch, for the one mutator both scopes already speak. */
export function layoutPresetPatch(preset: LayoutPreset): CardStyleOverrides {
  return { ...LAYOUT_PRESET_VALUES[preset] };
}
