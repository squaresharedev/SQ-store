import { toHalves, type GridInset } from "@/components/grid/gridConstants";
import {
  BUTTON_LABEL_MAX,
  blockFine,
  boardProductIds,
  type BlockPlacement,
  type ButtonBlock,
  type FinePlacement,
  type HeaderLink,
  type LinkTarget,
  type StorefrontBand,
  type StorefrontBlock,
} from "@/types/storefront";

// The layout workstream's edits to BLOCKS, as pure data: half-cell insets
// (FinePlacement), new buttons, and keeping links pointed at things that
// exist. Shared by the designer and anything else that edits a board.

/** Can this kind of block carry half-cell insets? Text, shapes and buttons:
 *  small things that need placing between cells. Product cards never. */
export function takesFine(block: Pick<StorefrontBlock, "type">): boolean {
  return block.type === "text" || block.type === "shape" || block.type === "button";
}

/**
 * A block with its half-cell insets set, or dropped when there are none (the
 * key goes, rather than storing an empty object, so a block back on whole
 * cells is byte-identical to one that never left them). Kinds that cannot
 * carry insets come back unchanged.
 */
export function withFine<T extends StorefrontBlock>(block: T, inset: GridInset | FinePlacement | undefined): T {
  if (!takesFine(block)) return block;
  const fine: FinePlacement = {};
  if (inset?.left) fine.left = true;
  if (inset?.right) fine.right = true;
  if (inset?.top) fine.top = true;
  if (inset?.bottom) fine.bottom = true;
  const { fine: _old, ...rest } = block as T & { fine?: FinePlacement };
  void _old;
  return (Object.keys(fine).length > 0 ? { ...rest, fine } : rest) as T;
}

/** Where a new button leads before the seller says: the board's first
 *  product, else its first band, else this storefront's own page. Always a
 *  link the schema accepts, so a board with a fresh button still saves. */
export function defaultButtonLink(
  blocks: readonly StorefrontBlock[],
  bands: readonly StorefrontBand[],
  storefrontId: string,
): LinkTarget {
  const product = boardProductIds(blocks)[0];
  if (product) return { kind: "product", productId: product };
  if (bands[0]) return { kind: "band", bandId: bands[0].id };
  return { kind: "storefront", storefrontId };
}

/**
 * A new button block: two cells wide and HALF a cell tall (a whole cell is far
 * taller than a button), leading wherever defaultButtonLink says.
 */
export function newButtonBlock(
  id: string,
  placement: BlockPlacement,
  label: string,
  link: LinkTarget,
): ButtonBlock {
  return {
    type: "button",
    id,
    label: label.slice(0, BUTTON_LABEL_MAX),
    link,
    ...placement,
    ...(placement.h === 1 ? { fine: { bottom: true } } : {}),
  };
}

/** Does this link still lead to something on this board (a product it shows,
 *  a band it has)? Storefronts and addresses are not the board's to answer. */
export function linkLeadsSomewhere(
  link: LinkTarget,
  shown: ReadonlySet<string>,
  bands: readonly StorefrontBand[],
): boolean {
  if (link.kind === "product") return shown.has(link.productId);
  if (link.kind === "band") return bands.some((band) => band.id === link.bandId);
  return true;
}

/**
 * The board with every button whose product or band has gone taken away too.
 * Run where blocks are removed, so a removed product never leaves a button
 * the schema would refuse to save (the board shows what will be saved; undo
 * brings both back).
 */
export function withoutDeadLinks(blocks: StorefrontBlock[], bands: readonly StorefrontBand[]): StorefrontBlock[] {
  const shown = new Set(boardProductIds(blocks));
  const kept = blocks.filter((block) => block.type !== "button" || linkLeadsSomewhere(block.link, shown, bands));
  return kept.length === blocks.length ? blocks : kept;
}

/** The header's menu without entries whose product or band has gone. */
export function liveHeaderLinks(
  links: readonly HeaderLink[] | undefined,
  blocks: readonly StorefrontBlock[],
  bands: readonly StorefrontBand[],
): HeaderLink[] | undefined {
  if (!links) return undefined;
  const shown = new Set(boardProductIds(blocks));
  return links.filter((entry) => linkLeadsSomewhere(entry.link, shown, bands));
}

/** A button with some of its own fields changed. The look drops back to
 *  absent at its default (solid), so an untouched button stores none. */
export function withButtonPatch(
  block: ButtonBlock,
  patch: Partial<Pick<ButtonBlock, "label" | "link" | "look">>,
): ButtonBlock {
  const next = { ...block, ...patch };
  if (next.look === "solid") {
    const { look: _look, ...rest } = next;
    void _look;
    return rest;
  }
  return next;
}

/**
 * The header as a save stores it: menu entries whose product or band has gone
 * are left out (and the menu key with them once it is empty), so taking a
 * product off the board never leaves a storefront the schema refuses to save.
 * Returned unchanged when nothing has gone.
 */
export function headerForSave<H extends { links?: HeaderLink[] }>(
  header: H,
  blocks: readonly StorefrontBlock[],
  bands: readonly StorefrontBand[],
): H {
  if (!header.links) return header;
  const kept = liveHeaderLinks(header.links, blocks, bands) ?? [];
  if (kept.length === header.links.length) return header;
  const { links: _links, ...rest } = header;
  void _links;
  return (kept.length > 0 ? { ...rest, links: kept } : rest) as H;
}

/**
 * isFreelyArranged (types/storefront), asked of what is DRAWN: a tilted block,
 * or two blocks whose painted boxes overlap. The same answer for every board
 * without half-cell insets, where a block is drawn on exactly its cells; with
 * them, two halves sharing a cell (a caption under a button, side by side in
 * one row) are not a stack, and the board still reflows on a phone.
 */
export function isFreelyArrangedAsDrawn(blocks: readonly StorefrontBlock[]): boolean {
  if (blocks.some((block) => (block.rotation ?? 0) !== 0)) return true;
  const boxes = blocks.map((block) => toHalves(block, blockFine(block)));
  return boxes.some((a, index) =>
    boxes.some((b, other) => other > index && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b),
  );
}
