import { orientedSpan, rotatedFootprint } from "@/lib/geometry/rotated-box";
import { blockFootprint, readingOrder, type StorefrontBlock, type StorefrontTheme } from "@/types/storefront";

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
      const w = Math.min(Math.max(1, phone.w), columns);
      const x = Math.min(Math.max(0, phone.x), columns - w);
      const rect = { x, y: Math.max(0, phone.y), w, h: Math.max(1, phone.h) };
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
