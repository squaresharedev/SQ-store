import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontVibe } from "@/types/storefront-brief";

// The three starting looks: the creation flow's "pick a look" step, and the
// Looks row inside the editor's Theme panel.
//
// This is what makes the flow worth a seller's time before templates exist:
// the look they pick is applied to the config on insert, so they land in a
// designer that already looks like the tile they chose instead of on a blank
// white board.
//
// WHAT SEPARATES THEM IS WHAT A TILE SHOWS, not what colour it is. There used
// to be six of these and they were six palettes — same tile, same always-on
// name and price under the picture, different accent. A seller could change
// that in two clicks, so choosing between them decided nothing. Each of these
// three answers the question a storefront is really built around:
//
//   Minimal  a gallery wall. Pictures and nothing else, generous gutters, and
//            a band that fades in on hover with the name and the price in it.
//   Classic  a shop. Every tile labelled, all the time: name on the left of a
//            bar under the picture, price on the right, in the same serif.
//   Bold     a catalogue. The price is always on the picture, large and in the
//            corner; the name arrives on hover. Tight gutters, no rounding, so
//            the tiles read as one block.
//
// Every value stays inside the existing theme contract (strict 6-digit hex,
// STOREFRONT_FONTS, 0..CORNER_RADIUS_MAX, 0..GRID_GAP_MAX, TITLE_STYLES,
// TITLE_DISPLAYS, PRICE_DISPLAYS, PRICE_TAG_POSITIONS, PRICE_TAG_FONTS,
// PRICE_TAG_SIZE_MIN..MAX), so storefrontConfigSchema validates these
// unchanged. If you add a preset, it has to hold to that: a preset is a
// starting point a seller then edits, never a way to put a value into config
// that the schema would reject on their next save.
//
// A NOTE ON `font: "serif"`. There is no --font-serif face loaded (globals.css
// ships Geist, Space Grotesk, JetBrains Mono, Inter and Shadows Into Light), so
// `serif` resolves to the platform default, Georgia or Times. That carries
// Classic well enough, but it is the one look not on a designed face. Loading a
// real serif is the obvious upgrade here.

/**
 * The slice of the theme a look decides.
 *
 * `Required`, not a bare `Pick`: two of these fields are optional on the theme,
 * and a preset that left one out would let a value from the PREVIOUS look
 * survive the switch — the seller would pick Minimal and keep Bold's oversized
 * price chip. Every look states every field, and the compiler is what enforces
 * that when a field is added here.
 *
 * Everything outside this list is the seller's: canvas size, colours of the
 * price chip, sold-out behaviour, the header and every per-tile override are
 * left exactly as they are.
 */
type VibePreset = Required<
  Pick<
    StorefrontTheme,
    | "background"
    | "accent"
    | "font"
    | "cornerRadius"
    | "gridGap"
    | "titleStyle"
    | "titleDisplay"
    | "showTitle"
    | "priceDisplay"
    | "priceTagPosition"
    | "priceTagFont"
    | "priceTagSize"
  >
>;

export const VIBE_PRESETS: Record<StorefrontVibe, VibePreset> = {
  minimal: {
    background: { kind: "solid", color: "#ffffff" },
    accent: "#171717",
    font: "sans",
    cornerRadius: 0,
    // Wide gutters: the white between the pictures is the design.
    gridGap: 16,
    // The band is drawn OVER the picture rather than under it, which is what
    // lets it be absent: a `bar` set to hover still holds its row in the tile's
    // column, so the tile would keep a blank stripe where the name will be.
    // `shadow`, not `overlay`: overlay SLIDES up from the tile edge on reveal
    // (see HOVER_RISE_CLASSES in ProductTileContent), which reads as a panel
    // being pulled onto the picture. shadow is the one style whose hover
    // reveal is a plain opacity fade — the gradient scrim and the words appear
    // in place, nothing moves, which is the quieter gallery-label behaviour
    // this look wants.
    titleStyle: "shadow",
    titleDisplay: "hover",
    showTitle: true,
    priceDisplay: "hover",
    // "below" means "in the title band", so the two arrive together as one
    // gallery label — name left, price right — instead of two separate reveals.
    priceTagPosition: "below",
    priceTagFont: "inter",
    priceTagSize: 10,
  },
  classic: {
    background: { kind: "solid", color: "#f5f3ef" },
    accent: "#3f3f46",
    font: "serif",
    cornerRadius: 8,
    gridGap: 8,
    titleStyle: "bar",
    titleDisplay: "always",
    showTitle: true,
    priceDisplay: "always",
    priceTagPosition: "below",
    // The price in the same serif as everything else: in the one look where it
    // is always on screen, a stray sans chip is the thing you notice.
    priceTagFont: "serif",
    priceTagSize: 10,
  },
  bold: {
    background: { kind: "solid", color: "#ffffff" },
    accent: "#1d4ed8",
    font: "display",
    // Tight gutters and no rounding: the tiles read as one block of colour.
    cornerRadius: 0,
    gridGap: 4,
    titleStyle: "overlay",
    titleDisplay: "hover",
    showTitle: true,
    // The one thing that never hides. It floats on the picture rather than
    // riding in the title band, because a tag in the band would come and go
    // with the band; top-RIGHT because the sold-out badge holds the top left.
    priceDisplay: "always",
    priceTagPosition: "top-right",
    priceTagFont: "inter",
    // Half again over the default. The price is this look's headline.
    priceTagSize: 15,
  },
};

/**
 * The theme a new storefront starts on. No look (the seller skipped the look
 * step, or the whole flow) means the plain default, which is the behaviour
 * every storefront had before this flow existed.
 */
export function themeForVibe(vibe: StorefrontVibe | undefined): StorefrontTheme {
  if (!vibe) return DEFAULT_STOREFRONT_CONFIG.theme;
  return { ...DEFAULT_STOREFRONT_CONFIG.theme, ...VIBE_PRESETS[vibe] };
}

/**
 * Is this theme still exactly what the look would have written?
 *
 * One edit away and the answer is no, which is the truth: a look is a starting
 * point, not a mode, and the picker's pressed state has to say so. Written as a
 * walk over the preset's own keys rather than a list of comparisons, so a field
 * added to VibePreset cannot be left out of the check and quietly leave a look
 * looking selected when it no longer is.
 */
export function themeMatchesVibe(
  theme: StorefrontTheme,
  vibe: StorefrontVibe,
): boolean {
  const preset = VIBE_PRESETS[vibe];
  for (const key of Object.keys(preset) as (keyof VibePreset)[]) {
    if (key === "background") continue;
    if (theme[key] !== preset[key]) return false;
  }
  // Every preset canvas is a flat colour, so anything else — a gradient, an
  // uploaded photo — is by definition not this look any more.
  return (
    preset.background.kind === "solid" &&
    theme.background.kind === "solid" &&
    theme.background.color === preset.background.color
  );
}
