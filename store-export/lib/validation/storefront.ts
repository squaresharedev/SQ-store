import { z } from "zod";
import {
  MULTILINE_TEXT_PATTERN,
  SINGLE_LINE_TEXT_PATTERN,
  TEXT_ERROR,
} from "@/lib/validation/text";
import {
  BACKGROUND_IMAGE_SCALE_MAX,
  BACKGROUND_IMAGE_SCALE_MIN,
  CANVAS_COLUMNS_MAX,
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  CORNER_RADIUS_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  DISPLAY_MODES,
  GRID_GAP_MAX,
  EMBED_MAX_DOMAINS,
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  PRICE_DISPLAYS,
  PRICE_TAG_POSITIONS,
  PRICE_TAG_SIZES,
  PRICE_TAG_STYLES,
  SHAPE_BORDER_WIDTH_MAX,
  SHAPE_KINDS,
  STOREFRONT_FONTS,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_SIZES,
  TEXT_VARIANTS,
  TITLE_DISPLAYS,
  TITLE_STYLES,
  blockKey,
  placementsOverlap,
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

// Plain-text gates live in lib/validation/text.ts so profile fields share
// the same rule — they previously did not. Text is ALWAYS rendered as
// React text nodes, never markup.

/** Sanity cap on grid size. Sized above the biggest canvas (12 x 24 cells)
 *  can sensibly hold, so it bounds the stored jsonb without ever being the
 *  thing a seller runs into. */
export const MAX_BLOCKS = 120;

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
  columns: z.number().int().min(CANVAS_COLUMNS_MIN).max(CANVAS_COLUMNS_MAX),
  rows: z.number().int().min(CANVAS_ROWS_MIN).max(CANVAS_ROWS_MAX),
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
  // Optional so configs saved before the size control still parse.
  priceTagSize: z.enum(PRICE_TAG_SIZES).optional(),
  showTitle: z.boolean(),
  displayMode: z.enum(DISPLAY_MODES),
  gridGap: z.number().int().min(0).max(GRID_GAP_MAX),
  soldOutBadge: z.boolean(),
  hideSoldOut: z.boolean(),
});

/** Legacy `radius` enum -> px, matching the old rounded-sm/md/lg classes. */
const LEGACY_RADIUS_PX: Record<string, number> = { none: 0, sm: 4, md: 6, lg: 8 };

/** Legacy `density` enum -> gap px, matching the old ss-gap-* classes. */
const LEGACY_DENSITY_PX: Record<string, number> = {
  compact: 4,
  comfy: 8,
  spacious: 16,
};

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
// - density (compact/comfy/spacious) became the numeric gridGap (gap px).
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
  // priceTagCorner was a short-lived 4-corner model, superseded by the 7-spot
  // priceTagPosition picker. Drop it so any config that carries one still
  // parses (strictObject would otherwise reject the unknown key).
  delete theme.priceTagCorner;
  if ("density" in theme) {
    if (theme.gridGap === undefined) {
      theme.gridGap = LEGACY_DENSITY_PX[String(theme.density)] ?? 8;
    }
    delete theme.density;
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

// Free placement: every block carries its own cell coordinates and span. The
// per-field caps here are absolute (canvas maximums); the config-level refine
// below enforces the tighter, per-storefront bounds and non-overlap.
const placementFields = {
  x: z.number().int().min(0).max(CANVAS_COLUMNS_MAX - 1),
  y: z.number().int().min(0).max(CANVAS_ROWS_MAX - 1),
  w: z.number().int().min(1).max(CANVAS_COLUMNS_MAX),
  h: z.number().int().min(1).max(CANVAS_ROWS_MAX),
};

const productBlockSchema = z.strictObject({
  type: z.literal("product"),
  productId: z.uuid(),
  ...placementFields,
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
  ...placementFields,
  // Inline formatting — optional so v1 blocks (without them) still parse.
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  // Per-block styling overrides — optional for the same reason. Color stays
  // regex-gated hex; size and font resolve through fixed class maps only.
  color: hexColorSchema.optional(),
  fontSize: z.enum(TEXT_SIZES).optional(),
  font: z.enum(STOREFRONT_FONTS).optional(),
});

// Decorative shape: allowlisted kind + regex-gated color, nothing free-form.
const shapeBlockSchema = z.strictObject({
  type: z.literal("shape"),
  id: z.uuid(),
  kind: z.enum(SHAPE_KINDS),
  color: hexColorSchema,
  ...placementFields,
  // Styling — optional so blocks saved before it existed still parse.
  borderWidth: z.number().int().min(0).max(SHAPE_BORDER_WIDTH_MAX).optional(),
  borderColor: hexColorSchema.optional(),
  opacity: z.number().int().min(0).max(100).optional(),
});

const blockSchema = z.discriminatedUnion("type", [
  productBlockSchema,
  textBlockSchema,
  shapeBlockSchema,
]);

const configObjectSchema = z
  .strictObject({
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
  })
  // The canvas invariants, checked here because they span theme + blocks:
  // every block sits inside the board, and no two cover the same cell. These
  // are REJECTED rather than repaired — silently moving a block would scramble
  // a layout the seller can see.
  .superRefine((config, ctx) => {
    const { columns, rows } = config.theme;
    config.blocks.forEach((block, index) => {
      if (block.x + block.w > columns || block.y + block.h > rows) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index],
          message: "A block sits outside the canvas.",
        });
      }
      for (let other = index + 1; other < config.blocks.length; other += 1) {
        if (placementsOverlap(block, config.blocks[other])) {
          ctx.addIssue({
            code: "custom",
            path: ["blocks", other],
            message: "Blocks cannot overlap.",
          });
          return;
        }
      }
    });
  });

/**
 * Convert a pre-free-placement config: blocks used to carry `order` + a
 * `"<cols>x<rows>"` size string and were positioned by CSS auto-flow. Running
 * that same first-fit packing ONCE reproduces the exact layout the seller last
 * saw, cell for cell, so the upgrade is invisible to them.
 */
function migrateLegacyBlocks(
  raw: unknown[],
  columns: number,
): { blocks: Record<string, unknown>[]; rows: number } {
  const occupied = new Set<string>();
  const taken = (x: number, y: number) => occupied.has(`${x},${y}`);
  const fits = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) if (taken(col, row)) return false;
    }
    return true;
  };

  // The auto-flow cursor: placement never searches backwards past it, which is
  // what CSS's sparse row flow does.
  let cursorRow = 0;
  let cursorCol = 0;
  let usedRows = 0;

  const ordered = [...raw]
    .filter((block): block is Record<string, unknown> =>
      typeof block === "object" && block !== null,
    )
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));

  const blocks = ordered.map((block) => {
    const [rawW, rawH] = String(block.size ?? "1x1").split("x").map(Number);
    const w = Math.min(Number.isFinite(rawW) ? Math.max(1, rawW) : 1, columns);
    const h = Number.isFinite(rawH) ? Math.max(1, rawH) : 1;

    let row = cursorRow;
    let col = cursorCol;
    for (;;) {
      if (col + w > columns) {
        row += 1;
        col = 0;
        continue;
      }
      if (fits(col, row, w, h)) break;
      col += 1;
    }
    for (let r = row; r < row + h; r += 1) {
      for (let c = col; c < col + w; c += 1) occupied.add(`${c},${r}`);
    }
    usedRows = Math.max(usedRows, row + h);
    cursorRow = row;
    cursorCol = col + w;
    if (cursorCol >= columns) {
      cursorRow = row + 1;
      cursorCol = 0;
    }

    const rest = { ...block };
    delete rest.size;
    delete rest.order;
    return { ...rest, x: col, y: row, w, h };
  });

  return { blocks, rows: usedRows };
}

/**
 * Config-level migrations, applied before the strict parse:
 * - legacy `spacer` shape blocks (invisible whitespace) are dropped;
 * - legacy auto-flow blocks (`order` + `size`) gain explicit coordinates,
 *   and the canvas gains the row count that layout needed.
 */
export const storefrontConfigSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const config = { ...(value as Record<string, unknown>) };
  if (!Array.isArray(config.blocks)) return config;

  const live = config.blocks.filter(
    (block) =>
      !(
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "shape" &&
        (block as Record<string, unknown>).kind === "spacer"
      ),
  );

  // Already placed? Nothing to do beyond the spacer drop.
  const needsPlacement = live.some(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).x === undefined,
  );
  if (!needsPlacement) return { ...config, blocks: live };

  const theme =
    typeof config.theme === "object" && config.theme !== null
      ? (config.theme as Record<string, unknown>)
      : {};
  // 6 is what the designer laid out with before the canvas was configurable.
  const columns = Number(theme.columns ?? 6);
  const { blocks, rows } = migrateLegacyBlocks(live, columns);

  return {
    ...config,
    theme: {
      ...theme,
      columns,
      // The board must be at least as tall as the packing needed, or blocks
      // would land outside a canvas that only ever had a default row count.
      rows: Math.min(
        CANVAS_ROWS_MAX,
        Math.max(Number(theme.rows ?? 0) || 0, rows, CANVAS_ROWS_MIN),
      ),
    },
    blocks,
  };
}, configObjectSchema);

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
