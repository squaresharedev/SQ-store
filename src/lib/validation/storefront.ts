import { z } from "zod";
import {
  BACKGROUND_IMAGE_SCALE_MAX,
  BACKGROUND_IMAGE_SCALE_MIN,
  BLOCK_SIZES,
  CORNER_RADIUS_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  DENSITIES,
  DISPLAY_MODES,
  EMBED_MAX_DOMAINS,
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  PRICE_DISPLAYS,
  PRICE_TAG_POSITIONS,
  PRICE_TAG_STYLES,
  SHAPE_KINDS,
  STOREFRONT_FONTS,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_VARIANTS,
  TITLE_DISPLAYS,
  TITLE_STYLES,
  blockKey,
  type StorefrontBackground,
  type StorefrontConfig,
} from "@/types/storefront";
import { OBJECT_KEY_PATTERN } from "@/lib/validation/product";
import { LEGACY_BACKGROUND_GRADIENTS } from "@/components/storefront/background-presets";

// The security contract for storefront configs. Parsed server-side on EVERY
// save (client checks are UX only). Hard rules: strict hex colors, enums only
// for font/size/radius, no field that can hold HTML/URLs/CSS. `strictObject`
// rejects unknown keys so nothing smuggles extra data into the jsonb.

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Gate every color before it goes anywhere near a style attribute. */
export function isStrictHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** A storefront's public id (also the future embed/attribution key). Guards
 *  URL params + action inputs so a garbage id 404s instead of erroring. */
export const storefrontIdSchema = z.uuid();

/** Display name shown in the storefront list. Mirrors the DB check
 *  (char_length 1..80); trimmed before validation by callers. */
export const STOREFRONT_NAME_MAX = 80;
export const storefrontNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Give your storefront a name." })
  .max(STOREFRONT_NAME_MAX, { error: "Storefront names are 80 characters or fewer." });

const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN, {
  error: "Colors must be 6-digit hex, like #a855f7.",
});

// Plain-text gates shared by every free-text config field (text blocks, the
// store header). Control characters are rejected; the multiline variant only
// re-admits newline. Text is ALWAYS rendered as React text nodes, never markup.
const TEXT_ERROR = { error: "Text contains unsupported characters." };
const MULTILINE_TEXT_PATTERN = /^(?:[^\u0000-\u001f\u007f]|\n)*$/;
const SINGLE_LINE_TEXT_PATTERN = /^[^\u0000-\u001f\u007f]*$/;

/** Sanity cap on grid size; the designer UI stays comfortably under it. */
export const MAX_BLOCKS = 60;

// Background is a closed, structured shape: a solid hex, a custom gradient
// (hex + hex + integer angle), or an uploaded image. The stored value is only
// ever code-defined styles fed by regex-gated colors / an allowlisted key,
// never a raw CSS/gradient string. The image variant stores an R2 object KEY
// (shape-checked here; ownership + size/type of NEW keys are re-checked in
// saveStorefront) plus position/zoom.
const backgroundSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("solid"), color: hexColorSchema }),
  z.strictObject({
    kind: z.literal("gradient"),
    from: hexColorSchema,
    to: hexColorSchema,
    angle: z.number().int().min(0).max(360),
  }),
  z.strictObject({
    kind: z.literal("image"),
    key: z
      .string()
      .max(600)
      .regex(OBJECT_KEY_PATTERN)
      .refine((key) => key.startsWith("images/"), {
        error: "Background images must be image uploads.",
      }),
    x: z.number().int().min(0).max(100),
    y: z.number().int().min(0).max(100),
    scale: z
      .number()
      .int()
      .min(BACKGROUND_IMAGE_SCALE_MIN)
      .max(BACKGROUND_IMAGE_SCALE_MAX),
  }),
]);

const themeObjectSchema = z.strictObject({
  background: backgroundSchema,
  accent: hexColorSchema,
  font: z.enum(STOREFRONT_FONTS),
  cornerRadius: z.number().int().min(0).max(CORNER_RADIUS_MAX),
  titleStyle: z.enum(TITLE_STYLES),
  titleDisplay: z.enum(TITLE_DISPLAYS),
  priceDisplay: z.enum(PRICE_DISPLAYS),
  // Legacy configs stored "onImage"/"corner" before the 7-spot picker existed;
  // map them to the equivalent explicit spots so old storefronts still parse.
  priceTagPosition: z.preprocess(
    (value) =>
      value === "onImage"
        ? "bottom-left"
        : value === "corner"
          ? "top-right"
          : value,
    z.enum(PRICE_TAG_POSITIONS),
  ),
  priceTagStyle: z.enum(PRICE_TAG_STYLES),
  showTitle: z.boolean(),
  displayMode: z.enum(DISPLAY_MODES),
  density: z.enum(DENSITIES),
  soldOutBadge: z.boolean(),
  hideSoldOut: z.boolean(),
});

/** Legacy `radius` enum -> px, matching the old rounded-sm/md/lg classes. */
const LEGACY_RADIUS_PX: Record<string, number> = { none: 0, sm: 4, md: 6, lg: 8 };

// Legacy-theme migrations, applied before the strict parse:
// - priceDisplay "never" predates the position picker's Hidden mode; fold it
//   into priceTagPosition "hidden" so hiding the price has ONE representation.
// - cardStyle (standard/overlay/minimal) conflated title placement with hover
//   visibility; split it into titleStyle + titleDisplay and drop the key
//   (strictObject would reject it).
// - radius (none/sm/md/lg) + cardShape (square/rounded/circle) merged into
//   the numeric cornerRadius: circle -> full, square -> sharp, rounded -> the
//   radius enum's px value.
// - pattern backgrounds were removed; they fall back to their base color.
const themeSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const theme = { ...(value as Record<string, unknown>) };
  const background = theme.background as
    | { kind?: unknown; color?: unknown }
    | null
    | undefined;
  if (
    typeof background === "object" &&
    background !== null &&
    background.kind === "pattern"
  ) {
    theme.background = {
      kind: "solid",
      color: typeof background.color === "string" ? background.color : "#ffffff",
    };
  }
  if (theme.priceDisplay === "never") {
    theme.priceDisplay = "always";
    theme.priceTagPosition = "hidden";
  }
  if ("cardStyle" in theme) {
    if (theme.titleStyle === undefined) {
      theme.titleStyle = theme.cardStyle === "standard" ? "bar" : "overlay";
      theme.titleDisplay = theme.cardStyle === "minimal" ? "hover" : "always";
    }
    delete theme.cardStyle;
  }
  if ("radius" in theme || "cardShape" in theme) {
    if (theme.cornerRadius === undefined) {
      theme.cornerRadius =
        theme.cardShape === "circle"
          ? CORNER_RADIUS_MAX
          : theme.cardShape === "square"
            ? 0
            : (LEGACY_RADIUS_PX[String(theme.radius)] ?? 0);
    }
    delete theme.radius;
    delete theme.cardShape;
  }
  return theme;
}, themeObjectSchema);

// The optional masthead above the grid: show toggle + capped plain text.
const headerSchema = z.strictObject({
  show: z.boolean(),
  name: z.string().max(HEADER_NAME_MAX).regex(SINGLE_LINE_TEXT_PATTERN, TEXT_ERROR),
  bio: z.string().max(HEADER_BIO_MAX).regex(MULTILINE_TEXT_PATTERN, TEXT_ERROR),
});

// Bare lowercase hostname, RFC-shaped: dot-separated alnum/hyphen labels
// (≤ 63 chars, no leading/trailing hyphen), alpha TLD, ≤ 253 chars total.
// No protocol, path, port, or wildcard — it is only ever compared against a
// request origin's hostname or rendered as a text node, never used in markup.
const HOSTNAME_PATTERN =
  /^(?=[a-z0-9.-]{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$/;

/** Embed-widget settings (non-visual member of the config jsonb). Shared by
 *  the updateEmbedSettings action (the boundary) and the modal (UX only). */
export const embedSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  domains: z
    .array(
      z.string().regex(HOSTNAME_PATTERN, {
        error: "Use bare lowercase domains like yoursite.com — no https:// or paths.",
      }),
    )
    .max(EMBED_MAX_DOMAINS, {
      error: `List up to ${EMBED_MAX_DOMAINS} domains.`,
    })
    .refine((domains) => new Set(domains).size === domains.length, {
      error: "Each domain can only be listed once.",
    }),
});

const sizeSchema = z.enum(BLOCK_SIZES);
const orderSchema = z.number().int().min(0).max(9999);

const productBlockSchema = z.strictObject({
  type: z.literal("product"),
  productId: z.uuid(),
  size: sizeSchema,
  order: orderSchema,
  // Seller-controlled sold-out mark — optional so older blocks still parse.
  soldOut: z.boolean().optional(),
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
    .regex(MULTILINE_TEXT_PATTERN, TEXT_ERROR),
  variant: z.enum(TEXT_VARIANTS),
  align: z.enum(TEXT_ALIGNS),
  size: sizeSchema,
  order: orderSchema,
  // Inline formatting — optional so v1 blocks (without them) still parse.
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});

// Decorative shape: allowlisted kind + regex-gated color, nothing free-form.
const shapeBlockSchema = z.strictObject({
  type: z.literal("shape"),
  id: z.uuid(),
  kind: z.enum(SHAPE_KINDS),
  color: hexColorSchema,
  size: sizeSchema,
  order: orderSchema,
});

const blockSchema = z.discriminatedUnion("type", [
  productBlockSchema,
  textBlockSchema,
  shapeBlockSchema,
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
  // Optional so configs saved before these features still parse directly.
  header: headerSchema.optional(),
  embed: embedSettingsSchema.optional(),
}) satisfies z.ZodType<StorefrontConfig>;

/**
 * Normalize a stored `theme.background` into the structured model. v1 stored a
 * bare string: a hex (→ solid) or a named preset key (→ its legacy gradient).
 * Anything already-structured passes through for the schema to validate.
 */
function upgradeBackground(value: unknown): StorefrontBackground {
  if (value !== null && typeof value === "object" && "kind" in value) {
    return value as StorefrontBackground;
  }
  if (typeof value === "string") {
    if (isStrictHexColor(value)) return { kind: "solid", color: value };
    const legacy = LEGACY_BACKGROUND_GRADIENTS[value];
    if (legacy) return { kind: "gradient", ...legacy };
  }
  return DEFAULT_STOREFRONT_CONFIG.theme.background;
}

/**
 * Parse a stored config, upgrading older saved shapes instead of discarding
 * them: v1 product blocks had no `type`, older themes lack newer fields (the
 * defaults fill them; themeSchema's preprocess migrates renamed ones), and v1
 * backgrounds were a bare string. Returns null when unrecognizable.
 */
export function parseStoredStorefrontConfig(
  raw: unknown,
): StorefrontConfig | null {
  const direct = storefrontConfigSchema.safeParse(raw);
  if (direct.success) return direct.data;

  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as {
    theme?: unknown;
    blocks?: unknown;
    header?: unknown;
    embed?: unknown;
  };
  const rawTheme =
    typeof candidate.theme === "object" && candidate.theme !== null
      ? (candidate.theme as Record<string, unknown>)
      : {};
  const upgraded = {
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      ...rawTheme,
      background: upgradeBackground(rawTheme.background),
    },
    blocks: Array.isArray(candidate.blocks)
      ? candidate.blocks.map((block: unknown) =>
          typeof block === "object" && block !== null && !("type" in block)
            ? { type: "product", ...block }
            : block,
        )
      : [],
    // Carry stored header/embed through the retry, but only when each
    // validates on its own — a malformed part degrades to "absent", never a
    // lost config.
    ...(headerSchema.safeParse(candidate.header).success
      ? { header: candidate.header }
      : {}),
    ...(embedSettingsSchema.safeParse(candidate.embed).success
      ? { embed: candidate.embed }
      : {}),
  };
  const retry = storefrontConfigSchema.safeParse(upgraded);
  return retry.success ? retry.data : null;
}
