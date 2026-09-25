// The STANDARD grid in the ColorPanel: the palette that is always there,
// whatever the storefront looks like.
//
// Three rows of ten, and the shape is the point. Each COLUMN is one hue family,
// so scanning left to right walks the spectrum and scanning down a column gets
// you the same hue darker. That is what makes a grid quicker than a list: you
// aim at a region, not at a swatch.
//
// Row 1 is the neutral ramp (the values in styles.md §2.1, which is where the
// product's own greys come from), white through black. Rows 2 and 3 are ten
// hues at mid and dark weight. Nothing pastel and nothing near-black in the hue
// rows: these are ACCENT colors that have to hold a price tag or a shape fill
// against both a white and a black canvas.
//
// The three fixed swatches in ColorPicker (color-presets.ts) are a strict
// subset of row 1 on purpose, so the one-tap shortcut and the grid never
// disagree about what white, grey and black are.
//
// Raw hex is permitted in THIS file alone — it is a token-definition module
// like color-presets.ts and globals.css @theme, not a component.

import type { MessageKey } from "@/i18n/types";
import type { ColorSwatch } from "./color-presets";

/** Names the columns, so every swatch can say which family it belongs to. */
const HUE_IDS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "teal",
  "sky",
  "blue",
  "violet",
  "pink",
] as const;

type HueId = (typeof HUE_IDS)[number];

const NEUTRAL_LABELS: readonly MessageKey[] = [
  "Storefront.colors.standard.white",
  "Storefront.colors.standard.grey200",
  "Storefront.colors.standard.grey300",
  "Storefront.colors.standard.grey400",
  "Storefront.colors.standard.grey",
  "Storefront.colors.standard.grey600",
  "Storefront.colors.standard.grey700",
  "Storefront.colors.standard.grey800",
  "Storefront.colors.standard.ink",
  "Storefront.colors.standard.black",
];

// Whole phrases per swatch ("Red dark"), never a hue name plus a suffix: the
// word order and agreement of "dark" differ by language.
const HUE_LABELS: Record<HueId, MessageKey> = {
  red: "Storefront.colors.standard.red",
  orange: "Storefront.colors.standard.orange",
  amber: "Storefront.colors.standard.amber",
  yellow: "Storefront.colors.standard.yellow",
  green: "Storefront.colors.standard.green",
  teal: "Storefront.colors.standard.teal",
  sky: "Storefront.colors.standard.sky",
  blue: "Storefront.colors.standard.blue",
  violet: "Storefront.colors.standard.violet",
  pink: "Storefront.colors.standard.pink",
};

const DARK_HUE_LABELS: Record<HueId, MessageKey> = {
  red: "Storefront.colors.standard.redDark",
  orange: "Storefront.colors.standard.orangeDark",
  amber: "Storefront.colors.standard.amberDark",
  yellow: "Storefront.colors.standard.yellowDark",
  green: "Storefront.colors.standard.greenDark",
  teal: "Storefront.colors.standard.tealDark",
  sky: "Storefront.colors.standard.skyDark",
  blue: "Storefront.colors.standard.blueDark",
  violet: "Storefront.colors.standard.violetDark",
  pink: "Storefront.colors.standard.pinkDark",
};

function row(
  labels: readonly MessageKey[],
  values: readonly string[],
): readonly ColorSwatch[] {
  return values.map((value, index) => ({ label: labels[index], value }));
}

/** Exactly three rows of ten. The panel renders this as a `grid-cols-10`. */
export const STANDARD_COLOR_ROWS: readonly (readonly ColorSwatch[])[] = [
  // Ten steps of the styles.md neutral ramp. #fafafa and #f5f5f5 are skipped
  // (indistinguishable from white at swatch size) to make room for BOTH #171717
  // and #000000, since the product's own defaults are ink, not pure black.
  row(NEUTRAL_LABELS, [
    "#ffffff",
    "#e5e5e5",
    "#d4d4d4",
    "#a3a3a3",
    "#737373",
    "#525252",
    "#404040",
    "#262626",
    "#171717",
    "#000000",
  ]),
  row(HUE_IDS.map((hue) => HUE_LABELS[hue]), [
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#0ea5e9",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
  ]),
  row(HUE_IDS.map((hue) => DARK_HUE_LABELS[hue]), [
    "#b91c1c",
    "#c2410c",
    "#b45309",
    "#a16207",
    "#15803d",
    "#0f766e",
    "#0369a1",
    "#1d4ed8",
    "#6d28d9",
    "#be185d",
  ]),
];

/** How many columns the grid is, so the panel's static Tailwind class and this
 *  data cannot drift apart. */
export const STANDARD_COLOR_COLUMNS = 10;
