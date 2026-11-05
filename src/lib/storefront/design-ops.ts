import { z } from "zod";
import { clampToCanvas, columnsThatFit, findFreeCell, reflowBlocks, type GridBlock } from "@/components/grid/gridConstants";
import { LAYER_OPS, normalizeLayers, type LayerOp } from "@/lib/storefront/layers";
import { PHONE_BOARD_WIDTH_PX, phoneLayout } from "@/lib/storefront/mobile-layout";
import {
  BLUR_DIRECTIONS,
  BLUR_MAX,
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_DEFAULT,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
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
  blockKey,
  isFreelyArranged,
  layerOrder,
  mergeCardStyleOverrides,
  withRotation,
  type CardStyleOverrides,
  type MobilePlacement,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";

// EDITING A BOARD ONE CHANGE AT A TIME, as pure data. No session, no database,
// so the rules are unit-testable. An assistant states what should change ("move
// this block there", "make that shape a star") and never has to resend blocks
// it was not asked about, so it cannot lose them by retyping them wrong.
//
// Nothing is judged here beyond what these operations alone can know. The result
// goes through storefrontConfigSchema and saveStorefront, the same as a save from
// the designer, which is what bounds every value and keeps a block on the board.

/** Where a new block goes. Leave out x and y to take the next free cells. */
const placement = {
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  w: z.number().int().optional(),
  h: z.number().int().optional(),
  rotation: z.number().int().optional().describe("Clockwise degrees."),
};

const blockRef = z
  .string()
  .max(64)
  .describe("Which block: its id, or the productId for a product tile, as get_storefront shows them.");

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

export const designOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add_product"),
    productId: z.uuid(),
    ...placement,
    style: changes.optional(),
  }),
  z.strictObject({
    op: z.literal("add_text"),
    text: z.string().max(300),
    variant: z.enum(TEXT_VARIANTS).optional(),
    align: z.enum(TEXT_ALIGNS).optional(),
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
    ...placement,
  }),
  z.strictObject({
    op: z.literal("add_image"),
    file: z.string().max(200).describe("An upload_id from upload_element."),
    alt: z.string().max(200).optional().describe("What it shows, for screen readers. Empty for decoration."),
    fit: z.enum(IMAGE_FITS).optional(),
    opacity: z.number().int().optional(),
    blur,
    blurDirection,
    ...placement,
  }),
  z.strictObject({ op: z.literal("move"), block: blockRef, x: z.number().int(), y: z.number().int(), viewport }),
  z.strictObject({
    op: z.literal("resize"),
    block: blockRef,
    w: z.number().int(),
    h: z.number().int(),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
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

/** What a style change may not reach: where a block is has its own operations,
 *  and what a block is does not change. */
const NOT_STYLE = new Set(["type", "id", "productId", "key", "x", "y", "w", "h", "rotation", "z", "mobile", "mobileFontSize"]);

/** What a block's look may be on the phone board alone, and the field that keeps it. */
const PHONE_STYLE: Partial<Record<StorefrontBlock["type"], Record<string, string>>> = {
  text: { fontSize: "mobileFontSize" },
};

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

function restyled(block: StorefrontBlock, patch: Fields): StorefrontBlock {
  for (const field of Object.keys(patch)) {
    if (NOT_STYLE.has(field)) {
      throw new DesignOpRefused(
        `"${field}" cannot be changed with a style operation.`,
        "Use move, resize, rotate or layer for where a block is. To replace one, remove it and add another.",
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
      return patched(block, file === undefined ? rest : { ...rest, key: file });
    }
    default:
      return patched(block, patch);
  }
}

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
  let theme = config.theme;
  let header = config.header;
  let blocks = [...config.blocks];
  const added: string[] = [];

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
  const replace = (block: StorefrontBlock, next: StorefrontBlock) => {
    blocks = blocks.map((candidate) => (candidate === block ? next : candidate));
  };

  /** The designer's rule: the cells asked for, or the next free ones, or a new
   *  row at the bottom, and only a full board at its tallest stacks. */
  const place = (spot: { x?: number; y?: number; w?: number; h?: number; rotation?: number }, defaultW = 1) => {
    const w = spot.w ?? Math.min(defaultW, theme.columns);
    const h = spot.h ?? 1;
    const rotation = spot.rotation ?? 0;
    const at = { w, h, ...(rotation ? { rotation } : {}) };
    if (spot.x !== undefined && spot.y !== undefined) return { ...at, x: spot.x, y: spot.y };
    const free = findFreeCell(blocks.map(asGridBlock), w, h, theme.columns, theme.rows, rotation);
    if (free) return { ...at, ...free };
    const grown = Math.min(CANVAS_ROWS_MAX, theme.rows + h);
    const below = grown > theme.rows ? findFreeCell(blocks.map(asGridBlock), w, h, theme.columns, grown, rotation) : null;
    if (below) {
      theme = { ...theme, rows: grown };
      return { ...at, ...below };
    }
    return { ...at, ...clampToCanvas({ x: spot.x ?? 0, y: spot.y ?? 0, w, h }, theme.columns, theme.rows) };
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
  const phoneRect = (block: StorefrontBlock): MobilePlacement => {
    const spot = phoneLayout(theme, blocks)?.placed.find((candidate) => candidate.block === block);
    if (spot) return { x: spot.x, y: spot.y, w: spot.w, h: spot.h };
    const { hidden: _hidden, ...own } = block.mobile ?? { x: 0, y: 0, w: 1, h: 1 };
    void _hidden;
    return own;
  };
  const placeOnPhone = (block: StorefrontBlock, rect: MobilePlacement) => {
    replace(block, { ...block, mobile: rect });
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
        const tile: StorefrontBlock = { type: "product", productId, ...place({ x, y, w, h, rotation }) };
        add(style ? restyled(tile, style) : tile);
        break;
      }
      case "add_text": {
        const { op: _op, x, y, w, h, rotation, variant, align, ...fields } = op;
        void _op;
        add({
          type: "text",
          id: mintId(),
          variant: variant ?? "heading",
          align: align ?? "left",
          ...fields,
          ...place({ x, y, w, h, rotation }, 2),
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
          ...place({ x, y, w, h, rotation }),
        });
        break;
      }
      case "add_image": {
        const { op: _op, x, y, w, h, rotation, file, alt, ...fields } = op;
        void _op;
        add({
          type: "image",
          id: mintId(),
          key: file,
          alt: alt ?? "",
          ...fields,
          ...place({ x, y, w, h, rotation }),
        });
        break;
      }
      case "move": {
        const block = find(op.block);
        if (op.viewport === "mobile") {
          startPhoneLayout();
          placeOnPhone(block, { ...phoneRect(block), x: op.x, y: op.y });
        } else replace(block, { ...block, x: op.x, y: op.y });
        break;
      }
      case "resize": {
        const block = find(op.block);
        if (op.viewport === "mobile") {
          startPhoneLayout();
          const at = phoneRect(block);
          placeOnPhone(block, { x: op.x ?? at.x, y: op.y ?? at.y, w: op.w, h: op.h });
        } else replace(block, { ...block, w: op.w, h: op.h, x: op.x ?? block.x, y: op.y ?? block.y });
        break;
      }
      case "mobile_reset": {
        const block = find(op.block);
        const { mobile: _mobile, ...rest } = block;
        void _mobile;
        replace(block, rest as StorefrontBlock);
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
          placeOnPhone(block, { ...phoneRect(block), hidden: true });
        } else blocks = blocks.filter((candidate) => candidate !== block);
        break;
      }
      case "theme": {
        theme = patched(theme, op.changes);
        break;
      }
      case "header": {
        header = patched(header ?? EMPTY_STOREFRONT_HEADER, op.changes);
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

  return { config: { ...config, theme, header, blocks }, added };
}

/** findFreeCell reads a block's placement and nothing else. */
function asGridBlock(block: StorefrontBlock): GridBlock<StorefrontBlock> {
  const { x, y, w, h, rotation } = block;
  return { key: blockKey(block), data: block, x, y, w, h, rotation };
}

/** The board as an assistant needs it after a change: enough to plan the next
 *  one without reading the whole design again, and no file keys. */
export function boardSummary(config: StorefrontConfig) {
  return {
    columns: config.theme.columns,
    rows: config.theme.rows,
    /** Back to front, so the last one paints on top. */
    blocks: layerOrder(config.blocks).map((block) => ({
      block: refOf(block),
      type: block.type,
      ...(block.type === "shape" ? { kind: block.kind, color: block.color } : {}),
      ...(block.type === "text" ? { text: block.text, ...(block.fontSize ? { fontSize: block.fontSize } : {}) } : {}),
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
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
