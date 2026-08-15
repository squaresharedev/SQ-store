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

import type { ColorPreset } from "./color-presets";

export type ColorPalette = {
  /** Shown beside the row, and used in each swatch's accessible name. */
  name: string;
  colors: readonly ColorPreset[];
};

export const COLOR_PALETTES: readonly ColorPalette[] = [
  {
    name: "Sunset",
    colors: [
      { name: "Cream", value: "#fef3c7" },
      { name: "Amber", value: "#fbbf24" },
      { name: "Orange", value: "#f97316" },
      { name: "Red", value: "#dc2626" },
      { name: "Ember", value: "#7c2d12" },
    ],
  },
  {
    name: "Forest",
    colors: [
      { name: "Mist", value: "#f0fdf4" },
      { name: "Sage", value: "#86efac" },
      { name: "Green", value: "#22c55e" },
      { name: "Pine", value: "#15803d" },
      { name: "Deep", value: "#14532d" },
    ],
  },
  {
    name: "Ocean",
    colors: [
      { name: "Foam", value: "#f0f9ff" },
      { name: "Sky", value: "#7dd3fc" },
      { name: "Cyan", value: "#0ea5e9" },
      { name: "Sea", value: "#0369a1" },
      { name: "Navy", value: "#0c4a6e" },
    ],
  },
  {
    name: "Mono",
    colors: [
      { name: "White", value: "#ffffff" },
      { name: "Silver", value: "#d4d4d4" },
      { name: "Grey", value: "#737373" },
      { name: "Graphite", value: "#404040" },
      { name: "Ink", value: "#171717" },
    ],
  },
  {
    name: "Candy",
    colors: [
      { name: "Blush", value: "#fdf2f8" },
      { name: "Rose", value: "#f9a8d4" },
      { name: "Pink", value: "#ec4899" },
      { name: "Purple", value: "#a855f7" },
      { name: "Violet", value: "#6d28d9" },
    ],
  },
];
