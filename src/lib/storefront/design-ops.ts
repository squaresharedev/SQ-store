import { z } from "zod";
import { clampToCanvas, columnsThatFit, findFreeCell, reflowBlocks, type GridBlock } from "@/components/grid/gridConstants";
import { LAYER_OPS, normalizeLayers, type LayerOp } from "@/lib/storefront/layers";
import { PHONE_BOARD_WIDTH_PX, phoneLayout, phoneRect, unpinnedOnPhone } from "@/lib/storefront/mobile-layout";
import { derivePalette, recolourPalettes } from "@/lib/storefront/palette";
import { isStrictHexColor } from "@/lib/validation/predicates";
import { objectKeyPrefix } from "@/lib/validation/product";
import {
  BAND_DIMS,
  BLUR_DIRECTIONS,
  BLUR_MAX,
  BUTTON_LABEL_MAX,
  BUTTON_LOOKS,
  CAROUSEL_PRODUCTS_MAX,
  DEFAULT_IMAGE_PLACEMENT,
  IMAGE_ALT_MAX,
  LINK_TARGET_KINDS,
  LINK_URL_MAX,
  MARQUEE_SPEEDS,
  MARQUEE_TEXT_MAX,
  PALETTE_SLOTS,
  PHOTO_SHAPES,
  SHADOW_PRESETS,
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_DEFAULT,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  TEXT_MAX_LENGTH,
  TEXT_VALIGNS,
  CANVAS_ROWS_MAX,
  DEFAULT_MOBILE_COLUMNS,
  EMPTY_STOREFRONT_HEADER,
  IMAGE_FITS,
  SHAPE_KINDS,
  STOREFRONT_FONTS,
  TEXT_ALIGNS,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_VARIANTS,
  blockFine,
  blockKey,
  boardProductIds,
  isFreelyArranged,
  layerOrder,
  mergeCardStyleOverrides,
  withRotation,
  type BandBackground,
  type CardStyleOverrides,
  type FinePlacement,
  type LinkTarget,
  type MobilePlacement,
  type PaletteSlot,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontPalette,
  type TextVariant,
} from "@/types/storefront";

// EDITING A BOARD ONE CHANGE AT A TIME, as pure data. No session, no database,
// so the rules are unit-testable. An assistant states what should change ("move
// this block there", "make that shape a star") and never has to resend blocks
// it was not asked about, so it cannot lose them by retyping them wrong.
//
// Nothing is judged here beyond what these operations alone can know. The result
// goes through storefrontConfigSchema and saveStorefront, the same as a save from
// the designer, which is what bounds every value and keeps a block on the board.
// The exceptions are refusals the schema can only make in one generic sentence
// (a link to something that is not there, a file of the wrong kind): those are
// caught here, in words an assistant can act on.

/** A cell position or size. Whole or half cells: text, shape and button blocks
 *  may take half cells (2.5), and anything else is refused in words (see
 *  onWholeCells), which the schema could only say in one generic sentence. */
const cells = z.number();

/** Where a new block goes. Leave out x and y to take the next free cells. */
const placement = {
  x: cells.optional(),
  y: cells.optional(),
  w: cells.optional(),
  h: cells.optional(),
  rotation: z.number().int().optional().describe("Clockwise degrees."),
};

const blockRef = z
  .string()
  .max(64)
  .describe("Which block: its id, or the productId for a product tile, as get_storefront shows them.");

const bandRef = z.string().max(64).describe("Which band: its id, from board.bands.");

const changes = z
  .record(z.string(), z.unknown())
  .describe("Only what changes. null clears an optional field back to following the theme.");

const color = z.string().max(7).describe("Strict #rrggbb.");

const blur = z
  .number()
  .int()
  .optional()
  .describe(`How soft the block is, 0 (sharp) to ${BLUR_MAX}.`);

const blurDirection = z
  .enum(BLUR_DIRECTIONS)
  .optional()
  .describe("Which way the blur runs: all over (the default), or soft from one edge and sharp at the other.");

const viewport = z
  .enum(["desktop", "mobile"])
  .optional()
  .describe("Which board: the desktop one (the default), or the phone layout.");

/** An id an assistant hands over: shape-checked by the real schema later. */
const someId = z.string().max(64);

/** Where a button leads (LinkTarget), flat so the tool list stays small:
 *  existence is checked here, and the exact shape by the schema. */
const link = z
  .strictObject({
    kind: z.enum(LINK_TARGET_KINDS),
    productId: someId.optional(),
    storefrontId: someId.optional(),
    bandId: someId.optional(),
    url: z.string().max(LINK_URL_MAX).optional(),
  })
  .describe("{kind:product,productId} on this board, {kind:storefront,storefrontId} of this store, {kind:band,bandId} on this page, or {kind:url,url} (https).");

/** A band's backdrop, flat: the kind follows from what is given, and a
 *  change without a kind is laid over the band's current backdrop. */
const bandBackground = z
  .strictObject({
    kind: z.enum(["solid", "gradient", "image"]).optional(),
    color: color.optional(),
    from: color.optional(),
    via: color.nullable().optional(),
    to: color.optional(),
    angle: z.number().int().optional(),
    file: z.string().max(200).optional().describe("An upload_id from upload_image, or from copy_product_photo as a photo."),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    scale: z.number().int().optional(),
    dim: z.enum(BAND_DIMS).nullable().optional().describe("A veil: light under dark words, dark under light ones."),
  })
  .describe(
    "A palette colour {color}, a gradient {from, via?, to, angle in degrees} or a photo {file, dim?, x and y its focal point in percent, scale its zoom in percent}. Leave out for the palette's muted colour; a change without kind keeps the rest.",
  );

/** The presets a new image or shape can wear at once, so it needs no second call. */
const shadow = z.enum(SHADOW_PRESETS).optional();
const gradient = z
  .strictObject({ from: color, via: color.optional(), to: color, angle: z.number().int() })
  .optional()
  .describe("Painted instead of color: palette colours and an angle in degrees.");

const paletteColors = z
  .strictObject({
    background: color.optional(),
    text: color.optional(),
    accent: color.optional(),
    surface: color.optional(),
    muted: color.optional(),
  })
  .describe("Only the colours that change.");

export const designOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add_product"),
    productId: z.uuid(),
    ...placement,
    style: changes.optional(),
  }),
  z.strictObject({
    op: z.literal("add_text"),
    text: z.string().max(TEXT_MAX_LENGTH),
    variant: z
      .enum(TEXT_VARIANTS)
      .optional()
      .describe("The saved text style it wears (theme.textStyles). Leave out for heading on a few words, body on a sentence or more."),
    align: z.enum(TEXT_ALIGNS).optional(),
    valign: z.enum(TEXT_VALIGNS).optional().describe("Top, middle (the default) or bottom of its box."),
    color: color.optional(),
    fontSize: z.number().int().optional(),
    font: z.enum(STOREFRONT_FONTS).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    letterSpacing: z
      .number()
      .int()
      .optional()
      .describe(`Space between letters in hundredths of the type size, ${TEXT_LETTER_SPACING_MIN} to ${TEXT_LETTER_SPACING_MAX}; leave out for the typeface's own.`),
    lineHeight: z
      .number()
      .int()
      .optional()
      .describe(`Space between lines as a percent of the type size, ${TEXT_LINE_HEIGHT_MIN} to ${TEXT_LINE_HEIGHT_MAX}; leave out for ${TEXT_LINE_HEIGHT_DEFAULT}.`),
    blur,
    blurDirection,
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_shape"),
    kind: z.enum(SHAPE_KINDS),
    color: color.optional().describe("Strict #rrggbb. Leave out for the store's accent."),
    borderWidth: z.number().int().optional(),
    borderColor: color.optional(),
    opacity: z.number().int().optional().describe("Percent, 0 to 100."),
    blur,
    blurDirection,
    roundness: z.number().int().optional(),
    points: z.number().int().optional(),
    gradient,
    shadow,
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_image"),
    file: z.string().max(200).describe("An upload_id from upload_element, or from copy_product_photo as artwork."),
    alt: z.string().max(IMAGE_ALT_MAX).optional().describe("What it shows, for screen readers. Empty for decoration."),
    fit: z.enum(IMAGE_FITS).optional(),
    opacity: z.number().int().optional(),
    blur,
    blurDirection,
    shape: z.enum(PHOTO_SHAPES).optional(),
    shadow,
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_button"),
    label: z.string().max(BUTTON_LABEL_MAX),
    link,
    look: z.enum(BUTTON_LOOKS).optional().describe("solid (the default), outline or link. Its colours are the storefront's own button's."),
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_marquee"),
    text: z.string().max(MARQUEE_TEXT_MAX),
    speed: z.enum(MARQUEE_SPEEDS).optional(),
    variant: z.enum(TEXT_VARIANTS).optional().describe("The saved text style it wears. Leave out for label."),
    color: color.optional().describe("Leave out for an ink that reads on what is behind it."),
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_carousel"),
    productIds: z.array(someId).min(1).max(CAROUSEL_PRODUCTS_MAX),
    ...placement,
  }),
  z.strictObject({ op: z.literal("move"), block: blockRef, x: cells, y: cells, viewport }),
  z.strictObject({
    op: z.literal("resize"),
    block: blockRef,
    w: cells,
    h: cells,
    x: cells.optional(),
    y: cells.optional(),
    viewport,
  }),
  z.strictObject({ op: z.literal("rotate"), block: blockRef, degrees: z.number().int() }),
  z.strictObject({ op: z.literal("layer"), block: blockRef, to: z.enum(["front", "forward", "backward", "back"]) }),
  z.strictObject({
    op: z.literal("style"),
    block: blockRef,
    changes,
    viewport: viewport.describe(
      `Which board the look is for. On the phone layout only a text block's fontSize may differ (${TEXT_SIZE_MIN} to ${TEXT_SIZE_MAX}, null to follow the desktop size again).`,
    ),
  }),
  z.strictObject({ op: z.literal("remove"), block: blockRef, viewport }),
  z.strictObject({ op: z.literal("mobile_reset"), block: blockRef }),
  z.strictObject({
    op: z.literal("add_band"),
    id: z.uuid().optional().describe("Your own uuid for it, so a button in the same list can link to it. Optional."),
    y: z.number().int().describe("The first row it runs behind."),
    h: z.number().int().describe("How many rows."),
    background: bandBackground.optional(),
  }),
  z.strictObject({
    op: z.literal("edit_band"),
    band: bandRef,
    y: z.number().int().optional(),
    h: z.number().int().optional(),
    background: bandBackground.optional(),
  }),
  z.strictObject({ op: z.literal("remove_band"), band: bandRef }),
  z.strictObject({ op: z.literal("palette"), colors: paletteColors }),
  z.strictObject({ op: z.literal("theme"), changes }),
  z.strictObject({ op: z.literal("header"), changes }),
]);

export type DesignOp = z.infer<typeof designOpSchema>;

/** Why an operation cannot be done, in words for whoever asked for it. */
export class DesignOpRefused extends Error {
  constructor(message: string, readonly fix?: string) {
    super(message);
    this.name = "DesignOpRefused";
  }
}

type Fields = Record<string, unknown>;
type Box = { x: number; y: number; w: number; h: number };

/** What a style change may not reach: where a block is has its own operations,
 *  and what a block is does not change. */
const NOT_STYLE = new Set(["type", "id", "productId", "key", "x", "y", "w", "h", "rotation", "z", "mobile", "mobileFontSize", "fine"]);

/** What a block's look may be on the phone board alone, and the field that keeps it. */
const PHONE_STYLE: Partial<Record<StorefrontBlock["type"], Record<string, string>>> = {
  text: { fontSize: "mobileFontSize" },
};

/** The kinds that may sit on half cells (FinePlacement). Product cards and
 *  everything photographic stay on the main grid. */
const FINE_KINDS: ReadonlySet<StorefrontBlock["type"]> = new Set(["text", "shape", "button"]);

/** How big a new block of each kind lands when the operation names no size.
 *  Infinity is "the board's full width". */
const NEW_BLOCK_SIZE: Record<StorefrontBlock["type"], { w: number; h: number }> = {
  product: { w: 1, h: 1 },
  text: { w: 2, h: 1 },
  shape: { w: 1, h: 1 },
  image: { w: 1, h: 1 },
  button: { w: 2, h: 1 },
  marquee: { w: Number.POSITIVE_INFINITY, h: 1 },
  carousel: { w: Number.POSITIVE_INFINITY, h: 2 },
};

/** Past this many characters (or across lines) a new text block reads as a
 *  sentence, so it starts in the body style rather than the headline's. */
const HEADLINE_TEXT_MAX = 48;

/** A new gradient's direction when none is given: top to bottom. */
const DEFAULT_GRADIENT_ANGLE = 180;

/** The saved style a new text block starts in when none is named. */
function startingVariant(text: string): TextVariant {
  return text.length > HEADLINE_TEXT_MAX || text.includes("\n") ? "body" : "heading";
}

/** `changes` for the phone board, as the fields that keep them on the block. */
function phoneStyle(block: StorefrontBlock, patch: Fields): Fields {
  const allowed = PHONE_STYLE[block.type] ?? {};
  return Object.fromEntries(
    Object.entries(patch).map(([field, value]) => {
      const stored = allowed[field];
      if (!stored) {
        throw new DesignOpRefused(
          `"${field}" is the same on every board, so it cannot be set for the phone alone.`,
          Object.keys(allowed).length
            ? `On the phone layout a ${block.type} block can only change ${Object.keys(allowed).join(", ")}. Leave viewport out to change it everywhere.`
            : "Leave viewport out to change it everywhere, or move, resize or remove it with viewport \"mobile\".",
        );
      }
      return [stored, value];
    }),
  );
}

/** Lay `changes` over `target`, where null clears a field. */
function patched<T extends object>(target: T, patch: Fields): T {
  const next = { ...target } as Fields;
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete next[field];
    else next[field] = value;
  }
  return next as T;
}

/** The ref an assistant uses for a block: what it can read in get_storefront. */
function refOf(block: StorefrontBlock): string {
  return block.type === "product" ? block.productId : block.id;
}

const isHalf = (value: number | undefined) => value !== undefined && !Number.isInteger(value);

/** Refuse anything but whole or half cells, and half cells for a kind that
 *  sits on whole ones, or on the phone board. */
function onWholeCells(type: StorefrontBlock["type"], values: (number | undefined)[], phone = false): void {
  if (values.some((value) => value !== undefined && !Number.isInteger(value * 2))) {
    throw new DesignOpRefused("Blocks sit on whole or half cells.", "Give positions and sizes such as 2 or 2.5.");
  }
  if (!values.some(isHalf)) return;
  if (phone) {
    throw new DesignOpRefused("The phone board places blocks on whole cells.", "Give whole numbers with viewport \"mobile\".");
  }
  if (!FINE_KINDS.has(type)) {
    throw new DesignOpRefused(
      `A ${type} block sits on whole cells.`,
      "Only text, shape and button blocks can use half cells (2.5). Give whole numbers.",
    );
  }
}

/** A block is at least half a cell each way. */
function assertSize(w: number | undefined, h: number | undefined): void {
  if ((w !== undefined && w <= 0) || (h !== undefined && h <= 0)) {
    throw new DesignOpRefused("A block cannot be that small.", "Give w and h of at least 1, or 0.5 for text, shapes and buttons.");
  }
}

/**
 * Where a block is DRAWN, in cells: its own cells less the half-cell insets
 * it carries (FinePlacement). What an assistant reads in board.blocks and
 * writes with move and resize, so it never has to think in insets.
 */
export function drawnBox(block: StorefrontBlock): Box {
  const fine = blockFine(block);
  const half = (side?: true) => (side ? 0.5 : 0);
  return {
    x: block.x + half(fine?.left),
    y: block.y + half(fine?.top),
    w: block.w - half(fine?.left) - half(fine?.right),
    h: block.h - half(fine?.top) - half(fine?.bottom),
  };
}

/**
 * A box drawn on half cells as what the config stores: the whole cells around
 * it, and an inset on each side that falls between two (FinePlacement). A box
 * on whole cells carries no `fine` at all.
 */
export function cellsFor(drawn: Box): Box & { fine?: FinePlacement } {
  const x = Math.floor(drawn.x);
  const y = Math.floor(drawn.y);
  const right = Math.ceil(drawn.x + drawn.w);
  const bottom = Math.ceil(drawn.y + drawn.h);
  const fine: FinePlacement = {
    ...(drawn.x !== x ? { left: true } : {}),
    ...(drawn.x + drawn.w !== right ? { right: true } : {}),
    ...(drawn.y !== y ? { top: true } : {}),
    ...(drawn.y + drawn.h !== bottom ? { bottom: true } : {}),
  };
  return { x, y, w: right - x, h: bottom - y, ...(Object.keys(fine).length ? { fine } : {}) };
}

/** A block put where `drawn` says: whole cells, plus insets for a kind that has them. */
function placedAt<T extends StorefrontBlock>(block: T, drawn: Box): T {
  const { fine, ...rect } = cellsFor(drawn);
  const { fine: _old, ...rest } = block as T & { fine?: FinePlacement };
  void _old;
  return { ...rest, ...rect, ...(fine ? { fine } : {}) } as T;
}

/** A stored key's prefix (`images`, `elements`...): which upload door it came through. */
function keyPrefixOf(value: unknown): string | null {
  return typeof value === "string" && value.includes("/") ? value.slice(0, value.indexOf("/")) : null;
}

/** An image block's artwork must be an element; refuse a photo key in words. */
function assertArtwork(file: unknown): void {
  if (keyPrefixOf(file) === objectKeyPrefix("image")) {
    throw new DesignOpRefused(
      "That file was uploaded as a photo (upload_image), and add_image places artwork.",
      "Upload it with upload_element, or copy a product's photo with copy_product_photo as artwork, and use that upload_id. A photo belongs in a band's background.",
    );
  }
}

/** A band's (or the board's) photo must be an image upload; refuse artwork in words. */
function assertBandPhoto(file: unknown): void {
  if (keyPrefixOf(file) === objectKeyPrefix("element")) {
    throw new DesignOpRefused(
      "That file was uploaded as artwork (upload_element), and a background takes a photo.",
      "Upload it with upload_image, or copy a product's photo with copy_product_photo as a photo, and use that upload_id.",
    );
  }
}

function restyled(block: StorefrontBlock, patch: Fields): StorefrontBlock {
  for (const field of Object.keys(patch)) {
    if (NOT_STYLE.has(field)) {
      throw new DesignOpRefused(
        `"${field}" cannot be changed with a style operation.`,
        "Use move, resize, rotate or layer for where a block is (half cells such as 2.5 for text, shapes and buttons). To replace one, remove it and add another.",
      );
    }
  }
  switch (block.type) {
    case "product": {
      // A tile's look is an override of the theme's, kept in its own member. Its
      // photo's framing is the one thing about it that is not.
      const { imagePlacement, ...card } = patch;
      const overrides = Object.fromEntries(
        Object.entries(card).map(([field, value]) => [field, value ?? undefined]),
      ) as CardStyleOverrides;
      const style = mergeCardStyleOverrides(block.style, overrides);
      const { style: _old, ...rest } = block;
      void _old;
      return patched({ ...rest, ...(style ? { style } : {}) }, imagePlacement === undefined ? {} : { imagePlacement });
    }
    case "image": {
      // `file` is what an assistant knows a picture by; the block stores its key.
      const { file, ...rest } = patch;
      if (file !== undefined) assertArtwork(file);
      return patched(block, file === undefined ? rest : { ...rest, key: file });
    }
    default:
      return patched(block, patch);
  }
}

/** A band's backdrop from what an operation gave, over what it had. */
function bandBackdrop(
  input: z.infer<typeof bandBackground> | undefined,
  current: BandBackground | undefined,
  palette: StorefrontPalette,
): BandBackground {
  const given = input ?? {};
  const kind =
    given.kind ??
    (given.file !== undefined
      ? "image"
      : given.from !== undefined || given.to !== undefined
        ? "gradient"
        : given.color !== undefined
          ? "solid"
          : (current?.kind ?? "solid"));
  switch (kind) {
    case "solid": {
      const was = current?.kind === "solid" ? current : undefined;
      return { kind, color: given.color ?? was?.color ?? palette.muted };
    }
    case "gradient": {
      const was = current?.kind === "gradient" ? current : undefined;
      const via = given.via === undefined ? was?.via : (given.via ?? undefined);
      return {
        kind,
        from: given.from ?? was?.from ?? palette.surface,
        ...(via ? { via } : {}),
        to: given.to ?? was?.to ?? palette.muted,
        angle: given.angle ?? was?.angle ?? DEFAULT_GRADIENT_ANGLE,
      };
    }
    case "image": {
      const was = current?.kind === "image" ? current : undefined;
      const key = given.file ?? was?.key;
      if (!key) {
        throw new DesignOpRefused("A photo band needs a photo.", "Give background.file: an upload_id from upload_image.");
      }
      assertBandPhoto(key);
      const dim = given.dim === undefined ? was?.dim : (given.dim ?? undefined);
      return {
        kind,
        key,
        x: given.x ?? was?.x ?? DEFAULT_IMAGE_PLACEMENT.x,
        y: given.y ?? was?.y ?? DEFAULT_IMAGE_PLACEMENT.y,
        scale: given.scale ?? was?.scale ?? DEFAULT_IMAGE_PLACEMENT.scale,
        ...(dim && dim !== "none" ? { dim } : {}),
      };
    }
  }
}

/** A hex nothing in `config` wears, for moving a colour out of the way. */
function unusedHex(config: StorefrontConfig, taken: Set<string>): string {
  const worn = JSON.stringify(config).toLowerCase();
  for (let n = 1; ; n += 1) {
    const hex = `#${n.toString(16).padStart(6, "0")}`;
    if (!worn.includes(hex) && !taken.has(hex)) {
      taken.add(hex);
      return hex;
    }
  }
}

/**
 * Set palette colours, recolouring the storefront to match (recolourPalettes):
 * everything painted in a colour's old value takes its new one.
 *
 * recolourPalettes changes one slot after another, so two slots trading
 * places (a light board turned dark) would merge: once the background has
 * taken the old text colour, nothing tells the two apart. So when more than
 * one slot changes, each first moves to a colour nothing wears, then on.
 */
export function withPalette(config: StorefrontConfig, colors: Record<string, unknown>): StorefrontConfig {
  for (const [slot, hex] of Object.entries(colors)) {
    if (!(PALETTE_SLOTS as readonly string[]).includes(slot)) {
      throw new DesignOpRefused(`The palette has no "${slot}" colour.`, `Its five are ${PALETTE_SLOTS.join(", ")}.`);
    }
    if (typeof hex !== "string" || !isStrictHexColor(hex)) {
      throw new DesignOpRefused(`The palette's ${slot} must be a colour.`, "Palette colours are strict #rrggbb.");
    }
  }
  const wanted = colors as Partial<StorefrontPalette>;
  const current = derivePalette(config.theme);
  const changing = PALETTE_SLOTS.filter(
    (slot) => wanted[slot] !== undefined && wanted[slot]!.toLowerCase() !== current[slot].toLowerCase(),
  );
  if (changing.length < 2) return recolourPalettes(config, wanted);
  const taken = new Set<string>();
  const parked = Object.fromEntries(changing.map((slot) => [slot, unusedHex(config, taken)])) as Partial<
    Record<PaletteSlot, string>
  >;
  return recolourPalettes(recolourPalettes(config, parked), wanted);
}

/**
 * Every link on the board leads somewhere that is there: a product this board
 * shows, a band on this page. The schema refuses the same in one generic
 * sentence; this says which link, and what to do.
 */
function assertLinksLand(config: StorefrontConfig): void {
  const shown = new Set(boardProductIds(config.blocks));
  const bands = new Set((config.bands ?? []).map((band) => band.id));
  const check = (target: unknown, who: string) => {
    if (!target || typeof target !== "object") return;
    const { kind, productId, bandId } = target as { kind?: unknown; productId?: unknown; bandId?: unknown };
    if (kind === "product" && typeof productId === "string" && !shown.has(productId)) {
      throw new DesignOpRefused(
        `${who} leads to product ${productId}, which is not on this storefront.`,
        "A product link opens that product's page here, so the product has to be on the board: add it with add_product or put it in a carousel, or link somewhere else.",
      );
    }
    if (kind === "band" && typeof bandId === "string" && !bands.has(bandId)) {
      throw new DesignOpRefused(
        `${who} leads to band ${bandId}, which this storefront does not have.`,
        "The bands are in board.bands. Add one with add_band (give it your own id to link to it in the same list), or link somewhere else.",
      );
    }
  };
  for (const block of config.blocks) {
    if (block.type === "button") check(block.link, `The button "${block.label}" (${block.id})`);
  }
  for (const entry of config.header?.links ?? []) check(entry?.link, `The header link "${entry?.label}"`);
}

/**
 * A member that holds a file, as an assistant writes it: `file` for the upload,
 * kept as `key`, after `assert` has checked it came through the right door.
 * Anything else is left for the schema.
 */
function withFile(value: unknown, assert: (file: unknown) => void): unknown {
  if (!value || typeof value !== "object" || !("file" in value)) return value;
  const { file, ...rest } = value as Fields;
  assert(file);
  return { ...rest, key: file };
}

/** A typeface must be a font upload; refuse anything else in words. */
function assertFont(file: unknown): void {
  const prefix = keyPrefixOf(file);
  if (prefix !== null && prefix !== objectKeyPrefix("font")) {
    throw new DesignOpRefused("That file is not a typeface upload.", "Upload the font with upload_font and use that upload_id.");
  }
}

/** The theme's members that hold a file, and the door each must come through. */
const THEME_FILES: Record<string, (file: unknown) => void> = {
  customFont: assertFont,
  background: assertBandPhoto,
};

/**
 * Apply `ops` in order, each seeing the board the one before it left. Returns the
 * new config and the ids of what was added, or throws DesignOpRefused. `config`
 * is left alone, so a refused batch changes nothing.
 */
export function applyDesignOps(
  config: StorefrontConfig,
  ops: readonly DesignOp[],
  mintId: () => string = () => crypto.randomUUID(),
): { config: StorefrontConfig; added: string[] } {
  // What the operations below do not name (the product page, the checkout...)
  // rides along, and only a palette change ever touches it.
  let rest = config;
  let theme = config.theme;
  let header = config.header;
  let blocks = [...config.blocks];
  let bands: StorefrontBand[] = [...(config.bands ?? [])];
  const added: string[] = [];

  /** The board as it stands now, whole. A storefront that never had bands
   *  gains no `bands` key, and one whose last band went loses it. */
  const whole = (): StorefrontConfig => {
    const { bands: _old, ...others } = rest;
    void _old;
    return { ...others, theme, header, blocks, ...(bands.length ? { bands } : {}) };
  };

  const find = (ref: string): StorefrontBlock => {
    const block = blocks.find((candidate) => refOf(candidate) === ref);
    if (!block) {
      throw new DesignOpRefused(
        `There is no block "${ref}" on this storefront.`,
        "Read the board with get_storefront. A block is named by its id, or a product tile by its productId.",
      );
    }
    return block;
  };
  const findBand = (ref: string): StorefrontBand => {
    const band = bands.find((candidate) => candidate.id === ref);
    if (!band) {
      throw new DesignOpRefused(`There is no band "${ref}" on this storefront.`, "The bands are in board.bands, by id.");
    }
    return band;
  };
  const replace = (block: StorefrontBlock, next: StorefrontBlock) => {
    blocks = blocks.map((candidate) => (candidate === block ? next : candidate));
  };

  /** The designer's rule: the cells asked for, or the next free ones, or a new
   *  row at the bottom, and only a full board at its tallest stacks. Half
   *  cells (for the kinds that take them) become insets of whole ones. */
  const place = (
    type: StorefrontBlock["type"],
    spot: { x?: number; y?: number; w?: number; h?: number; rotation?: number },
  ) => {
    onWholeCells(type, [spot.x, spot.y, spot.w, spot.h]);
    assertSize(spot.w, spot.h);
    const size = NEW_BLOCK_SIZE[type];
    const w = spot.w ?? Math.max(1, Math.min(size.w, theme.columns - (spot.x ?? 0)));
    const h = spot.h ?? size.h;
    const rotation = spot.rotation ?? 0;
    const turn = rotation ? { rotation } : {};
    if (spot.x !== undefined && spot.y !== undefined) return { ...cellsFor({ x: spot.x, y: spot.y, w, h }), ...turn };
    const [cellsW, cellsH] = [Math.ceil(w), Math.ceil(h)];
    const free = findFreeCell(blocks.map(asGridBlock), cellsW, cellsH, theme.columns, theme.rows, rotation);
    if (free) return { ...cellsFor({ ...free, w, h }), ...turn };
    const grown = Math.min(CANVAS_ROWS_MAX, theme.rows + cellsH);
    const below = grown > theme.rows ? findFreeCell(blocks.map(asGridBlock), cellsW, cellsH, theme.columns, grown, rotation) : null;
    if (below) {
      theme = { ...theme, rows: grown };
      return { ...cellsFor({ ...below, w, h }), ...turn };
    }
    return { ...clampToCanvas({ x: spot.x ?? 0, y: spot.y ?? 0, w: cellsW, h: cellsH }, theme.columns, theme.rows), ...turn };
  };

  const add = (block: StorefrontBlock) => {
    blocks = [...blocks, block];
    added.push(refOf(block));
  };

  /** A phone operation on a board without a phone layout starts one, at the
   *  width a phone fits: the rest of its blocks keep being placed for it. */
  const startPhoneLayout = () => {
    if (theme.mobileColumns === undefined) {
      theme = { ...theme, mobileColumns: Math.min(DEFAULT_MOBILE_COLUMNS, theme.columns) };
    }
  };
  /** Where a block is on the phone right now: its own rect, or the one placed for it. */
  const phoneRectOf = (block: StorefrontBlock): MobilePlacement => phoneRect(theme, blocks, block);
  const placeOnPhone = (block: StorefrontBlock, rect: MobilePlacement) => {
    replace(block, { ...block, mobile: rect });
  };

  /** Recolour the whole storefront to a palette change. */
  const setPalette = (colors: Record<string, unknown>) => {
    const next = withPalette(whole(), colors);
    rest = next;
    theme = next.theme;
    header = next.header;
    blocks = [...next.blocks];
    bands = [...(next.bands ?? [])];
  };

  for (const op of ops) {
    switch (op.op) {
      case "add_product": {
        if (blocks.some((block) => block.type === "product" && block.productId === op.productId)) {
          throw new DesignOpRefused(
            `Product ${op.productId} is already on this storefront.`,
            "A product can be on a board once. Use move or resize on the tile that is there.",
          );
        }
        const { op: _op, productId, style, x, y, w, h, rotation } = op;
        void _op;
        const tile: StorefrontBlock = { type: "product", productId, ...place("product", { x, y, w, h, rotation }) };
        add(style ? restyled(tile, style) : tile);
        break;
      }
      case "add_text": {
        const { op: _op, x, y, w, h, rotation, variant, align, ...fields } = op;
        void _op;
        add({
          type: "text",
          id: mintId(),
          variant: variant ?? startingVariant(fields.text),
          align: align ?? "left",
          ...fields,
          ...place("text", { x, y, w, h, rotation }),
        });
        break;
      }
      case "add_shape": {
        const { op: _op, x, y, w, h, rotation, color: fill, ...fields } = op;
        void _op;
        add({
          type: "shape",
          id: mintId(),
          color: fill ?? theme.accent,
          ...fields,
          ...place("shape", { x, y, w, h, rotation }),
        });
        break;
      }
      case "add_image": {
        const { op: _op, x, y, w, h, rotation, file, alt, ...fields } = op;
        void _op;
        assertArtwork(file);
        add({
          type: "image",
          id: mintId(),
          key: file,
          alt: alt ?? "",
          ...fields,
          ...place("image", { x, y, w, h, rotation }),
        });
        break;
      }
      case "add_button": {
        const { op: _op, x, y, w, h, rotation, label, link: target, look } = op;
        void _op;
        add({
          type: "button",
          id: mintId(),
          label,
          // Its exact shape is the schema's to judge, after every operation.
          link: target as LinkTarget,
          ...(look && look !== "solid" ? { look } : {}),
          ...place("button", { x, y, w, h, rotation }),
        });
        break;
      }
      case "add_marquee": {
        const { op: _op, x, y, w, h, rotation, speed, ...fields } = op;
        void _op;
        add({
          type: "marquee",
          id: mintId(),
          ...fields,
          ...(speed && speed !== "normal" ? { speed } : {}),
          ...place("marquee", { x, y, w, h, rotation }),
        });
        break;
      }
      case "add_carousel": {
        const { op: _op, x, y, w, h, rotation, productIds } = op;
        void _op;
        add({ type: "carousel", id: mintId(), productIds, ...place("carousel", { x, y, w, h, rotation }) });
        break;
      }
      case "move": {
        const block = find(op.block);
        onWholeCells(block.type, [op.x, op.y], op.viewport === "mobile");
        if (op.viewport === "mobile") {
          startPhoneLayout();
          placeOnPhone(block, { ...phoneRectOf(block), x: op.x, y: op.y });
        } else if (FINE_KINDS.has(block.type)) {
          replace(block, placedAt(block, { ...drawnBox(block), x: op.x, y: op.y }));
        } else replace(block, { ...block, x: op.x, y: op.y });
        break;
      }
      case "resize": {
        const block = find(op.block);
        onWholeCells(block.type, [op.x, op.y, op.w, op.h], op.viewport === "mobile");
        assertSize(op.w, op.h);
        if (op.viewport === "mobile") {
          startPhoneLayout();
          const at = phoneRectOf(block);
          placeOnPhone(block, { x: op.x ?? at.x, y: op.y ?? at.y, w: op.w, h: op.h });
        } else if (FINE_KINDS.has(block.type)) {
          const at = drawnBox(block);
          replace(block, placedAt(block, { x: op.x ?? at.x, y: op.y ?? at.y, w: op.w, h: op.h }));
        } else replace(block, { ...block, w: op.w, h: op.h, x: op.x ?? block.x, y: op.y ?? block.y });
        break;
      }
      case "mobile_reset": {
        const block = find(op.block);
        replace(block, unpinnedOnPhone(block));
        break;
      }
      case "rotate": {
        const block = find(op.block);
        replace(block, withRotation(block, op.degrees));
        break;
      }
      case "layer": {
        blocks = LAYER_OPS[op.to as LayerOp](blocks, [blockKey(find(op.block))]);
        break;
      }
      case "style": {
        const block = find(op.block);
        if (op.viewport === "mobile") {
          // Kept beside the desktop look, for the phone board to draw instead.
          const patch = phoneStyle(block, op.changes);
          startPhoneLayout();
          replace(block, patched(block, patch));
        } else replace(block, restyled(block, op.changes));
        break;
      }
      case "remove": {
        const block = find(op.block);
        if (op.viewport === "mobile") {
          // Off phones only: it stays on the desktop board.
          startPhoneLayout();
          placeOnPhone(block, { ...phoneRectOf(block), hidden: true });
        } else blocks = blocks.filter((candidate) => candidate !== block);
        break;
      }
      case "add_band": {
        const id = op.id ?? mintId();
        if (bands.some((band) => band.id === id)) {
          throw new DesignOpRefused(`There is already a band "${id}".`, "Give the new band another id, or leave id out.");
        }
        bands = [...bands, { id, y: op.y, h: op.h, background: bandBackdrop(op.background, undefined, derivePalette(theme)) }];
        added.push(id);
        break;
      }
      case "edit_band": {
        const band = findBand(op.band);
        const next: StorefrontBand = {
          ...band,
          y: op.y ?? band.y,
          h: op.h ?? band.h,
          ...(op.background ? { background: bandBackdrop(op.background, band.background, derivePalette(theme)) } : {}),
        };
        bands = bands.map((candidate) => (candidate === band ? next : candidate));
        break;
      }
      case "remove_band": {
        const band = findBand(op.band);
        bands = bands.filter((candidate) => candidate !== band);
        break;
      }
      case "palette": {
        setPalette(op.colors);
        break;
      }
      case "theme": {
        // A palette given here recolours, exactly as the palette operation does:
        // stored on its own it would name five colours the board does not wear.
        const { palette, ...others } = op.changes;
        if (palette && typeof palette === "object") setPalette(palette as Record<string, unknown>);
        const kept = palette === undefined || (palette && typeof palette === "object") ? others : op.changes;
        theme = patched(
          theme,
          Object.fromEntries(
            Object.entries(kept).map(([field, value]) => [field, Object.hasOwn(THEME_FILES, field) ? withFile(value, THEME_FILES[field]) : value]),
          ),
        );
        break;
      }
      case "header": {
        const { logo, ...others } = op.changes;
        header = patched(header ?? EMPTY_STOREFRONT_HEADER, logo === undefined ? others : { ...others, logo: withFile(logo, assertArtwork) });
        break;
      }
    }
  }

  // A layered board stays entirely layered (see BlockPlacement.z), with what was
  // just added on top, as it would be on the designer's canvas.
  if (blocks.some((block) => block.z !== undefined)) {
    const depth = blocks.length;
    blocks = normalizeLayers(blocks.map((block) => (block.z === undefined ? { ...block, z: depth } : block)));
  }

  const edited = whole();
  assertLinksLand(edited);
  return { config: edited, added };
}

/** findFreeCell reads a block's placement and nothing else. */
function asGridBlock(block: StorefrontBlock): GridBlock<StorefrontBlock> {
  const { x, y, w, h, rotation } = block;
  return { key: blockKey(block), data: block, x, y, w, h, rotation };
}

/** What a block is, in a few words, beside where it is. Never a file key. */
function kindSummary(block: StorefrontBlock) {
  switch (block.type) {
    case "shape":
      return { kind: block.kind, color: block.color };
    case "text":
      return { text: block.text, variant: block.variant, ...(block.fontSize ? { fontSize: block.fontSize } : {}) };
    case "button":
      return { label: block.label, link: block.link, ...(block.look ? { look: block.look } : {}) };
    case "marquee":
      return { text: block.text };
    case "carousel":
      return { productIds: block.productIds };
    default:
      return {};
  }
}

/** A band's backdrop as a model plans from it: its colours, never its photo's key. */
function backdropSummary(background: BandBackground) {
  if (background.kind !== "image") return background;
  const { key: _key, ...photo } = background;
  void _key;
  return photo;
}

/** The board as an assistant needs it after a change: enough to plan the next
 *  one without reading the whole design again, and no file keys. */
export function boardSummary(config: StorefrontConfig) {
  const { theme } = config;
  return {
    columns: theme.columns,
    rows: theme.rows,
    /** The five colours to take every colour from. Derived from what the
     *  board wears until a palette is set. */
    palette: derivePalette(theme),
    ...(theme.palette ? {} : { paletteDerived: true }),
    ...(config.bands?.length
      ? { bands: config.bands.map((band) => ({ band: band.id, y: band.y, h: band.h, background: backdropSummary(band.background) })) }
      : {}),
    /** Back to front, so the last one paints on top. Where each is drawn, in
     *  cells: a .5 is a half cell. */
    blocks: layerOrder(config.blocks).map((block) => ({
      block: refOf(block),
      type: block.type,
      ...kindSummary(block),
      ...drawnBox(block),
      ...(block.rotation ? { rotation: block.rotation } : {}),
    })),
    phone: phoneSummary(config),
  };
}

/**
 * What a phone draws, in words a model can plan from. A board with a phone
 * layout says where everything is on it. One without says what happens
 * instead: the same board when it fits, the automatic reflow, or the whole
 * board shrunk when it is tilted or stacked (which nothing repacks).
 */
export function phoneSummary(config: StorefrontConfig) {
  const own = phoneLayout(config.theme, config.blocks);
  if (own) {
    return {
      layout: "own" as const,
      columns: own.columns,
      rows: own.rows,
      blocks: own.placed.map((spot) => ({
        block: refOf(spot.block),
        x: spot.x,
        y: spot.y,
        w: spot.w,
        h: spot.h,
        ...(spot.block.type === "text" && spot.block.mobileFontSize ? { fontSize: spot.block.mobileFontSize } : {}),
        ...(spot.pinned ? {} : { placedAutomatically: true }),
      })),
      hidden: own.hidden.map(refOf),
    };
  }
  const { theme, blocks } = config;
  if (isFreelyArranged(blocks)) return { layout: "scaled" as const, columns: theme.columns };
  const columns = columnsThatFit(PHONE_BOARD_WIDTH_PX, theme.gridGap, theme.columns);
  if (columns >= theme.columns) return { layout: "same" as const, columns };
  const reflowed = reflowBlocks(blocks.map(asGridBlock), theme.columns, columns);
  return {
    layout: "reflow" as const,
    columns,
    rows: reflowed.rows,
    blocks: reflowed.blocks.map((spot) => ({ block: refOf(spot.data), x: spot.x, y: spot.y, w: spot.w, h: spot.h })),
  };
}
