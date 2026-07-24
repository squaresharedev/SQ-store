import type {
  CardShape,
  Density,
  PriceTagCorner,
  PriceTagSize,
  StorefrontFont,
  StorefrontRadius,
  TextAlign,
  TextSize,
  TextVariant,
} from "@/types/storefront";

// Enum -> class lookups for rendering a StorefrontConfig. Config enums never
// touch class strings directly — everything goes through these fixed maps, so
// user data can only ever select from tokenized values.

export const FONT_CLASSES: Record<StorefrontFont, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
  display: "font-display",
  hand: "font-hand",
};

export const RADIUS_CLASSES: Record<StorefrontRadius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
};

// Extra clip applied to PRODUCT tiles only — text tiles keep the theme radius.
// `rounded` intentionally inherits the cell's own clip (no override needed).
export const CARD_SHAPE_CLASSES: Record<CardShape, string> = {
  square: "rounded-none overflow-hidden",
  rounded: "",
  circle: "rounded-full overflow-hidden",
};

// Density → the --grid-gap override classes defined next to .ss-grid in
// globals.css. Set on the grid's ancestor; gap AND square-cell math follow.
export const DENSITY_CLASSES: Record<Density, string> = {
  compact: "ss-gap-compact",
  comfy: "ss-gap-comfy",
  spacious: "ss-gap-spacious",
};


export const TEXT_VARIANT_CLASSES: Record<TextVariant, string> = {
  heading: "text-xl font-semibold sm:text-2xl",
  subheading: "text-base font-medium",
  body: "text-sm",
};

// Split variant treatment for blocks with an explicit fontSize: the override
// replaces the variant's SIZE while the variant keeps supplying its weight.
export const TEXT_VARIANT_WEIGHT_CLASSES: Record<TextVariant, string> = {
  heading: "font-semibold",
  subheading: "font-medium",
  body: "font-normal",
};

export const TEXT_SIZE_CLASSES: Record<TextSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-3xl",
  "2xl": "text-4xl",
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "X-Large",
  "2xl": "Huge",
};

// Floated price tag placement + chip sizing. Style (plain/pill) contributes
// only shape + border; size contributes text + padding — combined in
// ProductTileContent so the two axes never fight over the same classes.
export const PRICE_TAG_CORNER_CLASSES: Record<PriceTagCorner, string> = {
  topLeft: "left-2 top-2",
  topRight: "right-2 top-2",
  bottomLeft: "bottom-2 left-2",
  bottomRight: "bottom-2 right-2",
};

export const PRICE_TAG_SIZE_CLASSES: Record<PriceTagSize, string> = {
  sm: "text-[0.625rem] px-1 py-px",
  md: "text-xs px-1.5 py-0.5",
  lg: "text-sm px-2 py-1",
};

export const TEXT_VARIANT_LABELS: Record<TextVariant, string> = {
  heading: "Heading",
  subheading: "Subheading",
  body: "Body text",
};

export const TEXT_ALIGN_CLASSES: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};
