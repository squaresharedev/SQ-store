import type {
  BlockSize,
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
};

export const RADIUS_CLASSES: Record<StorefrontRadius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
};

/** Spans on the fixed 4-column bento grid (2 columns under `sm`). */
export const SIZE_CLASSES: Record<BlockSize, string> = {
  "1x1": "col-span-1 row-span-1",
  "2x1": "col-span-2 row-span-1",
  "2x2": "col-span-2 row-span-2",
};

export const SIZE_LABELS: Record<BlockSize, string> = {
  "1x1": "Small square",
  "2x1": "Wide",
  "2x2": "Large square",
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
