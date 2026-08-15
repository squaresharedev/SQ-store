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

export const STOREFRONT_FONTS = [
  "sans",
  "serif",
  "mono",
  "display",
  "hand",
] as const;
export type StorefrontFont = (typeof STOREFRONT_FONTS)[number];

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
  | {
      kind: "image";
      /** R2 object key (`images/{uploaderId}/{uuid}-{name}`), never a URL. */
      key: string;
      /** background-position, integer percentages. */
      x: number;
      y: number;
      /** background-size width, integer percent of the canvas (100 = fit). */
      scale: number;
    };

/** Position/zoom defaults for a freshly uploaded background image. */
export const DEFAULT_BACKGROUND_IMAGE_PLACEMENT = {
  x: 50,
  y: 50,
  scale: 100,
} as const;

export const BACKGROUND_IMAGE_SCALE_MIN = 100;
export const BACKGROUND_IMAGE_SCALE_MAX = 300;

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

/** Optional storefront masthead above the grid: a display name + short bio.
 *  Both are plain text (same control-character rules as text blocks). */
export type StorefrontHeader = {
  show: boolean;
  name: string;
  bio: string;
};

export const DEFAULT_STOREFRONT_HEADER: StorefrontHeader = {
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

/** Optional per-block size override. Absent = the variant's default scale. */
export const TEXT_SIZES = ["sm", "md", "lg", "xl", "2xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Text content cap — plain text only, always rendered as a React text node. */
export const TEXT_MAX_LENGTH = 300;

export type StorefrontTheme = {
  /** Solid / gradient / pattern — see StorefrontBackground. */
  background: StorefrontBackground;
  /** Strict #rrggbb only. */
  accent: string;
  font: StorefrontFont;
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
   * saved before any of these existed keep parsing untouched.
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

export type ProductBlock = BlockPlacement & {
  type: "product";
  /** References the seller's own products; ownership re-checked on save. */
  productId: string;
  /** Seller-controlled sold-out mark (products have no inventory yet; real
   *  stock tracking can drive this same flag later). Optional so configs
   *  saved before the flag existed still parse. */
  soldOut?: boolean;
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
  /** Size override; absent = the variant's default scale. */
  fontSize?: TextSize;
  /** Per-block font family from the same allowlist as the theme font.
   *  Absent = inherit the canvas font. */
  font?: StorefrontFont;
};

/** Outline thickness cap for shape blocks, in px. */
export const SHAPE_BORDER_WIDTH_MAX = 24;

/** Ring thickness when the block carries no explicit borderWidth. */
export const RING_DEFAULT_WIDTH = 8;

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
};

export type StorefrontBlock = ProductBlock | TextBlock | ShapeBlock;

/**
 * Reading order for anything that needs a LINE rather than a board: the
 * small-screen reflow, the carousel display mode, screen readers. Top-to-
 * bottom, then left-to-right, exactly how the eye crosses the canvas.
 */
export function readingOrder<T extends BlockPlacement>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
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
    // has a coded default, so a fresh storefront and one saved before they
    // existed are the same config.
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
