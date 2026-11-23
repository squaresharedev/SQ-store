import { readableOn, resolveInk, storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import { contrastRatio, mixHex } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import {
  PALETTE_SLOTS,
  TEXT_VARIANTS,
  type PaletteSlot,
  type StorefrontBackground,
  type StorefrontConfig,
  type StorefrontPalette,
  type StorefrontTheme,
} from "@/types/storefront";

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
 * Is the board's background a PHOTO? A photo has no colour a swatch could
 * honestly show (derivePalette stands in a dark one, as the board's ink has
 * always done), so on a photo board the Background slot wears nothing: no
 * field is painted in it, and a picker offers the photo, not that stand-in.
 */
export function backgroundIsPhoto(theme: Pick<StorefrontTheme, "background">): boolean {
  return theme.background.kind === "image";
}

/**
 * A background laid on the theme. The palette's Background colour follows a
 * SOLID one (when the storefront has a palette of its own), so the swatch
 * always shows the colour the board is. Nothing else is recoloured: this
 * is a change of background, not of palette.
 */
export function withBackground(theme: StorefrontTheme, background: StorefrontBackground): StorefrontTheme {
  const next: StorefrontTheme = { ...theme, background };
  if (theme.palette && background.kind === "solid") next.palette = { ...theme.palette, background: background.color };
  return next;
}

// ROLES ---------------------------------------------------------------------
//
// A palette change recolours BY VALUE: every colour field wearing the old hex
// takes the new one. That is exact until two slots wear the SAME hex (a white
// board with white cards: Background and Surface are both #ffffff), when a
// value cannot say which slot it belongs to. A field's ROLE settles that: the
// slot it is, by what it means. In that one case only the fields whose role
// is the slot being changed follow it; a field with no role (a shape's fill,
// a band's gradient, a star colour) stays as it is. When the hex is not
// shared every colour field follows, role or not.
//
// THIS IS THE ONE PLACE roles are decided. The fields are those of
// types/storefront (EDITOR UPGRADE CONTRACT, the colour naming rule).

/**
 * The roles of the colour fields whose NAME says what they are, wherever they
 * sit (the theme's, a card's own override, the page's).
 *
 *   accent      the theme's accent; the buy button's fill (the product page's
 *               `ctaColor` and the card's `buyButtonColor`, which follow the
 *               accent until chosen); the store name (`nameColor`, the accent
 *               until chosen)
 *   surface     the card's colour and the name strip's (which is the card's
 *               until chosen)
 *   text        the card name's ink and the bio's
 *   background  a product page's or the checkout's own background
 *
 * Not here, because no slot is what they are: a shape's `color` and
 * `borderColor`, a gradient's stops on a shape or band, the stars, the price
 * tag, the sale badge, the shadow, the button's label ink (picked to read on
 * its fill) and its border.
 */
export const FIELD_ROLES: Readonly<Record<string, PaletteSlot>> = {
  accent: "accent",
  ctaColor: "accent",
  buyButtonColor: "accent",
  nameColor: "accent",
  cardColor: "surface",
  titleBarColor: "surface",
  titleTextColor: "text",
  bioColor: "text",
  backgroundColor: "background",
};

/** Where a colour field sits, as far as its role goes: the keys from the root
 *  (array positions left out) and, inside a text block, a scrolling strip or
 *  a saved text style, which text style it wears. */
export type FieldScope = {
  path: readonly string[];
  /** Set inside text. `variant` is absent for a strip left on its default. */
  ink?: { variant?: string };
};

const ROOT_SCOPE: FieldScope = { path: [] };

/** The theme's own background (a solid's `color`, a gradient's stops). */
const isThemeBackground = (path: readonly string[]) => path.length === 2 && path[0] === "theme" && path[1] === "background";

/**
 * The slot a colour field belongs to, or undefined when it belongs to none.
 * `key` is already known to be a colour key (isColorKey).
 *
 * `color`, `from`, `via` and `to` are too general to name a slot on their own,
 * so where they sit decides:
 *   - the theme's background: Background
 *   - the words of a text block, a scrolling strip or a saved text style (and
 *     the runs inside a block): Accent for a heading, which follows the accent
 *     until chosen, Text for every other style
 *   - a band's solid colour: Muted, which is what a new band is made in
 */
export function paletteRoleOf(scope: FieldScope, key: string): PaletteSlot | undefined {
  const { path, ink } = scope;
  if (key === "color" || key === "from" || key === "via" || key === "to") {
    if (isThemeBackground(path)) return "background";
    if (key !== "color") return undefined;
    if (ink) return ink.variant === "heading" ? "accent" : "text";
    if (path.length === 2 && path[0] === "bands" && path[1] === "background") return "muted";
    return undefined;
  }
  return Object.hasOwn(FIELD_ROLES, key) ? FIELD_ROLES[key] : undefined;
}

/** The scope a holder's own members are read in: inside a text block or a
 *  scrolling strip that is the style it wears (a strip's `variant` is absent
 *  for the default Small label). */
function ownScope(scope: FieldScope, holder: Record<string, unknown>): FieldScope {
  if (holder.type !== "text" && holder.type !== "marquee") return scope;
  return { path: scope.path, ink: scope.ink ?? { variant: typeof holder.variant === "string" ? holder.variant : undefined } };
}

/** The scope of an object or array held by `holder` under `key`. A saved
 *  text style is named by its key (`textStyles.heading`). */
function childScope(own: FieldScope, key: string): FieldScope {
  const savedStyle = own.path.at(-1) === "textStyles" && (TEXT_VARIANTS as readonly string[]).includes(key);
  return { path: [...own.path, key], ink: savedStyle ? { variant: key } : own.ink };
}

type Change = {
  from: string;
  to: string;
  /** Set when another slot wears the colour too: only the fields that ARE
   *  this slot (paletteRoleOf) take the new one. Absent: every field does. */
  only?: PaletteSlot;
};

/**
 * Every colour in `value` equal to `change.from`, replaced with `change.to`.
 * Walks the whole config and touches only strict hex under a colour key, so a
 * text block whose WORDS happen to read "#ffffff" is left alone. The stored
 * palette is not walked: the caller writes it.
 */
function replaced<T>(value: T, change: Change, scope: FieldScope = ROOT_SCOPE, key?: string): T {
  if (typeof value === "string") {
    if (key === undefined || !isColorKey(key) || !isStrictHexColor(value) || !sameHex(value, change.from)) return value;
    if (change.only && paletteRoleOf(scope, key) !== change.only) return value;
    return change.to as T;
  }
  if (Array.isArray(value)) return value.map((item) => replaced(item, change, scope)) as T;
  if (value === null || typeof value !== "object") return value;
  const holder = value as Record<string, unknown>;
  const own = ownScope(scope, holder);
  const next: Record<string, unknown> = {};
  for (const [member, inner] of Object.entries(holder)) {
    next[member] =
      member === "palette"
        ? inner
        : replaced(inner, change, typeof inner === "string" ? own : childScope(own, member), member);
  }
  return next as T;
}

/** Replace one colour with another wherever the storefront wears it. */
export function replaceColor(config: StorefrontConfig, from: string, to: string): StorefrontConfig {
  return sameHex(from, to) ? config : replaced(config, { from, to });
}

/**
 * Set a palette colour, and recolour the storefront to match.
 *
 * Everything painted in the slot's old colour takes the new one, UNLESS
 * another slot wears that same colour: a value cannot say which slot it
 * belongs to, so then only the fields that ARE the slot move (their ROLE, see
 * paletteRoleOf) and every other field stays. The theme members that are the
 * slot (the accent, a solid background) always move. Stores the palette, which
 * is what turns a derived one into the storefront's own.
 *
 * On a PHOTO board the Background slot wears nothing (backgroundIsPhoto), so
 * choosing a colour for it recolours nothing: it replaces the photo with that
 * colour. And its stand-in never counts as another slot's colour.
 */
export function recolourPalette(config: StorefrontConfig, slot: PaletteSlot, hex: string): StorefrontConfig {
  return recolourPaletteIn(config, slot, hex);
}

/**
 * recolourPalette over anything that carries a theme: a config, or the
 * designer's own undoable state (theme, blocks, header, the pages and
 * whatever else rides beside them). The walk is by value, so every member the
 * state holds is recoloured with no list to keep up to date.
 */
export function recolourPaletteIn<T extends { theme: StorefrontTheme }>(state: T, slot: PaletteSlot, hex: string): T {
  const photo = backgroundIsPhoto(state.theme);
  const current = derivePalette(state.theme);
  const old = current[slot];
  const wornByOther = PALETTE_SLOTS.some(
    (other) => other !== slot && !(photo && other === "background") && sameHex(current[other], old),
  );
  const wearsNothing = photo && slot === "background";
  const recoloured =
    wearsNothing || sameHex(old, hex) ? state : replaced(state, { from: old, to: hex, only: wornByOther ? slot : undefined });
  const theme: StorefrontTheme = { ...recoloured.theme, palette: { ...current, [slot]: hex } };
  if (slot === "accent") theme.accent = hex;
  if (slot === "background" && (photo || theme.background.kind === "solid")) {
    theme.background = { kind: "solid", color: hex };
  }
  return { ...recoloured, theme };
}

/** A palette change when only the theme is in reach (a panel that is handed
 *  the theme alone): the same rule, over the theme's own colours. */
export function recolourThemePalette(theme: StorefrontTheme, slot: PaletteSlot, hex: string): StorefrontTheme {
  return recolourPaletteIn({ theme }, slot, hex).theme;
}

/** WCAG AA for ordinary text: the contrast the palette's Text colour needs
 *  against the background before it may be the board's ink. */
export const TEXT_CONTRAST_AA = 4.5;

/**
 * THE BOARD'S INK: what every word on the board that names no colour of its
 * own is written in.
 *
 * With a stored palette it is the palette's Text colour, as long as that
 * reads on the background (WCAG AA); otherwise, and always without a stored
 * palette, the automatic dark-or-light ink every board has had (resolveInk).
 * A derived palette never changes the ink: it stores nothing, so a storefront
 * saved before palettes keeps its exact words.
 */
export function boardInk(theme: StorefrontTheme): string {
  return paletteInk(theme) ?? resolveInk(theme);
}

/**
 * The palette's half of boardInk: its Text colour when one is stored and reads
 * on the background, else undefined (and the caller keeps the ink it has
 * always had: `paletteInk(theme) ?? resolveInk(theme)`).
 */
export function paletteInk(theme: StorefrontTheme): string | undefined {
  const text = theme.palette?.text;
  if (text && isStrictHexColor(text) && contrastRatio(text, storefrontBackdropHex(theme)) >= TEXT_CONTRAST_AA) {
    return text.toLowerCase();
  }
  return undefined;
}

/**
 * The ink as a style, for the designer's canvas, which (unlike the buyer's
 * board) has never set one and so inherits the editor's own. Empty without a
 * stored palette, so an old storefront's canvas gains nothing; with one, the
 * canvas writes in what the buyer will read.
 */
export function paletteInkStyle(theme: StorefrontTheme): { color?: string } {
  return theme.palette ? { color: boardInk(theme) } : {};
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
