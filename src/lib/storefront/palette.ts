import { readableOn, storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import { mixHex } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import { PALETTE_SLOTS, type PaletteSlot, type StorefrontConfig, type StorefrontPalette, type StorefrontTheme } from "@/types/storefront";

/**
 * THE PALETTE, as pure data: what the five swatches are, and what changing one
 * does. No React and no storage, so the editor, the assistant's `palette`
 * operation and the tests all run the same rules.
 *
 * HOW "CHANGE IT EVERYWHERE" WORKS WITHOUT REFERENCES. A config holds plain
 * hex in every colour field, and it stays that way: nothing stores "the
 * accent", so no renderer (and no storefront already embedded on a seller's
 * website) can ever meet a value it does not understand. Changing a palette
 * colour instead REPLACES that hex wherever the config wears it, the way
 * "change all" works in a design tool. The palette object is the record of
 * which five colours those are.
 */

/** How much of the ink is mixed into the background for a derived `muted`. */
const DERIVED_MUTED_MIX = 0.12;
/** The card surface every storefront had before cards could be coloured. */
const LEGACY_SURFACE = "#ffffff";

/**
 * The storefront's palette: its own when it has stored one, else one read off
 * what it already wears, so the pickers of a storefront saved before palettes
 * open on its real colours. Deriving stores nothing.
 */
export function derivePalette(theme: StorefrontTheme): StorefrontPalette {
  if (theme.palette) return theme.palette;
  const background = storefrontBackdropHex(theme);
  const text = readableOn(background);
  return {
    background,
    text,
    accent: theme.accent,
    surface: theme.cardColor ?? LEGACY_SURFACE,
    muted: mixHex(background, text, DERIVED_MUTED_MIX),
  };
}

/**
 * Is this key a colour field? THE CONTRACT'S NAMING RULE (types/storefront,
 * EDITOR UPGRADE CONTRACT): a colour lives in a field named `color`, `accent`,
 * `from`, `via` or `to`, or ending in `Color`. A new colour field that follows
 * the rule is recoloured with no further wiring.
 */
export function isColorKey(key: string): boolean {
  return key === "color" || key === "accent" || key === "from" || key === "via" || key === "to" || key.endsWith("Color");
}

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Every colour in `value` equal to `from`, replaced with `to`. Walks the whole
 * config and touches only strict hex under a colour key (and the palette's own
 * five), so a text block whose WORDS happen to read "#ffffff" is left alone.
 */
function replaced<T>(value: T, from: string, to: string, underColorKey = false): T {
  if (typeof value === "string") {
    return (underColorKey && isStrictHexColor(value) && sameHex(value, from) ? to : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => replaced(item, from, to)) as T;
  if (value === null || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    // Inside `palette` every member is a colour, whatever its slot is called.
    next[key] =
      key === "palette" && member && typeof member === "object"
        ? Object.fromEntries(Object.entries(member).map(([slot, hex]) => [slot, replaced(hex, from, to, true)]))
        : replaced(member, from, to, isColorKey(key));
  }
  return next as T;
}

/** Replace one colour with another wherever the storefront wears it. */
export function replaceColor(config: StorefrontConfig, from: string, to: string): StorefrontConfig {
  return sameHex(from, to) ? config : replaced(config, from, to);
}

/**
 * Set a palette colour, and recolour the storefront to match.
 *
 * Everything painted in the slot's old colour takes the new one, UNLESS
 * another slot wears that same colour: two slots sharing a hex are told apart
 * by nothing in the config, so then only the slot itself moves, and the theme
 * members that ARE that slot (the accent, a solid background, the card
 * colour) move with it. Stores the palette, which is what turns a derived one
 * into the storefront's own.
 */
export function recolourPalette(config: StorefrontConfig, slot: PaletteSlot, hex: string): StorefrontConfig {
  const current = derivePalette(config.theme);
  const old = current[slot];
  const shared = PALETTE_SLOTS.some((other) => other !== slot && sameHex(current[other], old));
  const recoloured = shared ? config : replaceColor(config, old, hex);
  const theme: StorefrontTheme = { ...recoloured.theme, palette: { ...current, [slot]: hex } };
  if (slot === "accent") theme.accent = hex;
  if (slot === "background" && theme.background.kind === "solid") {
    theme.background = { kind: "solid", color: hex };
  }
  if (slot === "surface" && config.theme.cardColor !== undefined && sameHex(config.theme.cardColor, old)) {
    theme.cardColor = hex;
  }
  return { ...recoloured, theme };
}

/** Set the whole palette at once, one slot after another. */
export function recolourPalettes(config: StorefrontConfig, palette: Partial<StorefrontPalette>): StorefrontConfig {
  let next = config;
  for (const slot of PALETTE_SLOTS) {
    const hex = palette[slot];
    if (hex !== undefined) next = recolourPalette(next, slot, hex);
  }
  return next;
}
