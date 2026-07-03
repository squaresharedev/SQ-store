import { z } from "zod";
import {
  BLOCK_SIZES,
  CARD_STYLES,
  DEFAULT_STOREFRONT_CONFIG,
  PRICE_DISPLAYS,
  STOREFRONT_FONTS,
  STOREFRONT_RADII,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_VARIANTS,
  blockKey,
  type StorefrontConfig,
} from "@/types/storefront";

// The security contract for storefront configs. Parsed server-side on EVERY
// save (client checks are UX only). Hard rules: strict hex colors, enums only
// for font/size/radius, no field that can hold HTML/URLs/CSS. `strictObject`
// rejects unknown keys so nothing smuggles extra data into the jsonb.

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Gate every color before it goes anywhere near a style attribute. */
export function isStrictHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN, {
  error: "Colors must be 6-digit hex, like #a855f7.",
});

/** Sanity cap on grid size; the designer UI stays comfortably under it. */
export const MAX_BLOCKS = 60;

const themeSchema = z.strictObject({
  background: hexColorSchema,
  accent: hexColorSchema,
  font: z.enum(STOREFRONT_FONTS),
  radius: z.enum(STOREFRONT_RADII),
  cardStyle: z.enum(CARD_STYLES),
  priceDisplay: z.enum(PRICE_DISPLAYS),
});

const sizeSchema = z.enum(BLOCK_SIZES);
const orderSchema = z.number().int().min(0).max(9999);

const productBlockSchema = z.strictObject({
  type: z.literal("product"),
  productId: z.uuid(),
  size: sizeSchema,
  order: orderSchema,
});

// Plain text only. Rendered exclusively as a React text node (React escapes
// it); the schema still refuses control characters so stored data stays sane.
const textBlockSchema = z.strictObject({
  type: z.literal("text"),
  id: z.uuid(),
  text: z
    .string()
    .max(TEXT_MAX_LENGTH)
    // Control characters (other than newline) are rejected so stored text
    // stays sane; sellers can still write multi-line text.
    .regex(/^(?:[^\u0000-\u001f\u007f]|\n)*$/, {
      error: "Text contains unsupported characters.",
    }),
  variant: z.enum(TEXT_VARIANTS),
  align: z.enum(TEXT_ALIGNS),
  size: sizeSchema,
  order: orderSchema,
});

const blockSchema = z.discriminatedUnion("type", [
  productBlockSchema,
  textBlockSchema,
]);

export const storefrontConfigSchema = z.strictObject({
  theme: themeSchema,
  blocks: z
    .array(blockSchema)
    .max(MAX_BLOCKS)
    .refine(
      (blocks) => new Set(blocks.map(blockKey)).size === blocks.length,
      { error: "Grid blocks must be unique." },
    ),
}) satisfies z.ZodType<StorefrontConfig>;

/**
 * Parse a stored config, upgrading older saved shapes instead of discarding
 * them: v1 product blocks had no `type`, and v1 themes lack
 * cardStyle/priceDisplay. Returns null when the value is unrecognizable.
 */
export function parseStoredStorefrontConfig(
  raw: unknown,
): StorefrontConfig | null {
  const direct = storefrontConfigSchema.safeParse(raw);
  if (direct.success) return direct.data;

  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as { theme?: unknown; blocks?: unknown };
  const upgraded = {
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      ...(typeof candidate.theme === "object" && candidate.theme !== null
        ? candidate.theme
        : {}),
    },
    blocks: Array.isArray(candidate.blocks)
      ? candidate.blocks.map((block: unknown) =>
          typeof block === "object" && block !== null && !("type" in block)
            ? { type: "product", ...block }
            : block,
        )
      : [],
  };
  const retry = storefrontConfigSchema.safeParse(upgraded);
  return retry.success ? retry.data : null;
}
