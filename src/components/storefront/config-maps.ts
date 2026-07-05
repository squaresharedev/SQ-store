import type {
  CardShape,
  Density,
  StorefrontFont,
  StorefrontRadius,
  TextAlign,
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
