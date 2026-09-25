// Preset palettes for the ColorPanel: small curated sets that hang together.
//
// WHY these exist next to the standard grid. The grid answers "give me a red";
// a palette answers "give me colors that work with the red I just used". Each
// one runs light to dark so a seller can take a background from one end and an
// accent from the other and get a storefront that looks composed rather than
// assembled.
//
// Clicking a swatch picks that single color, exactly like every other swatch in
// the panel. Applying a whole palette across the storefront is deliberately NOT
// what these do.
//
// Five of five: enough range to be worth scanning, short enough that each
// palette is one row at the panel's width.
//
// Raw hex is permitted in THIS file alone — a token-definition module, like
// standard-colors.ts and color-presets.ts.

import type { MessageKey } from "@/i18n/types";
import type { ColorSwatch } from "./color-presets";

export type ColorPalette = {
  /** Stable identity (React key). Never shown, never translated. */
  id: string;
  /** Shown above the row. */
  name: MessageKey;
  /** The row's accessible name, a whole phrase ("Sunset palette"). */
  group: MessageKey;
  colors: readonly ColorSwatch[];
};

export const COLOR_PALETTES: readonly ColorPalette[] = [
  {
    id: "sunset",
    name: "Storefront.colors.palettes.sunset.name",
    group: "Storefront.colors.palettes.sunset.group",
    colors: [
      { label: "Storefront.colors.palettes.sunset.swatches.cream", value: "#fef3c7" },
      { label: "Storefront.colors.palettes.sunset.swatches.amber", value: "#fbbf24" },
      { label: "Storefront.colors.palettes.sunset.swatches.orange", value: "#f97316" },
      { label: "Storefront.colors.palettes.sunset.swatches.red", value: "#dc2626" },
      { label: "Storefront.colors.palettes.sunset.swatches.ember", value: "#7c2d12" },
    ],
  },
  {
    id: "forest",
    name: "Storefront.colors.palettes.forest.name",
    group: "Storefront.colors.palettes.forest.group",
    colors: [
      { label: "Storefront.colors.palettes.forest.swatches.mist", value: "#f0fdf4" },
      { label: "Storefront.colors.palettes.forest.swatches.sage", value: "#86efac" },
      { label: "Storefront.colors.palettes.forest.swatches.green", value: "#22c55e" },
      { label: "Storefront.colors.palettes.forest.swatches.pine", value: "#15803d" },
      { label: "Storefront.colors.palettes.forest.swatches.deep", value: "#14532d" },
    ],
  },
  {
    id: "ocean",
    name: "Storefront.colors.palettes.ocean.name",
    group: "Storefront.colors.palettes.ocean.group",
    colors: [
      { label: "Storefront.colors.palettes.ocean.swatches.foam", value: "#f0f9ff" },
      { label: "Storefront.colors.palettes.ocean.swatches.sky", value: "#7dd3fc" },
      { label: "Storefront.colors.palettes.ocean.swatches.cyan", value: "#0ea5e9" },
      { label: "Storefront.colors.palettes.ocean.swatches.sea", value: "#0369a1" },
      { label: "Storefront.colors.palettes.ocean.swatches.navy", value: "#0c4a6e" },
    ],
  },
  {
    id: "mono",
    name: "Storefront.colors.palettes.mono.name",
    group: "Storefront.colors.palettes.mono.group",
    colors: [
      { label: "Storefront.colors.palettes.mono.swatches.white", value: "#ffffff" },
      { label: "Storefront.colors.palettes.mono.swatches.silver", value: "#d4d4d4" },
      { label: "Storefront.colors.palettes.mono.swatches.grey", value: "#737373" },
      { label: "Storefront.colors.palettes.mono.swatches.graphite", value: "#404040" },
      { label: "Storefront.colors.palettes.mono.swatches.ink", value: "#171717" },
    ],
  },
  {
    id: "candy",
    name: "Storefront.colors.palettes.candy.name",
    group: "Storefront.colors.palettes.candy.group",
    colors: [
      { label: "Storefront.colors.palettes.candy.swatches.blush", value: "#fdf2f8" },
      { label: "Storefront.colors.palettes.candy.swatches.rose", value: "#f9a8d4" },
      { label: "Storefront.colors.palettes.candy.swatches.pink", value: "#ec4899" },
      { label: "Storefront.colors.palettes.candy.swatches.purple", value: "#a855f7" },
      { label: "Storefront.colors.palettes.candy.swatches.violet", value: "#6d28d9" },
    ],
  },
];
