import { mixHex } from "@/lib/format/color";
import type { ColorPreset } from "./color-presets";

/**
 * Four swatches built from a color the seller already chose (the theme's
 * accent), light to dark — the personal counterpart to COLOR_PRESETS' fixed
 * neutrals. Where the neutrals are the same three dots on every field, these
 * are quick picks that always match whatever this storefront's brand color
 * currently is, for a field that wants "something from my theme" rather than
 * "black, white or grey".
 *
 * Same light-to-dark shape as COLOR_PALETTES, and for the same reason: a
 * seller can read the row as one end being the pale option and the other the
 * deep one, without checking each swatch's name.
 */
export function themeAccentPresets(accent: string): readonly ColorPreset[] {
  return [
    { name: "Pale accent", value: mixHex(accent, "#ffffff", 0.85) },
    { name: "Soft accent", value: mixHex(accent, "#ffffff", 0.45) },
    { name: "Accent", value: accent },
    { name: "Deep accent", value: mixHex(accent, "#000000", 0.45) },
  ];
}
