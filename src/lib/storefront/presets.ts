import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontVibe } from "@/types/storefront-brief";

// Starting themes for the creation flow's "pick a look" step.
//
// This is what makes the flow worth a seller's time before templates exist:
// the vibe they pick is applied to the config on insert, so they land in a
// designer that already looks like the tile they chose instead of on a blank
// white board. Everything else the flow collects is for later; this is for now.
//
// Every value stays inside the existing theme contract (strict 6-digit hex,
// STOREFRONT_FONTS, 0..CORNER_RADIUS_MAX, 0..GRID_GAP_MAX, TITLE_STYLES), so
// storefrontConfigSchema validates these unchanged. If you add a preset, it has
// to hold to that: a preset is a starting point a seller then edits, never a
// way to put a value into config that the schema would reject on their next
// save.
//
// A NOTE ON `font: "serif"`. There is no --font-serif face loaded (globals.css
// ships Geist, Space Grotesk, JetBrains Mono, Inter and Shadows Into Light), so
// `serif` resolves to the platform default, Georgia or Times. That carries the
// two presets that use it well enough, but they are the only ones not on a
// designed face. Loading a real serif is the obvious upgrade here.

/** The subset of the theme a vibe decides. Everything else keeps its default. */
type VibePreset = Pick<
  StorefrontTheme,
  "background" | "accent" | "font" | "cornerRadius" | "gridGap" | "titleStyle"
>;

export const VIBE_PRESETS: Record<StorefrontVibe, VibePreset> = {
  minimal: {
    background: { kind: "solid", color: "#ffffff" },
    accent: "#171717",
    font: "sans",
    cornerRadius: 0,
    gridGap: 8,
    titleStyle: "bar",
  },
  warm: {
    background: { kind: "solid", color: "#faf6f0" },
    accent: "#a8623a",
    font: "sans",
    cornerRadius: 16,
    gridGap: 12,
    titleStyle: "bar",
  },
  bold: {
    background: { kind: "solid", color: "#ffffff" },
    accent: "#1d4ed8",
    font: "display",
    // Tight gutters and no rounding: the tiles read as one block of colour.
    cornerRadius: 0,
    gridGap: 4,
    titleStyle: "overlay",
  },
  playful: {
    background: { kind: "solid", color: "#fff7ed" },
    accent: "#ea580c",
    font: "display",
    cornerRadius: 24,
    gridGap: 12,
    titleStyle: "bar",
  },
  luxe: {
    background: { kind: "solid", color: "#111111" },
    accent: "#c9a227",
    font: "serif",
    cornerRadius: 0,
    gridGap: 8,
    // The one style that renders its title in white over a dark gradient on the
    // image itself, which is the only one that holds up on a black canvas.
    titleStyle: "shadow",
  },
  classic: {
    background: { kind: "solid", color: "#f5f3ef" },
    accent: "#3f3f46",
    font: "serif",
    cornerRadius: 8,
    gridGap: 8,
    titleStyle: "bar",
  },
};

/**
 * The theme a new storefront starts on. No vibe (the seller skipped the look
 * step, or the whole flow) means the plain default, which is the behaviour
 * every storefront had before this flow existed.
 */
export function themeForVibe(vibe: StorefrontVibe | undefined): StorefrontTheme {
  if (!vibe) return DEFAULT_STOREFRONT_CONFIG.theme;
  return { ...DEFAULT_STOREFRONT_CONFIG.theme, ...VIBE_PRESETS[vibe] };
}
