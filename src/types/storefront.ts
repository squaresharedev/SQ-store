// The Storefront feature contract: the seller's bento grid + theme, stored as
// jsonb in `storefronts.config` and validated by lib/validation/storefront.ts
// (the single source of truth) on every write. The future buyer-facing embed
// renders this exact shape — keep it renderable as typed React data only (no
// HTML, no URLs, no free-form CSS anywhere in it). The one non-visual member
// is `embed` (widget settings; hostname-regex-gated) — the public embed
// serializer must STRIP it and must drop blocks hidden by
// `theme.hideSoldOut` before anything leaves the owner's session.
//
// Type aliases (not interfaces) on purpose: aliases get TypeScript's implicit
// index signature, so the config assigns cleanly to Supabase's `Json`.

import {
  DEFAULT_IMAGE_PLACEMENT,
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  type ImagePlacement,
} from "@/lib/images/placement";

export type { ImagePlacement };
export { DEFAULT_IMAGE_PLACEMENT, IMAGE_SCALE_MIN, IMAGE_SCALE_MAX };

/**
 * The typeface allowlist. Every member resolves through a fixed class map
 * (components/storefront/config-maps) except `custom`, which resolves to the
 * seller's own uploaded face (see {@link StorefrontCustomFont}). A config that
 * says `custom` without an upload simply inherits, exactly like a block with no
 * font override, so removing an upload can never leave text unrenderable.
 */
export const STOREFRONT_FONTS = [
  "sans",
  "serif",
  "mono",
  "display",
  "hand",
  "inter",
  "montserrat",
  "custom",
] as const;
export type StorefrontFont = (typeof STOREFRONT_FONTS)[number];

/** Label cap for an uploaded font (the file's name, shown in the editor). */
export const CUSTOM_FONT_NAME_MAX = 60;

/**
 * A seller-uploaded typeface. ONE per storefront, and stored exactly like the
 * image background: the R2 object KEY only (never a URL, never CSS), with the
 * display URL signed server-side at render time. `name` is plain text used as
 * the option's label in the editor and nowhere else.
 */
export type StorefrontCustomFont = {
  /** R2 object key (`fonts/{uploaderId}/{uuid}-{name}`), never a URL. */
  key: string;
  name: string;
};

/** Corner roundness of grid cells and product tiles, in px. CSS clamps a
 *  radius at half the element's size, so the top of the range reads as a
 *  circle on square tiles (and a pill on wide ones). Replaces the legacy
 *  `radius` enum + `cardShape` pair; the schema migrates both on parse. */
export const CORNER_RADIUS_MAX = 100;

/** At or past this roundness the tile corners are clipped away, so corner
 *  price tag spots coerce onto the center vertical axis. */
export const PRICE_TAG_CORNER_LIMIT = 32;

// CANVAS MODEL. Blocks are placed FREELY: each one stores its own cell
// coordinates (x, y) and span (w, h) on a board of `theme.columns` by
// `theme.rows` cells. There is no auto-flow and no `order` — the gaps between
// blocks are deliberate whitespace, and reading order is derived from the
// coordinates (see readingOrder) whenever a linear sequence is needed.
//
// Placements are always non-overlapping and inside the canvas; the schema and
// the server re-check both on every save.

export const CANVAS_COLUMNS_MIN = 3;
export const CANVAS_COLUMNS_MAX = 12;
export const CANVAS_ROWS_MIN = 2;
// Generous headroom: a board this tall is only reachable by scrolling, but the
// cap has to clear whatever the tallest legacy auto-flow layout packs into.
export const CANVAS_ROWS_MAX = 60;

/** Where a block sits on the canvas and how many cells it covers. */
export type BlockPlacement = { x: number; y: number; w: number; h: number };

/**
 * The storefront canvas background — a closed set of safe shapes: a solid hex,
 * a custom two-stop gradient (hex + hex + angle), or an uploaded image.
 * Everything resolves through code-defined CSS (resolveBackgroundStyle); no
 * raw CSS/gradient string is ever stored or rendered. The image variant
 * stores only the R2 object KEY (validated shape, never a URL) plus
 * position/zoom; URLs are signed server-side at render time. Legacy configs
 * stored a `pattern` kind; the schema migrates it to its base color on parse.
 */
export type StorefrontBackground =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | ({
      kind: "image";
      /** R2 object key (`images/{uploaderId}/{uuid}-{name}`), never a URL. */
      key: string;
      /** Focal point + zoom, the shared image-placement model. The stored JSON
       *  is unchanged: x, y and scale still sit inline on the background. */
    } & ImagePlacement);

/**
 * Position/zoom defaults for a freshly uploaded background image.
 *
 * Aliases of the shared image-placement model (lib/images/placement.ts), which
 * the background and product tiles now both speak. Kept under these names
 * because they read better at the background's own call sites, and because
 * every existing importer keeps working.
 */
export const DEFAULT_BACKGROUND_IMAGE_PLACEMENT = DEFAULT_IMAGE_PLACEMENT;
export const BACKGROUND_IMAGE_SCALE_MIN = IMAGE_SCALE_MIN;
export const BACKGROUND_IMAGE_SCALE_MAX = IMAGE_SCALE_MAX;

/** How the title area renders on a product tile: a solid bar under the image,
 *  a translucent bar over the image bottom, or text over a bottom gradient
 *  shadow on the image itself. A "below" price tag shares this area. Legacy
 *  configs stored cardStyle (standard/overlay/minimal); the schema migrates
 *  it to titleStyle + titleDisplay on parse. */
export const TITLE_STYLES = ["bar", "overlay", "shadow"] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];

/** Title-area visibility: always visible, or hidden until the tile is
 *  hovered/focused. On reveal the overlay bar slides up from the bottom
 *  edge; the other styles fade in. */
export const TITLE_DISPLAYS = ["always", "hover"] as const;
export type TitleDisplay = (typeof TITLE_DISPLAYS)[number];

/** Price tag visibility: always visible, or hidden until the tile is
 *  hovered/focused. Legacy configs stored a third value "never"; the schema
 *  migrates it to priceTagPosition "hidden" on parse. */
export const PRICE_DISPLAYS = ["always", "hover"] as const;
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number];


/** Floating price tag spots over the image: the 4 corners plus the center
 *  vertical axis (top, middle, bottom). Circle tiles clip their corners
 *  entirely, so on circles only the vertical axis is offered/rendered. */
export const PRICE_TAG_FLOAT_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type PriceTagFloatPosition =
  (typeof PRICE_TAG_FLOAT_POSITIONS)[number];

/** Where the price tag sits on a product tile: in the info bar (`below`), at
 *  one of the floating spots, or `hidden` (the ONE way to hide the price).
 *  Legacy configs stored `onImage`/`corner`; the schema migrates them to
 *  `bottom-left`/`top-right` on parse. */
export const PRICE_TAG_POSITIONS = [
  "below",
  ...PRICE_TAG_FLOAT_POSITIONS,
  "hidden",
] as const;
export type PriceTagPosition = (typeof PRICE_TAG_POSITIONS)[number];

/**
 * Corner spots do not exist on heavily rounded tiles (the clip removes them),
 * so past PRICE_TAG_CORNER_LIMIT corners fall back to the same row's center
 * spot. Storage keeps the seller's corner choice; only rendering and the
 * picker coerce, so easing the roundness back restores the original corner.
 */
export function coercePriceTagPosition(
  position: PriceTagPosition,
  cornerRadius: number,
): PriceTagPosition {
  if (cornerRadius < PRICE_TAG_CORNER_LIMIT) return position;
  switch (position) {
    case "top-left":
    case "top-right":
      return "top-center";
    case "bottom-left":
    case "bottom-right":
      return "bottom-center";
    default:
      return position;
  }
}

/**
 * Where the tag ACTUALLY renders. Two structural facts can take a spot away.
 * One is roundness (above). The other is the title area: `overlay` and
 * `shadow` put the product name at the bottom of the IMAGE box, which is the
 * same box a floated tag sits in, so a bottom spot would stack the price on
 * the name. Bottom flips to the matching top spot instead.
 *
 * Both rules are structural — they read the config the renderer already holds,
 * never a measured size — so the picker can call this too and highlight the
 * spot that will really be used. Storage keeps the seller's choice: turning
 * the overlay title off puts the tag back where they put it.
 *
 * Two overlaps are deliberately NOT coerced here. A `top-left` tag can meet
 * the sold-out badge, but that depends on `block.soldOut` rather than on
 * config, and moving the price when a tile sells out would shift the layout
 * under the buyer. And `middle-center` can sit within a tall `shadow`
 * gradient, which is a contrast question that gradient exists to answer.
 */
export function resolvePriceTagPosition(
  position: PriceTagPosition,
  opts: { cornerRadius: number; titleOverlaysImage: boolean },
): PriceTagPosition {
  let lifted = position;
  if (opts.titleOverlaysImage) {
    switch (position) {
      case "bottom-left":
        lifted = "top-left";
        break;
      case "bottom-center":
        lifted = "top-center";
        break;
      case "bottom-right":
        lifted = "top-right";
        break;
    }
  }
  return coercePriceTagPosition(lifted, opts.cornerRadius);
}

/** Whether the title area is drawn OVER the image rather than under it. The
 *  one thing the collision rule above needs to know about the title. */
export function titleOverlaysImage(titleStyle: TitleStyle): boolean {
  return titleStyle === "overlay" || titleStyle === "shadow";
}

/** The three faces a price tag may take. Deliberately its own list rather
 *  than a slice of STOREFRONT_FONTS: a chip is read at 10px, where display
 *  and handwritten faces stop being legible. */
export const PRICE_TAG_FONTS = ["inter", "serif", "mono"] as const;
export type PriceTagFont = (typeof PRICE_TAG_FONTS)[number];

/** Price tag type size in px. The chip's padding is derived from it (see
 *  priceTagChipStyle), so this one number scales the whole tag. */
export const PRICE_TAG_SIZE_MIN = 8;
export const PRICE_TAG_SIZE_MAX = 32;
export const PRICE_TAG_SIZE_DEFAULT = 12;

/** Outline thickness in px; 0 (the default) draws no border at all. */
export const PRICE_TAG_BORDER_WIDTH_MAX = 8;

/** Chip corner roundness in px. The top of the range is past half the height
 *  of even a 32px tag, so CSS clamps it into a pill — which is what the
 *  retired `pill` style preset was. */
export const PRICE_TAG_RADIUS_MAX = 24;
export const PRICE_TAG_RADIUS_DEFAULT = 2;

/** What the chip paints with no color of its own. Real hex rather than a CSS
 *  token, so the renderer, the picker's inherit dot and anything reading the
 *  config all see the same value. Mirrors --card / --border. */
export const PRICE_TAG_DEFAULT_FILL = "#ffffff";
export const PRICE_TAG_DEFAULT_BORDER = "#e5e5e5";

/**
 * The chip's fill when the seller has set none, which depends on where the tag
 * sits — the one property of the price tag that is not a single value.
 *
 * A tag floated over a photo needs a backing or the price is unreadable on a
 * light image. A tag in the info bar already sits on the bar's own surface, and
 * a second box around it would be chrome for nothing. Exported so the renderer
 * and the picker's "Auto" dot resolve it identically.
 */
export function defaultPriceTagFill(position: PriceTagPosition): string {
  return position === "below" ? "transparent" : PRICE_TAG_DEFAULT_FILL;
}

/** What the price paints on a `shadow` title area with no color of its own:
 *  the gradient is dark by construction, so the accent would sink into it. */
export const PRICE_TAG_SHADOW_TEXT = "#ffffff";

/** How the storefront lays out blocks: the bento grid, or a horizontal
 *  scroll-snap carousel (rendered by CarouselStrip in designer + previews). */
export const DISPLAY_MODES = ["grid", "carousel"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** Grid gutter cap, in px. The value drives the shared --grid-gap token that
 *  .ss-grid's gap AND square-cell row math consume. Legacy configs stored a
 *  density enum (compact/comfy/spacious); the schema migrates it on parse. */
export const GRID_GAP_MAX = 32;

/** Store header text caps — plain text only, rendered as React text nodes. */
export const HEADER_NAME_MAX = 60;
export const HEADER_BIO_MAX = 160;

/** The two lines of the masthead, each independently styleable. */
export const HEADER_LINES = ["name", "bio"] as const;
export type HeaderLine = (typeof HEADER_LINES)[number];

/** What each line renders at with no size of its own, matching the classes the
 *  masthead uses (text-xl/sm:text-2xl for the name, text-sm for the bio).
 *  Shared with the size control so "Auto" can say what it means. */
export const HEADER_BASE_PX: Record<HeaderLine, number> = { name: 24, bio: 14 };

/**
 * Optional storefront masthead above the grid: a display name + short bio.
 *
 * Both are plain text (same control-character rules as text blocks), and each
 * line carries the SAME optional styling a text block does — colour, size,
 * bold/italic/underline, alignment and typeface. Every one of them is absent
 * by default, which means "follow the storefront": the name takes the theme
 * accent, the bio the surrounding ink, and both the canvas font (see
 * lib/theme/color-target).
 *
 * Flat `name*` / `bio*` keys rather than a nested per-line object, because
 * that is the shape already stored: nesting them would mean migrating every
 * saved masthead to buy nothing but a tidier type. {@link setHeaderStyle} is
 * the one writer, so the flatness never leaks into call sites.
 */
export type StorefrontHeader = {
  show: boolean;
  name: string;
  bio: string;
  /** Strict #rrggbb override for the store name. Absent = the theme accent. */
  nameColor?: string;
  /** Strict #rrggbb override for the bio. Absent = the default ink. */
  bioColor?: string;
  /** Size override in px, TEXT_SIZE_MIN..TEXT_SIZE_MAX. Absent = HEADER_BASE_PX. */
  nameSize?: number;
  bioSize?: number;
  /** Formatting toggles. Applied as tokenized classes, never markup. */
  nameBold?: boolean;
  bioBold?: boolean;
  nameItalic?: boolean;
  bioItalic?: boolean;
  nameUnderline?: boolean;
  bioUnderline?: boolean;
  /** Per-line alignment. Absent = left, as the masthead has always rendered. */
  nameAlign?: TextAlign;
  bioAlign?: TextAlign;
  /** Per-line typeface from the same allowlist as the theme font. Absent =
   *  inherit the canvas font. */
  nameFont?: StorefrontFont;
  bioFont?: StorefrontFont;
};

/** The masthead a NEW storefront starts with: shown, and carrying text the
 *  seller edits rather than an empty bar they have to discover and switch on.
 *  Not the same thing as {@link EMPTY_STOREFRONT_HEADER} — see there. */
export const DEFAULT_STOREFRONT_HEADER: StorefrontHeader = {
  show: true,
  name: "Your store name",
  bio: "A short line about your shop",
};

/** Where each line's optional style lives on the header. */
const HEADER_STYLE_KEYS = {
  name: {
    color: "nameColor",
    size: "nameSize",
    bold: "nameBold",
    italic: "nameItalic",
    underline: "nameUnderline",
    align: "nameAlign",
    font: "nameFont",
  },
  bio: {
    color: "bioColor",
    size: "bioSize",
    bold: "bioBold",
    italic: "bioItalic",
    underline: "bioUnderline",
    align: "bioAlign",
    font: "bioFont",
  },
} as const;

/** The styling a masthead line can carry, named once so the writer, the panel
 *  and the schema cannot drift apart. */
export type HeaderStyleField = keyof (typeof HEADER_STYLE_KEYS)["name"];

/** The value each field takes, so a typo is a compile error rather than a
 *  silently-stored nonsense key. */
export type HeaderStyleValue = {
  color: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  font: StorefrontFont;
};

/**
 * Set or clear one masthead line's styling.
 *
 * `undefined` DROPS the key rather than storing it, so a masthead nobody
 * styled stays byte-identical to one saved before these fields existed — the
 * same rule mergeCardStyleOverrides applies to a product tile, and the reason
 * "follow the theme" is a state rather than a particular value.
 */
export function setHeaderStyle<F extends HeaderStyleField>(
  header: StorefrontHeader,
  line: HeaderLine,
  field: F,
  value: HeaderStyleValue[F] | undefined,
): StorefrontHeader {
  const key = HEADER_STYLE_KEYS[line][field];
  const next = { ...header, [key]: value } as StorefrontHeader;
  if (value === undefined) delete next[key];
  return next;
}

/** Read one masthead line's styling. The mirror of setHeaderStyle, so nothing
 *  else has to know which flat key a line/field pair lives under. */
export function headerStyleValue<F extends HeaderStyleField>(
  header: StorefrontHeader,
  line: HeaderLine,
  field: F,
): HeaderStyleValue[F] | undefined {
  return header[HEADER_STYLE_KEYS[line][field]] as
    | HeaderStyleValue[F]
    | undefined;
}

/**
 * What a config that has NO header member falls back to.
 *
 * Deliberately hidden and blank, and deliberately NOT the default above: those
 * configs predate the header feature, and a seller who never had a masthead
 * must not find placeholder text appearing over their storefront because the
 * default for NEW storefronts changed.
 */
export const EMPTY_STOREFRONT_HEADER: StorefrontHeader = {
  show: false,
  name: "",
  bio: "",
};

/** Embed-widget cap on origin allowlist size. */
export const EMBED_MAX_DOMAINS = 10;

/**
 * Non-visual embed-widget settings, stored inside the config jsonb (the table
 * has no dedicated columns). `domains` is an origin allowlist of bare
 * hostnames — each one hostname-regex-gated by the schema, only ever compared
 * against request origins or rendered as a text node, never used in markup.
 */
export type EmbedSettings = {
  enabled: boolean;
  domains: string[];
};

export const DEFAULT_EMBED_SETTINGS: EmbedSettings = {
  enabled: false,
  domains: [],
};

/**
 * Decorative shape blocks — a fixed allowlist of kinds, each mapping to
 * code-defined markup in ShapeTileContent. A legacy `spacer` kind existed
 * (invisible layout whitespace); the schema drops those blocks on parse.
 */
export const SHAPE_KINDS = [
  "square",
  "circle",
  "ring",
  "diamond",
  "rounded",
  "pill",
  "half",
  "quarter",
  "bar",
  "triangle",
  "wedge",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "sparkle",
  "cross",
  "arrow",
  "chevron",
  "trapezoid",
  "parallelogram",
  "burst",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const TEXT_VARIANTS = ["heading", "subheading", "body"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

/**
 * Optional per-block size override, in PIXELS. Absent = the variant's own
 * scale (TEXT_VARIANT_CLASSES), which is what a fresh block uses.
 *
 * Replaces the five-preset enum (sm/md/lg/xl/2xl): sellers kept landing between
 * two presets. The schema migrates the old values to their rendered px on
 * parse, so a storefront saved before this looks identical after it. Bounded
 * ints only, because the value goes straight into a style attribute.
 */
export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 200;

/**
 * What each variant renders at when a block carries NO size override: the
 * number the editor shows beside "Auto", and where the slider starts when a
 * seller first takes control of the size.
 *
 * Mirrors TEXT_VARIANT_CLASSES: heading is text-xl/sm:text-2xl (24 at the
 * width the canvas designs at), subheading text-base, body text-sm.
 */
export const TEXT_VARIANT_BASE_PX: Record<TextVariant, number> = {
  heading: 24,
  subheading: 16,
  body: 14,
};

/** Clamp any size into the allowed range (bounded int). */
export function clampTextSize(px: number): number {
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(px)));
}

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Text content cap — plain text only, always rendered as a React text node. */
export const TEXT_MAX_LENGTH = 300;

/** Formatting a run of characters may override. Every field absent means the
 *  characters simply follow their block. */
export type TextStyle = {
  /** Strict #rrggbb. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

/**
 * A run of characters inside a text block that overrides the block's own
 * formatting: half-open `[start, end)` in plain-text character offsets. This
 * is how two colours live in one sentence.
 *
 * Still NOT markup — the text stays a plain string, and each run renders as a
 * React text node inside a styled <span>. See lib/storefront/text-spans.
 */
export type TextSpan = TextStyle & {
  start: number;
  end: number;
};

/** Cap on stored spans. 300 characters can hold at most 150 alternating runs,
 *  so this bounds the payload without ever rejecting a real design. */
export const TEXT_SPANS_MAX = 150;

export type StorefrontTheme = {
  /** Solid / gradient / pattern — see StorefrontBackground. */
  background: StorefrontBackground;
  /** Strict #rrggbb only. */
  accent: string;
  font: StorefrontFont;
  /** The seller's uploaded typeface, when they have one. Present whether or
   *  not `font` is "custom", so switching back and forth doesn't re-upload. */
  customFont?: StorefrontCustomFont;
  /** Canvas size in blocks. Blocks are placed freely inside it. */
  columns: number;
  rows: number;
  /** 0 = sharp .. CORNER_RADIUS_MAX = circle/pill, in px (CSS clamps). */
  cornerRadius: number;
  titleStyle: TitleStyle;
  titleDisplay: TitleDisplay;
  priceDisplay: PriceDisplay;
  priceTagPosition: PriceTagPosition;
  /**
   * The price tag's own appearance. Every one is optional: absent means the
   * coded default (see PRICE_TAG_* constants), which is what lets a config
   * saved before any of these existed keep parsing untouched, and what makes
   * "follow the theme" a real state on a per-tile override.
   */
  priceTagFont?: PriceTagFont;
  /** Type size in px; the chip's padding scales with it. */
  priceTagSize?: number;
  /** Chip fill, strict #rrggbb. */
  priceTagColor?: string;
  /** Price text, strict #rrggbb. Absent follows the theme accent. */
  priceTagTextColor?: string;
  /** Outline color, strict #rrggbb. Only drawn when priceTagBorderWidth > 0. */
  priceTagBorderColor?: string;
  priceTagBorderWidth?: number;
  priceTagRadius?: number;
  showTitle: boolean;
  displayMode: DisplayMode;
  /** Grid gutter in px, 0..GRID_GAP_MAX (smaller = denser). */
  gridGap: number;
  /** Show a badge on blocks the seller marked sold out. */
  soldOutBadge: boolean;
  /** Hide sold-out blocks from buyers (the designer still shows them dimmed). */
  hideSoldOut: boolean;
};

/**
 * The card-appearance slice of the theme: everything that shapes ONE product
 * tile, as opposed to the canvas around it. A ProductBlock may override any
 * subset of these fields (block.style); resolveCardStyle merges theme and
 * overrides so every renderer works from a single resolved shape and can
 * never read half theme, half override. Accent and the sold-out badge stay
 * theme-only on purpose: they are storefront identity, not tile shape.
 */
export type CardStyle = {
  cornerRadius: number;
  showTitle: boolean;
  titleStyle: TitleStyle;
  titleDisplay: TitleDisplay;
  priceDisplay: PriceDisplay;
  priceTagPosition: PriceTagPosition;
  priceTagFont: PriceTagFont;
  priceTagSize: number;
  priceTagBorderWidth: number;
  priceTagRadius: number;
  /**
   * The three colors stay OPTIONAL even here, where everything else resolves
   * to a value: "absent" is a state the seller can choose (follow the card,
   * follow the accent), and the picker's inherit dot has to be able to show
   * it. Renderers read them through priceTagChipStyle, which applies the
   * defaults in one place.
   */
  priceTagColor?: string;
  priceTagTextColor?: string;
  priceTagBorderColor?: string;
};

/** Per-block card styling: an absent field means "follow the theme", so a
 *  block only ever stores the fields the seller actually changed. */
export type CardStyleOverrides = Partial<CardStyle>;

/** The theme's card defaults with a block's overrides laid on top. Field by
 *  field (not a spread) so an explicit `undefined` in editor state can never
 *  shadow a theme value. */
export function resolveCardStyle(
  theme: StorefrontTheme,
  overrides?: CardStyleOverrides,
): CardStyle {
  return {
    cornerRadius: overrides?.cornerRadius ?? theme.cornerRadius,
    showTitle: overrides?.showTitle ?? theme.showTitle,
    titleStyle: overrides?.titleStyle ?? theme.titleStyle,
    titleDisplay: overrides?.titleDisplay ?? theme.titleDisplay,
    priceDisplay: overrides?.priceDisplay ?? theme.priceDisplay,
    priceTagPosition: overrides?.priceTagPosition ?? theme.priceTagPosition,
    priceTagFont: overrides?.priceTagFont ?? theme.priceTagFont ?? "inter",
    priceTagSize:
      overrides?.priceTagSize ?? theme.priceTagSize ?? PRICE_TAG_SIZE_DEFAULT,
    priceTagBorderWidth:
      overrides?.priceTagBorderWidth ?? theme.priceTagBorderWidth ?? 0,
    priceTagRadius:
      overrides?.priceTagRadius ?? theme.priceTagRadius ?? PRICE_TAG_RADIUS_DEFAULT,
    priceTagColor: overrides?.priceTagColor ?? theme.priceTagColor,
    priceTagTextColor: overrides?.priceTagTextColor ?? theme.priceTagTextColor,
    priceTagBorderColor:
      overrides?.priceTagBorderColor ?? theme.priceTagBorderColor,
  };
}

/**
 * Merge a patch into a block's stored overrides. A patch field set to
 * `undefined` clears that single override (the field goes back to following
 * the theme); an override object that ends up empty becomes `undefined`, so
 * a fully-reverted tile is indistinguishable from one never customized.
 */
export function mergeCardStyleOverrides(
  current: CardStyleOverrides | undefined,
  patch: CardStyleOverrides,
): CardStyleOverrides | undefined {
  const merged: CardStyleOverrides = { ...current, ...patch };
  for (const key of Object.keys(merged) as (keyof CardStyleOverrides)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Effective corner roundness for ANY block: product blocks may override the
 *  theme's radius, the other kinds always follow it (shapes pick their form
 *  via `kind`; text tiles have no visible box to round). */
export function blockCornerRadius(
  theme: StorefrontTheme,
  block: StorefrontBlock,
): number {
  return block.type === "product"
    ? (block.style?.cornerRadius ?? theme.cornerRadius)
    : theme.cornerRadius;
}

export type ProductBlock = BlockPlacement & {
  type: "product";
  /** References the seller's own products; ownership re-checked on save. */
  productId: string;
  /** Seller-controlled sold-out mark (products have no inventory yet; real
   *  stock tracking can drive this same flag later). Optional so configs
   *  saved before the flag existed still parse. */
  soldOut?: boolean;
  /** Per-tile look, overriding the theme's card settings field by field.
   *  Optional (and dropped when emptied) so untouched tiles keep tracking
   *  the theme, exactly like blocks saved before this existed. */
  style?: CardStyleOverrides;
  /**
   * Where the product's photo sits inside this tile's frame, when the seller
   * has framed it. NOT a CardStyle override: card style is theme defaults with
   * per-tile exceptions, and "which part of THIS photo matters" has no
   * meaningful storefront-wide default to inherit from.
   *
   * Absent means centred at cover, which is how every tile rendered before
   * framing existed — and the field is dropped again whenever it returns to
   * that, so an unframed tile stays byte-identical to a legacy one.
   */
  imagePlacement?: ImagePlacement;
};

export type TextBlock = BlockPlacement & {
  type: "text";
  /** Client-minted uuid; only used to key the block. */
  id: string;
  /** Plain text. NEVER rendered as markup — React text node only. */
  text: string;
  variant: TextVariant;
  align: TextAlign;
  /** Inline formatting toggles. Applied as tokenized classes (never markup). */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Strict #rrggbb override. Absent = variant default (heading follows the
   *  theme accent, other variants the foreground). */
  color?: string;
  /** Character ranges that override the four fields above, so one part of the
   *  text can differ from the rest. Absent = the block is uniform. */
  spans?: TextSpan[];
  /** Size override in px, TEXT_SIZE_MIN..TEXT_SIZE_MAX; absent = the
   *  variant's default scale. */
  fontSize?: number;
  /** Per-block font family from the same allowlist as the theme font.
   *  Absent = inherit the canvas font. */
  font?: StorefrontFont;
};

/** Outline thickness cap for shape blocks, in px. */
export const SHAPE_BORDER_WIDTH_MAX = 24;

/** Ring thickness when the block carries no explicit borderWidth. */
export const RING_DEFAULT_WIDTH = 8;

/** Corner-roundness cap for shapes that support it, as a percent of the
 *  shape's smaller side (50 turns a square into a circle). */
export const SHAPE_ROUNDNESS_MAX = 50;

/** Point-count bounds for the star-family kinds (star, sparkle, burst). */
export const SHAPE_POINTS_MIN = 3;
export const SHAPE_POINTS_MAX = 12;

export type ShapeBlock = BlockPlacement & {
  type: "shape";
  /** Client-minted uuid; only used to key the block. */
  id: string;
  /** Allowlisted kind — resolves through ShapeTileContent's fixed map. */
  kind: ShapeKind;
  /** Strict #rrggbb only. The fill, or the stroke on a `ring`. */
  color: string;
  /**
   * Outline width in px, 0..SHAPE_BORDER_WIDTH_MAX. On a `ring` this is the
   * ring's own thickness (defaulting to RING_DEFAULT_WIDTH); on the filled
   * kinds it adds an outline around the shape. Optional so blocks saved
   * before shape styling existed still parse.
   */
  borderWidth?: number;
  /** Strict #rrggbb. Outline color on the filled kinds; unused by `ring`
   *  (its stroke is `color`). Optional for the same reason. */
  borderColor?: string;
  /** Whole-shape opacity as a percent, 0..100. Absent = fully opaque. */
  opacity?: number;
  /**
   * Corner roundness, 0..SHAPE_ROUNDNESS_MAX, for the kinds that support it
   * (polygons, star family, and the box kinds; see shape-geometry). Percent
   * of the shape's smaller side. Absent = the kind's default (`rounded` is
   * born rounded, everything else sharp). Optional so older blocks parse.
   */
  roundness?: number;
  /** Point count for the star-family kinds, SHAPE_POINTS_MIN..MAX. Absent =
   *  the kind's classic default (star 5, sparkle 4, burst 10). */
  points?: number;
};

/** How an uploaded element fills its block: cropped to fill, or shown whole. */
export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

/** Alt-text cap. Plain text, and it reaches the page only as an `alt`
 *  attribute — never as markup. */
export const IMAGE_ALT_MAX = 200;

/**
 * A seller's OWN artwork placed on the canvas: a logo, an icon, a graphic.
 *
 * Stored exactly like the image background and the custom font: the R2 object
 * KEY only, never a URL and never markup. Display URLs are signed server-side
 * at render time, and the picture reaches the page through a single
 * `<img src>` (see ImageTileContent) — which is what lets an element be an SVG
 * without giving this app an XSS sink. Uploads are gated by `sniffSvg` /
 * `sniffImage` and live under their own `elements/` prefix.
 */
export type ImageBlock = BlockPlacement & {
  type: "image";
  /** Client-minted uuid; only used to key the block. */
  id: string;
  /** R2 object key (`elements/{uploaderId}/{uuid}-{name}`), never a URL. */
  key: string;
  /** Plain text for screen readers. NEVER rendered as markup. */
  alt: string;
  /** Absent = "cover", which is how a fresh element lands. */
  fit?: ImageFit;
  /**
   * Where the picture sits inside the block when it is cropped to fill —
   * the same focal-point model product tiles use, so the one framer serves
   * both. Meaningless (and unused) under `contain`, where nothing is cropped.
   */
  imagePlacement?: ImagePlacement;
  /** Whole-block opacity as a percent, 0..100. Absent = fully opaque. */
  opacity?: number;
};

export type StorefrontBlock =
  | ProductBlock
  | TextBlock
  | ShapeBlock
  | ImageBlock;

/**
 * Reading order for anything that needs a LINE rather than a board: the
 * small-screen reflow, the carousel display mode, screen readers. Top-to-
 * bottom, then left-to-right, exactly how the eye crosses the canvas.
 */
export function readingOrder<T extends BlockPlacement>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The blocks a BUYER actually sees: everything except sold-out products the
 * seller chose to hide. The designer canvas deliberately does not use this (it
 * keeps showing hidden blocks dimmed, so they stay manageable); every read-only
 * rendering of a storefront should.
 *
 * Shared rather than filtered inline at each call site because "does this
 * storefront render as empty" has to mean the same thing everywhere. The
 * preview and the card's empty state disagreeing about it is precisely how a
 * card ends up blank with nothing explaining why.
 */
export function buyerVisibleBlocks(config: StorefrontConfig): StorefrontBlock[] {
  return config.blocks.filter(
    (block) =>
      !(config.theme.hideSoldOut && block.type === "product" && block.soldOut),
  );
}

/**
 * Do two placements cover any of the same cells? Deliberately mirrored in
 * components/grid/gridConstants: the schema (a server boundary) must not have
 * to import a client component module to enforce a core rule.
 */
export function placementsOverlap(a: BlockPlacement, b: BlockPlacement): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Stable identity for keys and lookups, across all block kinds. */
export function blockKey(block: StorefrontBlock): string {
  switch (block.type) {
    case "product":
      return `p_${block.productId}`;
    case "text":
      return `t_${block.id}`;
    case "shape":
      return `s_${block.id}`;
    case "image":
      return `i_${block.id}`;
  }
}

export type StorefrontConfig = {
  theme: StorefrontTheme;
  blocks: StorefrontBlock[];
  /** Optional so configs saved before the header feature still assign. */
  header?: StorefrontHeader;
  /** Optional for the same reason. NON-VISUAL — stripped from the public
   *  embed payload; edited only via updateEmbedSettings, never the designer. */
  embed?: EmbedSettings;
};

/** Starting point for sellers who have not saved a storefront yet. */
export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  theme: {
    background: { kind: "solid", color: "#ffffff" },
    accent: "#171717",
    font: "sans",
    // Defaults render identically to configs saved before these fields existed.
    columns: 6,
    rows: 6,
    cornerRadius: 0,
    titleStyle: "bar",
    titleDisplay: "always",
    priceDisplay: "always",
    priceTagPosition: "below",
    // The price tag's appearance fields are deliberately absent: every one
    // defaults through resolveCardStyle, so a fresh storefront and one saved
    // before they existed are the same config.
    showTitle: true,
    displayMode: "grid",
    gridGap: 8,
    soldOutBadge: true,
    hideSoldOut: false,
  },
  blocks: [],
  header: DEFAULT_STOREFRONT_HEADER,
  embed: DEFAULT_EMBED_SETTINGS,
};
