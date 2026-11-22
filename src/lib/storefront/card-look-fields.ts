import type { MessageKey } from "@/i18n/types";
import { readableInkOn } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import type { ColorInheritLabels, ResolvedColorTarget } from "@/lib/theme/color-target";
import {
  TITLE_SHADOW_DEFAULT_COLOR,
  patchThemeCardStyle,
  resolveCardStyle,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * THE CARD LOOK'S THREE COLOURS, for the pickers (Photo cards, editor
 * upgrade): the card's own colour, the name strip's and the name's. Each lives
 * on the theme AND on a tile's overrides, like the price tag's colours, so a
 * picker has to know which layer it edits: on a tile, "unset" follows the
 * theme; on the theme, it follows what the card did before it had a colour.
 *
 * The inline pickers (CardStyleControls) and the docked colour panel
 * (lib/theme/color-target, kinds "card-color", "title-bar-color",
 * "title-text-color") both resolve through cardLookColorField, so the two can
 * never disagree about what is overridden or what "unset" looks like.
 */

/** The colour-panel kinds, one per field, so two of them on one card are
 *  never mistaken for the same field. */
export const CARD_LOOK_COLOR_KINDS = ["card-color", "title-bar-color", "title-text-color"] as const;
export type CardLookColorKind = (typeof CARD_LOOK_COLOR_KINDS)[number];

/** Which stored field each kind names. */
export const CARD_LOOK_COLOR_KEYS = {
  "card-color": "cardColor",
  "title-bar-color": "titleBarColor",
  "title-text-color": "titleTextColor",
} as const satisfies Record<CardLookColorKind, keyof CardStyleOverrides>;

const LABELS: Record<CardLookColorKind, MessageKey> = {
  "card-color": "EditorCards.panel.cardColor",
  "title-bar-color": "EditorCards.panel.nameStrip",
  "title-text-color": "EditorCards.panel.nameColor",
};

/** What each field follows on the THEME while it stores nothing: the card's
 *  old white, the card's colour, and the ink that reads on the strip. */
const THEME_INHERIT: Record<CardLookColorKind, ColorInheritLabels> = {
  "card-color": {
    label: "Storefront.colors.inherit.default.label",
    useLabel: "Storefront.colors.inherit.default.use",
  },
  "title-bar-color": {
    label: "Storefront.colors.inherit.cardColor.label",
    useLabel: "Storefront.colors.inherit.cardColor.use",
  },
  "title-text-color": {
    label: "Storefront.colors.inherit.auto.label",
    useLabel: "Storefront.colors.inherit.auto.use",
  },
};

/** What a TILE's field follows while it stores nothing: the theme. */
const TILE_INHERIT: ColorInheritLabels = {
  label: "Storefront.colors.inherit.themeColor.label",
  useLabel: "Storefront.colors.inherit.themeColor.use",
};

/** What every card was before it had a colour of its own (bg-card). */
const LEGACY_CARD_SURFACE = "#ffffff";

export function isCardLookColorKind(kind: string): kind is CardLookColorKind {
  return (CARD_LOOK_COLOR_KINDS as readonly string[]).includes(kind);
}

/** Gate on the way out: these land in a style attribute and a picker. */
function gate(hex: string | undefined): string | undefined {
  const lower = hex?.toLowerCase();
  return lower !== undefined && isStrictHexColor(lower) ? lower : undefined;
}

/** The colour a card really shows for one field, from both layers. */
function shown(theme: StorefrontTheme, overrides: CardStyleOverrides | undefined, kind: CardLookColorKind): string {
  const card = resolveCardStyle(theme, overrides);
  const surface = gate(card.cardColor) ?? LEGACY_CARD_SURFACE;
  switch (kind) {
    case "card-color":
      return surface;
    case "title-bar-color":
      return gate(card.titleBarColor) ?? surface;
    case "title-text-color": {
      const own = gate(card.titleTextColor);
      if (own) return own;
      const behind =
        card.titleStyle === "shadow"
          ? (gate(card.titleShadowColor) ?? TITLE_SHADOW_DEFAULT_COLOR)
          : (gate(card.titleBarColor) ?? surface);
      return readableInkOn(behind);
    }
  }
}

/** `layer` with this one field taken off, for "what if it were cleared". */
function without<T extends object>(layer: T, key: string): T {
  const next = { ...layer } as Record<string, unknown>;
  delete next[key];
  return next as T;
}

/**
 * One of the three colours, resolved for a picker. `overrides` present means
 * a tile (pass `block.style ?? {}`), absent means the theme itself.
 */
export function cardLookColorField(
  theme: StorefrontTheme,
  overrides: CardStyleOverrides | undefined,
  kind: CardLookColorKind,
): ResolvedColorTarget {
  const key = CARD_LOOK_COLOR_KEYS[kind];
  const stored = gate((overrides ?? theme)[key]);
  const cleared = overrides
    ? shown(theme, without(overrides, key), kind)
    : shown(without(theme, key), undefined, kind);
  return {
    label: LABELS[kind],
    value: shown(theme, overrides, kind),
    inherit: {
      ...(overrides ? TILE_INHERIT : THEME_INHERIT[kind]),
      value: cleared,
      active: stored === undefined,
    },
  };
}

/** The patch a pick (or a clear, with `undefined`) writes on a tile. */
export function cardLookColorPatch(kind: CardLookColorKind, hex: string | undefined): CardStyleOverrides {
  return { [CARD_LOOK_COLOR_KEYS[kind]]: hex };
}

/** The same pick on the theme. A clear DROPS the key (patchThemeCardStyle),
 *  so a theme whose colour was set and cleared is the one it was before. */
export function themeWithCardLookColor(
  theme: StorefrontTheme,
  kind: CardLookColorKind,
  hex: string | undefined,
): StorefrontTheme {
  return patchThemeCardStyle(theme, cardLookColorPatch(kind, hex));
}
