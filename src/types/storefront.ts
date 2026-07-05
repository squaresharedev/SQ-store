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

export const STOREFRONT_RADII = ["none", "sm", "md", "lg"] as const;
export type StorefrontRadius = (typeof STOREFRONT_RADII)[number];

// Every rectangle from 1×1 up to 3×3 (`<cols>x<rows>`) — small, wide, tall, and
// large squares — for shape variety. Must stay identical to the shared grid's
// GridSize (components/grid/gridConstants.ts) so the two interoperate.
export const BLOCK_SIZES = [
  "1x1", "2x1", "3x1",
  "1x2", "2x2", "3x2",
  "1x3", "2x3", "3x3",
] as const;
export type BlockSize = (typeof BLOCK_SIZES)[number];

/**
 * Named texture patterns — a fixed allowlist. The config stores only the KEY;
 * each maps to predefined safe CSS in components/storefront/background-presets.ts.
 * User input never becomes a raw CSS string.
 */
export const PATTERN_PRESETS = [
  "dots",
  "grid",
  "graph",
  "diagonal",
  "crosshatch",
  "checker",
] as const;
export type PatternPreset = (typeof PATTERN_PRESETS)[number];

/**
 * The storefront canvas background — a closed set of safe shapes: a solid hex,
 * a custom two-stop gradient (hex + hex + angle), or a pattern preset over a
 * base hex. Everything resolves through code-defined CSS (resolveBackgroundStyle);
 * no raw CSS/gradient string is ever stored or rendered.
 */
export type StorefrontBackground =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | { kind: "pattern"; preset: PatternPreset; color: string };

/** How a product tile lays out its info: bar under the image, bar overlaid on
 *  the image, or image-only with info revealed on hover/focus. */
export const CARD_STYLES = ["standard", "overlay", "minimal"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

/** Price on product tiles: always visible, revealed on hover/focus, or hidden. */
export const PRICE_DISPLAYS = ["always", "hover", "never"] as const;
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number];

/** Extra clip on PRODUCT tiles: force sharp, follow the theme radius, or a
 *  full circle (best on 1×1 blocks). Text blocks keep the theme radius. */
export const CARD_SHAPES = ["square", "rounded", "circle"] as const;
export type CardShape = (typeof CARD_SHAPES)[number];

/** Where the price tag sits on a product tile. `hidden` wins over
 *  `priceDisplay` (either can hide the price). */
export const PRICE_TAG_POSITIONS = [
  "below",
  "onImage",
  "corner",
  "hidden",
] as const;
export type PriceTagPosition = (typeof PRICE_TAG_POSITIONS)[number];

export const PRICE_TAG_STYLES = ["plain", "pill"] as const;
export type PriceTagStyle = (typeof PRICE_TAG_STYLES)[number];

/** How the storefront lays out blocks. `carousel` is UI + schema only for
 *  now — the designer previews it as a placeholder (TODO: real carousel). */
export const DISPLAY_MODES = ["grid", "carousel"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** Grid gutter density. Each key maps to a code-defined gap token override
 *  (config-maps.ts DENSITY_CLASSES) — never a raw length from user data. */
export const DENSITIES = ["compact", "comfy", "spacious"] as const;
export type Density = (typeof DENSITIES)[number];

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

export const TEXT_VARIANTS = ["heading", "subheading", "body"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

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
  radius: StorefrontRadius;
  cardStyle: CardStyle;
  priceDisplay: PriceDisplay;
  cardShape: CardShape;
  priceTagPosition: PriceTagPosition;
  priceTagStyle: PriceTagStyle;
  showTitle: boolean;
  displayMode: DisplayMode;
  density: Density;
  /** Show a badge on blocks the seller marked sold out. */
  soldOutBadge: boolean;
  /** Hide sold-out blocks from buyers (the designer still shows them dimmed). */
  hideSoldOut: boolean;
};

export type ProductBlock = {
  type: "product";
  /** References the seller's own products; ownership re-checked on save. */
  productId: string;
  size: BlockSize;
  order: number;
  /** Seller-controlled sold-out mark (products have no inventory yet; real
   *  stock tracking can drive this same flag later). Optional so configs
   *  saved before the flag existed still parse. */
  soldOut?: boolean;
};

export type TextBlock = {
  type: "text";
  /** Client-minted uuid; only used to key/reorder the block. */
  id: string;
  /** Plain text. NEVER rendered as markup — React text node only. */
  text: string;
  variant: TextVariant;
  align: TextAlign;
  size: BlockSize;
  order: number;
  /** Inline formatting toggles. Applied as tokenized classes (never markup). */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

export type StorefrontBlock = ProductBlock | TextBlock;

/** Stable identity for sortable keys and lookups, across both block kinds. */
export function blockKey(block: StorefrontBlock): string {
  return block.type === "product" ? `p_${block.productId}` : `t_${block.id}`;
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
    radius: "none",
    cardStyle: "standard",
    priceDisplay: "always",
    // Defaults render identically to configs saved before these fields existed.
    cardShape: "rounded",
    priceTagPosition: "below",
    priceTagStyle: "plain",
    showTitle: true,
    displayMode: "grid",
    density: "comfy",
    soldOutBadge: true,
    hideSoldOut: false,
  },
  blocks: [],
  header: DEFAULT_STOREFRONT_HEADER,
  embed: DEFAULT_EMBED_SETTINGS,
};
