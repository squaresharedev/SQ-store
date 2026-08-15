import {
  PRICE_TAG_DEFAULT_BORDER,
  PRICE_TAG_SHADOW_TEXT,
  blockKey,
  defaultPriceTagFill,
  resolveCardStyle,
  type CardStyle,
  type CardStyleOverrides,
  type HeaderLine,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { rangeColor } from "@/lib/storefront/text-spans";

/**
 * WHICH color the left-hand ColorPanel is editing.
 *
 * A DESCRIPTOR, deliberately — not a `{ value, onChange }` pair. The panel sits
 * on the far side of the tree from the fields it edits (theme colors live in the
 * right panel, block colors in the inspector), and carrying a closure across
 * that distance means re-registering the target on every render and reading a
 * stale `onChange` the moment the block changes underneath it.
 *
 * Because this is plain serializable data, the hard cases fall out for free:
 * undo, deleting the selected block, switching the background to an image, and
 * re-selecting all just change what `resolveColorTarget` returns. Nothing holds
 * a reference to a block that no longer exists.
 *
 * StorefrontDesigner owns the theme and the blocks, so it is the one place that
 * turns a ref back into a mutation, through the same mutators the editors use
 * (so undo history and the dirty flag behave identically).
 */
export type ColorTargetRef =
  | { kind: "theme-accent" }
  | { kind: "theme-background-solid" }
  | { kind: "theme-background-from" }
  | { kind: "theme-background-to" }
  | { kind: "header-name" }
  | { kind: "header-bio" }
  | { kind: "shape-fill"; blockKey: string }
  | { kind: "shape-border"; blockKey: string }
  | { kind: "text-color"; blockKey: string }
  // The one ref that spans both scopes: the price tag's three colors live on
  // the theme AND on a tile's overrides, and the same panel edits either. No
  // blockKey means the theme.
  | { kind: "price-tag"; part: PriceTagPart; blockKey?: string };

/** Which of the price tag's three colors a ref names. */
export type PriceTagPart = "fill" | "text" | "border";

/** What a shape's outline renders in when it carries no explicit border color.
 *  Shared with ShapeBlockEditor so the panel and the field cannot disagree
 *  about what "no override" looks like. */
export const DEFAULT_SHAPE_BORDER_COLOR = "#171717";

/** What a non-heading text block renders in with no color override. Also what
 *  the masthead's bio follows, for the same reason: it is body copy. */
export const DEFAULT_TEXT_COLOR = "#171717";

/**
 * The colors the masthead follows when its two lines carry no override of their
 * own: the store name tracks the theme accent (it is the storefront's heading),
 * the bio the default ink. Shared by the renderer, the inline pickers and the
 * color panel, so none of them can disagree about what inheriting looks like.
 */
export function headerThemeColors(accent: string): {
  name: string;
  bio: string;
} {
  return { name: gate(accent, DEFAULT_TEXT_COLOR), bio: DEFAULT_TEXT_COLOR };
}

/** Whether one masthead line is actually rendered right now. Mirrors what
 *  StorefrontMasthead draws: nothing while hidden, and nothing for a line with
 *  no text of its own. */
export function headerLineVisible(
  header: StorefrontHeader,
  line: HeaderLine,
): boolean {
  return header.show && header[line].trim().length > 0;
}

/**
 * The color a text block follows when it has no override of its own: headings
 * track the theme accent, everything else the default ink. Exported so
 * TextBlockEditor's inherit dot and the panel resolve it identically.
 *
 * Takes the accent rather than the whole theme, because TextBlockEditor is
 * handed only that.
 */
export function textBlockThemeColor(
  accent: string,
  block: Pick<TextBlock, "variant">,
): string {
  return block.variant === "heading" ? accent : DEFAULT_TEXT_COLOR;
}

/** Which stored field each part of the price tag names. */
export const PRICE_TAG_COLOR_KEYS = {
  fill: "priceTagColor",
  text: "priceTagTextColor",
  border: "priceTagBorderColor",
} as const satisfies Record<PriceTagPart, keyof CardStyle>;

const PRICE_TAG_COLOR_LABELS: Record<PriceTagPart, string> = {
  fill: "Tag color",
  text: "Text color",
  border: "Border color",
};

/**
 * What the price actually paints while `priceTagTextColor` is unset: the theme
 * accent, unless the tag sits unbacked in a `shadow` title area, whose gradient
 * is dark by construction and would swallow it. Shared by the renderer and
 * both pickers so none of them can disagree about what "Auto" looks like.
 */
export function priceTagAutoTextColor(card: CardStyle, accent: string): string {
  return card.priceTagPosition === "below" && card.titleStyle === "shadow"
    ? PRICE_TAG_SHADOW_TEXT
    : gate(accent, DEFAULT_TEXT_COLOR);
}

/**
 * What one of the tag's three colors renders as when NOTHING sets it, anywhere.
 * NOTE the fill: a tag in the info bar renders with no fill at all, which a dot
 * cannot depict, so the dot shows white and says "No fill" —
 * `defaultPriceTagFill` remains the render truth.
 */
function priceTagAutoColor(
  card: CardStyle,
  accent: string,
  part: PriceTagPart,
): { label: string; value: string } {
  switch (part) {
    case "fill": {
      const fill = defaultPriceTagFill(card.priceTagPosition);
      return fill === "transparent"
        ? { label: "No fill", value: "#ffffff" }
        : { label: "Card color", value: fill };
    }
    case "text":
      return { label: "Theme color", value: priceTagAutoTextColor(card, accent) };
    case "border":
      return { label: "Default", value: PRICE_TAG_DEFAULT_BORDER };
  }
}

/**
 * One of the tag's colors, resolved for a picker.
 *
 * The subtlety is WHICH LAYER is being edited: `overrides` present means a
 * tile, and then "unset" means that tile stores nothing — even when the theme
 * does — and clearing goes back to the theme's color. Absent means the theme
 * itself, where clearing goes back to the coded default. Reading the merged
 * CardStyle for this would make every tile look overridden the moment the
 * theme set a color.
 *
 * Shared by the docked ColorPanel and PriceTagControls' inline pickers, so the
 * two can never disagree about what is overridden or what "Auto" looks like.
 */
export function priceTagColorField(
  theme: StorefrontTheme,
  overrides: CardStyleOverrides | undefined,
  part: PriceTagPart,
): ResolvedColorTarget {
  const key = PRICE_TAG_COLOR_KEYS[part];
  const stored = (overrides ?? theme)[key];
  const auto = priceTagAutoColor(
    resolveCardStyle(theme, overrides),
    theme.accent,
    part,
  );
  const inherit = overrides
    ? { label: "Theme color", value: gate(theme[key], auto.value) }
    : auto;
  return {
    label: PRICE_TAG_COLOR_LABELS[part],
    value: gate(stored, inherit.value),
    inherit: { ...inherit, active: stored === undefined },
  };
}

/** Words selected inside one text block's in-place editor: half-open
 *  character offsets, plus whose block they are. */
export type TextSelectionTarget = {
  blockKey: string;
  range: { start: number; end: number };
};

/** A target resolved against current state, ready to render. */
export type ResolvedColorTarget = {
  /** Names the field in the panel header, e.g. "Fill", "Accent". */
  label: string;
  /** Strict lowercase hex actually in effect right now. */
  value: string;
  /**
   * Present only when the stored value is optional (absent = follow something
   * else), so the panel can offer "back to the theme" without inventing its own
   * reset affordance. Mirrors ColorPicker's `inherit`.
   */
  inherit?: { label: string; value: string; active: boolean };
};

function find(blocks: readonly StorefrontBlock[], key: string) {
  return blocks.find((block) => blockKey(block) === key) ?? null;
}

/** Gate on the way OUT as well as in: configs are parsed from a jsonb column,
 *  and every value here is about to land in a style attribute. */
function gate(hex: string | undefined, fallback: string): string {
  const lower = (hex ?? "").toLowerCase();
  return isStrictHexColor(lower) ? lower : fallback;
}

/**
 * Resolve a ref against live state, or null when the target no longer exists —
 * the block was deleted or undone away, or the background changed to a kind
 * that holds no color of that name. The panel treats null as "close yourself"
 * rather than rendering a field that edits nothing.
 */
export function resolveColorTarget(
  ref: ColorTargetRef,
  theme: StorefrontTheme,
  blocks: readonly StorefrontBlock[],
  header: StorefrontHeader,
  /** Words selected in the in-place text editor, when there are any. A colour
   *  applies to them rather than to the whole block, so the panel has to
   *  resolve against them too. */
  selection?: TextSelectionTarget | null,
): ResolvedColorTarget | null {
  switch (ref.kind) {
    case "theme-accent":
      return { label: "Accent", value: gate(theme.accent, "#171717") };

    // The two masthead lines resolve only while they are actually on screen:
    // hiding the header (or emptying the line) leaves nothing to style, so the
    // panel closes rather than editing something invisible — the same rule the
    // background stops resolving under.
    case "header-name": {
      if (!headerLineVisible(header, "name")) return null;
      const themeColor = headerThemeColors(theme.accent).name;
      return {
        label: "Store name",
        value: gate(header.nameColor, themeColor),
        inherit: {
          label: "Theme color",
          value: themeColor,
          active: header.nameColor === undefined,
        },
      };
    }

    case "header-bio": {
      if (!headerLineVisible(header, "bio")) return null;
      const themeColor = headerThemeColors(theme.accent).bio;
      return {
        label: "Bio",
        value: gate(header.bioColor, themeColor),
        inherit: {
          label: "Theme color",
          value: themeColor,
          active: header.bioColor === undefined,
        },
      };
    }

    case "theme-background-solid":
      return theme.background.kind === "solid"
        ? { label: "Background", value: gate(theme.background.color, "#ffffff") }
        : null;

    case "theme-background-from":
      return theme.background.kind === "gradient"
        ? { label: "Gradient from", value: gate(theme.background.from, "#ffffff") }
        : null;

    case "theme-background-to":
      return theme.background.kind === "gradient"
        ? { label: "Gradient to", value: gate(theme.background.to, "#e5e5e5") }
        : null;

    case "shape-fill": {
      const block = find(blocks, ref.blockKey);
      if (block?.type !== "shape") return null;
      // A ring draws its stroke in `color`, so calling it "Fill" would name the
      // one thing it does not have.
      return {
        label: block.kind === "ring" ? "Color" : "Fill",
        value: gate(block.color, "#171717"),
      };
    }

    case "shape-border": {
      const block = find(blocks, ref.blockKey);
      if (block?.type !== "shape") return null;
      // Deliberately no `inherit`: ShapeTileContent omits the CSS property
      // entirely when borderColor is absent, so "clear it" would produce a
      // browser default rather than the color shown here.
      return {
        label: "Border color",
        value: gate(block.borderColor, DEFAULT_SHAPE_BORDER_COLOR),
      };
    }

    case "text-color": {
      const block = find(blocks, ref.blockKey);
      if (block?.type !== "text") return null;
      const themeColor = gate(
        textBlockThemeColor(theme.accent, block),
        DEFAULT_TEXT_COLOR,
      );
      // Words selected in the in-place editor are what a colour would land on,
      // so the panel says so and shows THEIR colour. Without this the field
      // would read "Text color: black" while about to recolour two red words.
      if (selection && selection.blockKey === ref.blockKey) {
        const selected = rangeColor(block, selection.range);
        const blockColor = gate(block.color, themeColor);
        return {
          label: "Selected words",
          value: selected ? gate(selected, blockColor) : blockColor,
          inherit: {
            label: "the block's color",
            value: blockColor,
            active: selected === null,
          },
        };
      }
      return {
        label: "Text color",
        value: gate(block.color, themeColor),
        inherit: {
          label: "Theme color",
          value: themeColor,
          active: block.color === undefined,
        },
      };
    }

    // The only ref that resolves against either scope. With a blockKey it
    // edits that tile's override; without one, the theme itself.
    case "price-tag": {
      if (!ref.blockKey) return priceTagColorField(theme, undefined, ref.part);
      const block = find(blocks, ref.blockKey);
      if (block?.type !== "product") return null;
      // `?? {}` not `block.style`: a tile with no overrides yet is still the
      // TILE scope, and passing undefined would read it as the theme.
      return priceTagColorField(theme, block.style ?? {}, ref.part);
    }
  }
}

/**
 * A ref's identity as a string: everything that makes it a DIFFERENT field.
 * The panel remounts on it, so its working HSV starts from the color actually
 * being edited. `kind` alone is not enough — the price tag's three colors
 * share a kind, and two of them can share a block.
 */
export function colorTargetKey(ref: ColorTargetRef): string {
  const part = "part" in ref ? ref.part : "";
  return `${ref.kind}:${part}:${colorTargetBlockKey(ref) ?? ""}`;
}

/** The block a ref points at, or null for the theme-level kinds. Lets the
 *  designer keep the canvas selection and the panel target in step. */
export function colorTargetBlockKey(ref: ColorTargetRef): string | null {
  // `?? null` rather than a bare `in` check: the price tag ref carries an
  // OPTIONAL blockKey, so the key can be present and hold undefined.
  return "blockKey" in ref ? (ref.blockKey ?? null) : null;
}

/**
 * The color a freshly selected block should open the panel on. Shapes lead with
 * their fill and text blocks with their color; product tiles hold no color of
 * their own (they follow the theme), so selecting one opens nothing.
 */
export function primaryColorTarget(block: StorefrontBlock): ColorTargetRef | null {
  switch (block.type) {
    case "shape":
      return { kind: "shape-fill", blockKey: blockKey(block) };
    case "text":
      return { kind: "text-color", blockKey: blockKey(block) };
    case "product":
    // An uploaded element carries no color of its own — its appearance is the
    // artwork. Selecting one opens the inspector but no color panel.
    case "image":
      return null;
  }
}
