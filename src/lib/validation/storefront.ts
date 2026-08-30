import { z } from "zod";
import {
  hexColor,
  hostname,
  isStrictHexColor,
  multiLineText,
  singleLineText,
  uniqueList,
  uuidField,
} from "@/lib/validation/inputs";
import {
  BACKGROUND_IMAGE_SCALE_MAX,
  BACKGROUND_IMAGE_SCALE_MIN,
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  CANVAS_COLUMNS_MAX,
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  CORNER_RADIUS_MAX,
  CUSTOM_FONT_NAME_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  DISPLAY_MODES,
  GRID_GAP_MAX,
  EMBED_MAX_DOMAINS,
  HEADER_BIO_MAX,
  HEADER_NAME_MAX,
  HOVER_TRANSITION_MS_MAX,
  HOVER_TRANSITION_MS_MIN,
  IMAGE_ALT_MAX,
  IMAGE_FITS,
  PRICE_DISPLAYS,
  PRICE_TAG_BORDER_WIDTH_MAX,
  PRICE_TAG_FONTS,
  PRICE_TAG_INSET_MAX,
  PRICE_TAG_POSITIONS,
  PRICE_TAG_RADIUS_MAX,
  PRICE_TAG_SIZE_MAX,
  PRICE_TAG_SIZE_MIN,
  ROTATION_MAX,
  ROTATION_MIN,
  SHAPE_BORDER_WIDTH_MAX,
  SHAPE_KINDS,
  SHAPE_POINTS_MAX,
  SHAPE_POINTS_MIN,
  SHAPE_ROUNDNESS_MAX,
  STOREFRONT_FONTS,
  TEXT_ALIGNS,
  TEXT_MAX_LENGTH,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SPANS_MAX,
  TEXT_VARIANTS,
  TILE_SPOTS,
  TITLE_DISPLAYS,
  TITLE_INSET_MAX,
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

/** Gate every color before it goes anywhere near a style attribute.
 *  Re-exported from the primitives so the render path and the schema can
 *  never drift onto two different definitions of "valid hex". */
export { isStrictHexColor };

/** A storefront's public id (also the future embed/attribution key). Guards
 *  URL params + action inputs so a garbage id 404s instead of erroring. */
export const storefrontIdSchema = uuidField("That storefront id");

/** Display name shown in the storefront list. Mirrors the DB check
 *  (char_length 1..80); trimmed before validation by callers. */
export const STOREFRONT_NAME_MAX = 80;
export const storefrontNameSchema = singleLineText({
  label: "A storefront name",
  max: STOREFRONT_NAME_MAX,
});

const hexColorSchema = hexColor();

// Plain-text gates come from lib/validation/inputs.ts, so every field that
// accepts prose inherits the same rule by construction. Text is ALWAYS
// rendered as React text nodes, never markup.

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

// A seller-uploaded typeface: the R2 object KEY (shape-checked here; ownership
// and the stored object's real size/type are re-checked in saveStorefront) plus
// a plain-text label. Never a URL: display URLs are signed server-side.
const customFontSchema = z.strictObject({
  key: z
    .string()
    .max(600)
    .regex(OBJECT_KEY_PATTERN)
    .refine((key) => key.startsWith("fonts/"), {
      error: "Custom fonts must be font uploads.",
    }),
  name: singleLineText({ label: "A font name", max: CUSTOM_FONT_NAME_MAX }),
});

/**
 * Where the title band sits, identical on the theme and on a per-tile override
 * — spread into both so the two can never drift. Both fields are optional on
 * the theme too, not just on an override: a config saved before the title
 * could move carries neither, and it must keep parsing untouched.
 */
const titlePlacementFields = {
  titlePosition: z.enum(TILE_SPOTS).optional(),
  titleInset: z.number().int().min(0).max(TITLE_INSET_MAX).optional(),
};

/**
 * The price tag's appearance, identical on the theme and on a per-tile
 * override — spread into both so the two can never drift. Every field is
 * optional: absent is the coded default on the theme, and "follow the theme"
 * on an override.
 */
const priceTagAppearanceFields = {
  priceTagFont: z.enum(PRICE_TAG_FONTS).optional(),
  priceTagSize: z
    .number()
    .int()
    .min(PRICE_TAG_SIZE_MIN)
    .max(PRICE_TAG_SIZE_MAX)
    .optional(),
  priceTagColor: hexColorSchema.optional(),
  priceTagTextColor: hexColorSchema.optional(),
  priceTagBorderColor: hexColorSchema.optional(),
  priceTagBorderWidth: z
    .number()
    .int()
    .min(0)
    .max(PRICE_TAG_BORDER_WIDTH_MAX)
    .optional(),
  priceTagRadius: z.number().int().min(0).max(PRICE_TAG_RADIUS_MAX).optional(),
  priceTagInset: z.number().int().min(0).max(PRICE_TAG_INSET_MAX).optional(),
};

/**
 * Hover-reveal transition speed for the title band and the price tag —
 * identical on the theme and on a per-tile override, spread into both so the
 * two can never drift. Absent = HOVER_TRANSITION_MS_DEFAULT, the design
 * system's own fade/slide speed.
 */
const hoverTimingFields = {
  titleHoverMs: z
    .number()
    .int()
    .min(HOVER_TRANSITION_MS_MIN)
    .max(HOVER_TRANSITION_MS_MAX)
    .optional(),
  priceHoverMs: z
    .number()
    .int()
    .min(HOVER_TRANSITION_MS_MIN)
    .max(HOVER_TRANSITION_MS_MAX)
    .optional(),
};

/** Legacy chip size enum -> px, matching the text sizes each one rendered at
 *  (text-[0.625rem] / text-xs / text-sm). */
const LEGACY_PRICE_TAG_SIZE_PX: Record<string, number> = {
  sm: 10,
  md: 12,
  lg: 14,
};

/**
 * The price tag used to be two closed presets: priceTagStyle (plain/pill) and
 * priceTagSize (sm/md/lg). Both are now numbers, so unpick them in place —
 * on the theme AND on every per-tile override, which carried the same keys.
 * `pill` was a fully-round chip with a hairline; `plain` a 2px-round one.
 */
function migrateLegacyPriceTag(target: Record<string, unknown>) {
  if ("priceTagStyle" in target) {
    if (target.priceTagRadius === undefined) {
      target.priceTagRadius = target.priceTagStyle === "pill" ? 24 : 2;
    }
    if (target.priceTagStyle === "pill" && target.priceTagBorderWidth === undefined) {
      target.priceTagBorderWidth = 1;
    }
    delete target.priceTagStyle;
  }
  // Only the three values that ever existed. Anything else is not a legacy
  // config, it is junk, and it belongs to the schema to reject.
  if (typeof target.priceTagSize === "string") {
    const px = LEGACY_PRICE_TAG_SIZE_PX[target.priceTagSize];
    if (px !== undefined) target.priceTagSize = px;
  }
}

const themeObjectSchema = z.strictObject({
  background: backgroundSchema,
  accent: hexColorSchema,
  font: z.enum(STOREFRONT_FONTS),
  // Optional: present only once the seller has uploaded a face.
  customFont: customFontSchema.optional(),
  columns: z.number().int().min(CANVAS_COLUMNS_MIN).max(CANVAS_COLUMNS_MAX),
  rows: z.number().int().min(CANVAS_ROWS_MIN).max(CANVAS_ROWS_MAX),
  cornerRadius: z.number().int().min(0).max(CORNER_RADIUS_MAX),
  titleStyle: z.enum(TITLE_STYLES),
  titleDisplay: z.enum(TITLE_DISPLAYS),
  ...titlePlacementFields,
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
  ...priceTagAppearanceFields,
  ...hoverTimingFields,
  showTitle: z.boolean(),
  displayMode: z.enum(DISPLAY_MODES),
  gridGap: z.number().int().min(0).max(GRID_GAP_MAX),
  soldOutBadge: z.boolean(),
  hideSoldOut: z.boolean(),
});

/** Legacy text-size enum -> px, matching the classes each one rendered at
 *  (text-sm / text-base / text-xl / text-3xl / text-4xl). */
const LEGACY_TEXT_SIZE_PX: Record<string, number> = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 30,
  "2xl": 36,
};

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
  migrateLegacyPriceTag(theme);
  if ("density" in theme) {
    if (theme.gridGap === undefined) {
      theme.gridGap = LEGACY_DENSITY_PX[String(theme.density)] ?? 8;
    }
    delete theme.density;
  }
  return theme;
}, themeObjectSchema);

/** A masthead line's own size, in the same bounded-px model text blocks use. */
const headerSizeSchema = z
  .number()
  .int()
  .min(TEXT_SIZE_MIN)
  .max(TEXT_SIZE_MAX)
  .optional();

// The optional masthead above the grid: show toggle + capped plain text, each
// line with an optional color and size of its own (absent = follows the theme).
const headerSchema = z.strictObject({
  show: z.boolean(),
  name: singleLineText({ label: "A store name", max: HEADER_NAME_MAX, min: 0 }),
  bio: multiLineText({ label: "A store bio", max: HEADER_BIO_MAX }),
  nameColor: hexColorSchema.optional(),
  bioColor: hexColorSchema.optional(),
  // Sizes share the text block's bounds; absent = the line's own default.
  nameSize: headerSizeSchema,
  bioSize: headerSizeSchema,
  // The rest of a line's styling, matching a text block's field for field.
  // All optional, so a masthead saved before any of them existed still parses.
  nameBold: z.boolean().optional(),
  bioBold: z.boolean().optional(),
  nameItalic: z.boolean().optional(),
  bioItalic: z.boolean().optional(),
  nameUnderline: z.boolean().optional(),
  bioUnderline: z.boolean().optional(),
  nameAlign: z.enum(TEXT_ALIGNS).optional(),
  bioAlign: z.enum(TEXT_ALIGNS).optional(),
  // Same closed allowlist as everything else that names a typeface; "custom"
  // resolves to the theme's upload, or simply inherits when there is none.
  nameFont: z.enum(STOREFRONT_FONTS).optional(),
  bioFont: z.enum(STOREFRONT_FONTS).optional(),
});


/** Embed-widget settings (non-visual member of the config jsonb). Shared by
 *  the updateEmbedSettings action (the boundary) and the modal (UX only). */
export const embedSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  domains: uniqueList(hostname(), { label: "domains", max: EMBED_MAX_DOMAINS }),
});

// Free placement: every block carries its own cell coordinates and span. The
// per-field caps here are absolute (canvas maximums); the config-level refine
// below enforces the tighter, per-storefront bounds and non-overlap.
const placementFields = {
  x: z.number().int().min(0).max(CANVAS_COLUMNS_MAX - 1),
  y: z.number().int().min(0).max(CANVAS_ROWS_MAX - 1),
  w: z.number().int().min(1).max(CANVAS_COLUMNS_MAX),
  h: z.number().int().min(1).max(CANVAS_ROWS_MAX),
  // Tilt. Bounded int like every other numeric that reaches a style attribute,
  // and optional because level is the absence of the key rather than a zero —
  // which is what keeps an untilted block identical to one saved before this
  // existed. The canvas invariants below deliberately ignore it: rotation is
  // visual, and the cells a block occupies are the ones x/y/w/h name.
  rotation: z.number().int().min(ROTATION_MIN).max(ROTATION_MAX).optional(),
  // Paint order, bounded by the board's own block cap so one block can never
  // claim a depth the board has no room for. Optional for the same reason as
  // rotation: an unlayered board carries no z at all and renders in reading
  // order, exactly as it did before layering existed.
  //
  // Deliberately NO config-level refinement over duplicates or gaps: layerOrder
  // breaks both with the reading index, so such a board still has a well-defined
  // paint order, and refusing to save it would be an error the seller has no
  // way to act on.
  z: z.number().int().min(0).max(MAX_BLOCKS - 1).optional(),
};

// Per-tile card styling: the SAME closed enums and bounded integers as the
// theme's card fields, each one optional (absent = follow the theme). Strict,
// so nothing free-form rides along inside a block's style member. Wrapped in
// the same legacy price tag migration the theme runs, because a tile that
// overrode the retired plain/pill or sm/md/lg presets carries them too.
const cardStyleOverridesSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null) return value;
  const style = { ...(value as Record<string, unknown>) };
  migrateLegacyPriceTag(style);
  return style;
}, z.strictObject({
  cornerRadius: z.number().int().min(0).max(CORNER_RADIUS_MAX).optional(),
  showTitle: z.boolean().optional(),
  titleStyle: z.enum(TITLE_STYLES).optional(),
  titleDisplay: z.enum(TITLE_DISPLAYS).optional(),
  ...titlePlacementFields,
  priceDisplay: z.enum(PRICE_DISPLAYS).optional(),
  priceTagPosition: z.enum(PRICE_TAG_POSITIONS).optional(),
  ...priceTagAppearanceFields,
  ...hoverTimingFields,
}));

/** Focal point + zoom for an image inside a frame. The same bounded ints the
 *  background has always stored, now shared with product tiles. */
const imagePlacementSchema = z.strictObject({
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100),
  scale: z.number().int().min(IMAGE_SCALE_MIN).max(IMAGE_SCALE_MAX),
});

const productBlockSchema = z.strictObject({
  type: z.literal("product"),
  productId: z.uuid(),
  ...placementFields,
  // Seller-controlled sold-out mark — optional so older blocks still parse.
  soldOut: z.boolean().optional(),
  // Per-tile look, optional so blocks saved before it existed still parse.
  style: cardStyleOverridesSchema.optional(),
  // How the product's photo is framed in this tile. Optional, and the editor
  // drops it again when framing returns to centred — so an unframed tile is
  // indistinguishable from one saved before framing existed.
  imagePlacement: imagePlacementSchema.optional(),
});

/**
 * One formatted run inside a text block: `[start, end)` in character offsets,
 * carrying whichever of the four formatting fields it overrides. Bounds are
 * gated here; the renderer clamps them against the live text as well, since a
 * span can outlive the characters it named.
 */
const textSpanSchema = z
  .strictObject({
    start: z.number().int().min(0).max(TEXT_MAX_LENGTH),
    end: z.number().int().min(1).max(TEXT_MAX_LENGTH),
    color: hexColorSchema.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
  })
  .refine((span) => span.start < span.end, {
    message: "A formatted range must end after it starts",
  });

// Plain text only. Rendered exclusively as a React text node (React escapes
// it); the schema still refuses control characters so stored data stays sane.
const textBlockSchema = z.strictObject({
  type: z.literal("text"),
  id: uuidField("A block id"),
  text: multiLineText({ label: "Block text", max: TEXT_MAX_LENGTH }),
  variant: z.enum(TEXT_VARIANTS),
  align: z.enum(TEXT_ALIGNS),
  ...placementFields,
  // Inline formatting — optional so v1 blocks (without them) still parse.
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  // Ranges that override the formatting above for part of the text.
  spans: z.array(textSpanSchema).max(TEXT_SPANS_MAX).optional(),
  // Per-block styling overrides — optional for the same reason. Color stays
  // regex-gated hex; the font resolves through a fixed class map (or, for
  // "custom", the theme's uploaded face); the size is a bounded integer.
  color: hexColorSchema.optional(),
  // Sizes used to be a five-value enum. Migrate those to the px they rendered
  // at so old storefronts are unchanged to the eye; anything else that is not
  // an in-range integer is rejected, exactly as before.
  fontSize: z.preprocess(
    (value) =>
      typeof value === "string" && value in LEGACY_TEXT_SIZE_PX
        ? LEGACY_TEXT_SIZE_PX[value]
        : value,
    z.number().int().min(TEXT_SIZE_MIN).max(TEXT_SIZE_MAX).optional(),
  ),
  font: z.enum(STOREFRONT_FONTS).optional(),
});

// Decorative shape: allowlisted kind + regex-gated color, nothing free-form.
const shapeBlockSchema = z.strictObject({
  type: z.literal("shape"),
  id: uuidField("A block id"),
  kind: z.enum(SHAPE_KINDS),
  color: hexColorSchema,
  ...placementFields,
  // Styling — optional so blocks saved before it existed still parse.
  borderWidth: z.number().int().min(0).max(SHAPE_BORDER_WIDTH_MAX).optional(),
  borderColor: hexColorSchema.optional(),
  opacity: z.number().int().min(0).max(100).optional(),
  // Geometry parameters (bounded ints; resolved through code-defined path
  // generation only), optional for the same back-compat reason.
  roundness: z.number().int().min(0).max(SHAPE_ROUNDNESS_MAX).optional(),
  points: z.number().int().min(SHAPE_POINTS_MIN).max(SHAPE_POINTS_MAX).optional(),
});

// A seller's own artwork. Holds an R2 object KEY (shape-checked here; ownership
// and the stored object's real size/type are re-checked in saveStorefront) and
// nothing free-form: the alt text is plain text bound for an `alt` attribute,
// the fit is a closed enum, and placement/opacity are bounded ints. The key
// must sit under `elements/` — the one prefix whose upload route admits SVG —
// so a product photo or a font can never be rendered as an element, nor an
// element be linked as a product photo.
const imageBlockSchema = z.strictObject({
  type: z.literal("image"),
  id: uuidField("A block id"),
  key: z
    .string()
    .max(600)
    .regex(OBJECT_KEY_PATTERN)
    .refine((key) => key.startsWith("elements/"), {
      error: "Elements must be element uploads.",
    }),
  alt: singleLineText({ label: "Element alt text", max: IMAGE_ALT_MAX, min: 0 }),
  ...placementFields,
  fit: z.enum(IMAGE_FITS).optional(),
  imagePlacement: imagePlacementSchema.optional(),
  opacity: z.number().int().min(0).max(100).optional(),
});

const blockSchema = z.discriminatedUnion("type", [
  productBlockSchema,
  textBlockSchema,
  shapeBlockSchema,
  imageBlockSchema,
]);

const configObjectSchema = z
  .strictObject({
    theme: themeSchema,
    blocks: z
      .array(blockSchema)
      // Custom message: Zod's default ("Array must contain at most...") leaks
      // implementation vocabulary at the one seller-facing cap in this schema.
      .max(MAX_BLOCKS, {
        error: `A storefront can hold up to ${MAX_BLOCKS} blocks. Remove some blocks or split this storefront in two.`,
      })
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
  // One geometric rule survives: a block is placed on the board.
  //
  // Blocks may SHARE cells. Stacking is a design move (a word over a shape, a
  // chip over a photo) and `z` is what settles which one paints on top, so
  // there is nothing left for a validator to arbitrate. The check that used to
  // live here would now reject boards the editor is built to produce.
  //
  // The STORED rect is what is checked, not the painted footprint of a tilted
  // block. A rotated corner reaching past the edge is a visual matter the
  // editor already keeps in hand (see clampRotatedBox), and it is not worth a
  // save the seller cannot complete: at the extreme, a block wider than the
  // board has no placement that hides its overhang, and refusing that save
  // would strand the design rather than protect it.
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
