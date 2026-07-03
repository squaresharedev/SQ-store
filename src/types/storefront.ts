// The Storefront feature contract: the seller's bento grid + theme, stored as
// jsonb in `storefronts.config` and validated by lib/validation/storefront.ts
// (the single source of truth) on every write. The future buyer-facing embed
// renders this exact shape — keep it renderable as typed React data only (no
// HTML, no URLs, no free-form CSS anywhere in it).
//
// Type aliases (not interfaces) on purpose: aliases get TypeScript's implicit
// index signature, so the config assigns cleanly to Supabase's `Json`.

export const STOREFRONT_FONTS = ["sans", "serif", "mono"] as const;
export type StorefrontFont = (typeof STOREFRONT_FONTS)[number];

export const STOREFRONT_RADII = ["none", "sm", "md", "lg"] as const;
export type StorefrontRadius = (typeof STOREFRONT_RADII)[number];

export const BLOCK_SIZES = ["1x1", "2x1", "2x2"] as const;
export type BlockSize = (typeof BLOCK_SIZES)[number];

/**
 * Named background presets — a fixed allowlist. The config stores only the
 * KEY; each key maps to predefined safe style values in
 * components/storefront/background-presets.ts. User input never becomes a raw
 * CSS/gradient string.
 */
export const BACKGROUND_PRESETS = [
  "linen",
  "mist",
  "blush",
  "sage",
  "sky",
  "lilac",
  "sand",
  "ink",
] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];

export function isBackgroundPreset(value: string): value is BackgroundPreset {
  return (BACKGROUND_PRESETS as readonly string[]).includes(value);
}

/** How a product tile lays out its info: bar under the image, bar overlaid on
 *  the image, or image-only with info revealed on hover/focus. */
export const CARD_STYLES = ["standard", "overlay", "minimal"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

/** Price on product tiles: always visible, revealed on hover/focus, or hidden. */
export const PRICE_DISPLAYS = ["always", "hover", "never"] as const;
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number];

export const TEXT_VARIANTS = ["heading", "subheading", "body"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Text content cap — plain text only, always rendered as a React text node. */
export const TEXT_MAX_LENGTH = 300;

export type StorefrontTheme = {
  /** Strict #rrggbb hex OR a BackgroundPreset key — nothing else parses. */
  background: string;
  /** Strict #rrggbb only. */
  accent: string;
  font: StorefrontFont;
  radius: StorefrontRadius;
  cardStyle: CardStyle;
  priceDisplay: PriceDisplay;
};

export type ProductBlock = {
  type: "product";
  /** References the seller's own products; ownership re-checked on save. */
  productId: string;
  size: BlockSize;
  order: number;
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
};

export type StorefrontBlock = ProductBlock | TextBlock;

/** Stable identity for sortable keys and lookups, across both block kinds. */
export function blockKey(block: StorefrontBlock): string {
  return block.type === "product" ? `p_${block.productId}` : `t_${block.id}`;
}

export type StorefrontConfig = {
  theme: StorefrontTheme;
  blocks: StorefrontBlock[];
};

/** Starting point for sellers who have not saved a storefront yet. */
export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  theme: {
    background: "#ffffff",
    accent: "#171717",
    font: "sans",
    radius: "sm",
    cardStyle: "standard",
    priceDisplay: "always",
  },
  blocks: [],
};
