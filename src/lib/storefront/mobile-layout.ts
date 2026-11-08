import { columnsThatFit } from "@/components/grid/gridConstants";
import { orientedSpan, rotatedFootprint } from "@/lib/geometry/rotated-box";
import {
  MOBILE_COLUMNS_MAX,
  MOBILE_COLUMNS_MIN,
  blockFootprint,
  blockKey,
  readingOrder,
  type MobilePlacement,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

// THE PHONE BOARD, as pure data (types/storefront, PHONE LAYOUT). The renderer
// draws from it below MOBILE_LAYOUT_MAX_WIDTH_PX, an assistant reads it back,
// and edit operations start from it, so all three agree on where a block is on
// a phone without a browser to ask.

/** The width a board gets on a 390px phone: the page's 16px gutters taken off. */
export const PHONE_BOARD_WIDTH_PX = 358;

export type PhonePlacement = {
  block: StorefrontBlock;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Placed by its own `mobile` rect, rather than for it. */
  pinned: boolean;
};

export type PhoneLayout = {
  columns: number;
  rows: number;
  /** Reading order: pinned blocks keep their cells, the rest fill around them. */
  placed: PhonePlacement[];
  /** Left off phones by `mobile.hidden`. */
  hidden: StorefrontBlock[];
};

/**
 * The board's phone layout, or null when it has none (no `theme.mobileColumns`).
 *
 * A block with a `mobile` rect is pinned there (clamped onto the phone board, so
 * a narrower phone board never drops it). Every other block is placed for it the
 * way the automatic reflow places blocks: in reading order, its footprint scaled
 * by the column ratio, into the first cells free of anything placed before it.
 * A pinned block does not move to make room: the rest go around it.
 */
export function phoneLayout(
  theme: Pick<StorefrontTheme, "columns" | "mobileColumns">,
  blocks: readonly StorefrontBlock[],
): PhoneLayout | null {
  const columns = theme.mobileColumns;
  if (columns === undefined) return null;

  const occupied = new Set<string>();
  const cells = (x: number, y: number, w: number, h: number) => {
    const out: string[] = [];
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) out.push(`${col},${row}`);
    }
    return out;
  };
  const free = (x: number, y: number, w: number, h: number) => cells(x, y, w, h).every((cell) => !occupied.has(cell));
  const take = (x: number, y: number, w: number, h: number) => cells(x, y, w, h).forEach((cell) => occupied.add(cell));

  const ordered = readingOrder([...blocks]);
  const pinned: PhonePlacement[] = [];
  const hidden: StorefrontBlock[] = [];
  const unpinned: StorefrontBlock[] = [];
  for (const block of ordered) {
    const phone = block.mobile;
    if (phone?.hidden) hidden.push(block);
    else if (phone) {
      const rect = ontoPhone(phone, columns);
      const covered = rotatedFootprint(rect, block.rotation ?? 0);
      take(Math.max(0, covered.x), Math.max(0, covered.y), Math.min(covered.w, columns), covered.h);
      pinned.push({ block, ...rect, pinned: true });
    } else unpinned.push(block);
  }

  const ratio = columns / theme.columns;
  const auto = unpinned.map((block): PhonePlacement => {
    const covered = blockFootprint(block);
    const room = {
      w: Math.min(columns, Math.max(1, Math.round(covered.w * ratio))),
      h: Math.max(1, Math.round(covered.h * ratio)),
    };
    let x = 0;
    let y = 0;
    for (;;) {
      if (x + room.w > columns) {
        x = 0;
        y += 1;
        continue;
      }
      if (free(x, y, room.w, room.h)) break;
      x += 1;
    }
    take(x, y, room.w, room.h);
    // Back to the stored rect the footprint stands for, centred in its room:
    // the relation reflowBlocks (components/grid) uses, so a tilted block sits
    // where the automatic reflow would have put it.
    const stored = orientedSpan(room.w, room.h, block.rotation ?? 0);
    return {
      block,
      x: x + Math.round((room.w - stored.w) / 2),
      y: y + Math.round((room.h - stored.h) / 2),
      w: stored.w,
      h: stored.h,
      pinned: false,
    };
  });

  const placed = readingOrderOf([...pinned, ...auto]);
  const rows = Math.max(1, ...placed.map((spot) => spot.y + spot.h));
  return { columns, rows, placed, hidden };
}

function readingOrderOf(spots: PhonePlacement[]): PhonePlacement[] {
  return spots.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A phone rect pulled onto a phone board `columns` wide, the way it is drawn
 *  there: never wider than the board, never past an edge. */
function ontoPhone(rect: MobilePlacement, columns: number): MobilePlacement {
  const w = Math.min(Math.max(1, rect.w), columns);
  return { x: Math.min(Math.max(0, rect.x), columns - w), y: Math.max(0, rect.y), w, h: Math.max(1, rect.h) };
}

/** Where a block is on the phone board right now, given that board's layout:
 *  the rect it is drawn at, or the one it keeps while hidden. */
function rectIn(layout: PhoneLayout | null, block: StorefrontBlock): MobilePlacement {
  const spot = layout?.placed.find((candidate) => candidate.block === block);
  if (spot) return { x: spot.x, y: spot.y, w: spot.w, h: spot.h };
  const { hidden: _hidden, ...own } = block.mobile ?? { x: 0, y: 0, w: 1, h: 1 };
  void _hidden;
  return own;
}

/** Where a block is on the phone board right now: its own rect, or the one placed for it. */
export function phoneRect(
  theme: Pick<StorefrontTheme, "columns" | "mobileColumns">,
  blocks: readonly StorefrontBlock[],
  block: StorefrontBlock,
): MobilePlacement {
  return rectIn(phoneLayout(theme, blocks), block);
}

/**
 * `blocks` with each block named in `changes` (by blockKey) pinned on the phone
 * board: where it is there now, with its change laid over it. What a move, a
 * resize, a hide or a show on the designer's phone board writes. Only a change
 * that says `hidden: true` leaves the block hidden.
 */
export function pinOnPhone(
  theme: Pick<StorefrontTheme, "columns" | "mobileColumns">,
  blocks: readonly StorefrontBlock[],
  changes: ReadonlyMap<string, Partial<MobilePlacement>>,
): StorefrontBlock[] {
  const layout = phoneLayout(theme, blocks);
  return blocks.map((block) => {
    const change = changes.get(blockKey(block));
    if (!change) return block;
    const { x, y, w, h } = { ...rectIn(layout, block), ...change };
    return { ...block, mobile: { x, y, w, h, ...(change.hidden ? { hidden: true } : {}) } };
  });
}

/** A block handed back to automatic placement on phones: no rect of its own. */
export function unpinnedOnPhone(block: StorefrontBlock): StorefrontBlock {
  if (!block.mobile) return block;
  const { mobile: _mobile, ...rest } = block;
  void _mobile;
  return rest as StorefrontBlock;
}

/**
 * The board with a phone layout `columns` wide, or with none (null): back to
 * automatic. Switching it off keeps the blocks' phone rects, inert, the way the
 * theme operation does, so switching it on again brings the arrangement back.
 * A narrower phone board pulls each pinned rect onto it, as phoneLayout draws
 * it, so the board still saves.
 */
export function withPhoneColumns<Theme extends Pick<StorefrontTheme, "columns" | "mobileColumns">>(
  theme: Theme,
  blocks: StorefrontBlock[],
  columns: number | null,
): { theme: Theme; blocks: StorefrontBlock[] } {
  if (columns === null) {
    const { mobileColumns: _columns, ...automatic } = theme;
    void _columns;
    return { theme: automatic as Theme, blocks };
  }
  return {
    theme: { ...theme, mobileColumns: columns },
    blocks: blocks.map((block) =>
      block.mobile
        ? { ...block, mobile: { ...ontoPhone(block.mobile, columns), ...(block.mobile.hidden ? { hidden: true } : {}) } }
        : block,
    ),
  };
}

/** How wide a phone layout starts: the columns the automatic reflow fits on a
 *  phone, so the seller starts from the arrangement phones already get. */
export function automaticPhoneColumns(theme: Pick<StorefrontTheme, "columns" | "gridGap">): number {
  const fits = columnsThatFit(PHONE_BOARD_WIDTH_PX, theme.gridGap, theme.columns);
  return Math.min(MOBILE_COLUMNS_MAX, Math.max(MOBILE_COLUMNS_MIN, fits));
}
