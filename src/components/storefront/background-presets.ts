import type { CSSProperties } from "react";
import { isBackgroundPreset, type BackgroundPreset } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";

// The ONLY place preset background styles are defined. The config stores just
// the preset key (validated against the allowlist in types/storefront.ts);
// this map turns a key into known-safe CSS. The designer preview and the
// future embed must both resolve through here so they render identically.
//
// Raw color values are permitted in this file alone (like globals.css
// @theme): these are the token definitions for storefront canvases, not
// component-level literals. Presets stay soft/light (plus one dark) so the
// seller's tiles keep contrast on top of them.

export const BACKGROUND_PRESET_STYLES: Record<
  BackgroundPreset,
  { label: string; style: CSSProperties }
> = {
  linen: {
    label: "Linen",
    style: { background: "linear-gradient(180deg, #fafaf9 0%, #f3efe7 100%)" },
  },
  mist: {
    label: "Mist",
    style: { background: "linear-gradient(180deg, #f8fafc 0%, #e7edf4 100%)" },
  },
  blush: {
    label: "Blush",
    style: { background: "linear-gradient(160deg, #fdf2f8 0%, #fbe3ef 100%)" },
  },
  sage: {
    label: "Sage",
    style: { background: "linear-gradient(160deg, #f3faf3 0%, #dfeede 100%)" },
  },
  sky: {
    label: "Sky",
    style: { background: "linear-gradient(160deg, #f0f9ff 0%, #dcebfb 100%)" },
  },
  lilac: {
    label: "Lilac",
    style: { background: "linear-gradient(160deg, #faf5ff 0%, #ebe6fa 100%)" },
  },
  sand: {
    label: "Sand",
    style: { background: "linear-gradient(160deg, #fffbeb 0%, #faeec9 100%)" },
  },
  ink: {
    label: "Ink",
    style: { background: "linear-gradient(160deg, #18181b 0%, #27272a 100%)" },
  },
};

/**
 * Resolve a stored `theme.background` into a style object. Preset keys map
 * through the allowlist above; anything else must pass the strict hex gate.
 * Unrecognized values (should never survive the schema) style nothing.
 */
export function resolveBackgroundStyle(
  background: string,
): CSSProperties | undefined {
  if (isBackgroundPreset(background)) {
    return BACKGROUND_PRESET_STYLES[background].style;
  }
  if (isStrictHexColor(background)) {
    return { backgroundColor: background };
  }
  return undefined;
}
