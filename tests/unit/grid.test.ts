import { describe, expect, it } from "vitest";
import {
  MIN_CELL_PX,
  MIN_REFLOW_COLUMNS,
  clampToCanvas,
  columnsThatFit,
  findFreeCell,
  packFirstFit,
  placementIsFree,
  placementsOverlap,
  reflowBlocks,
  withinCanvas,
  type GridBlock,
  type GridPlacement,
} from "@/components/grid/gridConstants";

// The grid is coordinate-based: blocks carry {x, y, w, h} and are placed
// explicitly, so these cover the geometry primitives the designer and the
// storefront renderer both sit on.

const at = (x: number, y: number, w = 1, h = 1): GridPlacement => ({ x, y, w, h });

function block(key: string, x: number, y: number, w = 1, h = 1): GridBlock<null> {
  return { key, data: null, x, y, w, h };
}

describe("placementsOverlap", () => {
  it("is false for blocks that only touch edges", () => {
    expect(placementsOverlap(at(0, 0, 2, 2), at(2, 0, 2, 2))).toBe(false);
    expect(placementsOverlap(at(0, 0, 2, 2), at(0, 2, 2, 2))).toBe(false);
  });

  it("is true for any shared cell, including a single corner cell", () => {
    expect(placementsOverlap(at(0, 0, 2, 2), at(1, 1, 2, 2))).toBe(true);
  });

  it("is true when one placement fully contains another", () => {
    expect(placementsOverlap(at(0, 0, 4, 4), at(1, 1))).toBe(true);
  });

  it("is symmetric", () => {
    const a = at(1, 2, 3, 1);
    const b = at(2, 0, 1, 4);
    expect(placementsOverlap(a, b)).toBe(placementsOverlap(b, a));
  });
});

describe("withinCanvas", () => {
  it("accepts a block flush against the far edge", () => {
    expect(withinCanvas(at(4, 4, 2, 2), 6, 6)).toBe(true);
  });

  it("rejects a block that runs past an edge or sits at a negative index", () => {
    expect(withinCanvas(at(5, 0, 2, 1), 6, 6)).toBe(false);
    expect(withinCanvas(at(0, 5, 1, 2), 6, 6)).toBe(false);
    expect(withinCanvas(at(-1, 0), 6, 6)).toBe(false);
  });
});

describe("clampToCanvas", () => {
  it("slides an out-of-bounds block back in without shrinking it", () => {
    expect(clampToCanvas(at(9, 9, 2, 2), 6, 6)).toEqual({ x: 4, y: 4, w: 2, h: 2 });
  });

  it("pulls negative coordinates to the origin", () => {
    expect(clampToCanvas(at(-3, -3, 2, 2), 6, 6)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("caps a span larger than the board to the board itself", () => {
    expect(clampToCanvas(at(0, 0, 99, 99), 6, 4)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });
});

describe("placementIsFree", () => {
  const blocks = [block("a", 0, 0, 2, 2), block("b", 4, 0)];

  it("is false where an existing block already sits", () => {
    expect(placementIsFree(blocks, at(1, 1), null, 6, 6)).toBe(false);
  });

  it("ignores the block being moved, so a nudge onto its own cells is allowed", () => {
    expect(placementIsFree(blocks, at(1, 1), "a", 6, 6)).toBe(true);
  });

  it("is false outside the board even when nothing is in the way", () => {
    expect(placementIsFree(blocks, at(5, 5, 2, 2), null, 6, 6)).toBe(false);
  });
});

describe("findFreeCell", () => {
  it("scans row by row and returns the earliest fit", () => {
    const blocks = [block("a", 0, 0, 2, 1)];
    expect(findFreeCell(blocks, 1, 1, 6, 6)).toEqual({ x: 2, y: 0 });
  });

  it("skips to the next row when the remainder of this one is too narrow", () => {
    const blocks = [block("a", 0, 0, 5, 1)];
    expect(findFreeCell(blocks, 2, 1, 6, 6)).toEqual({ x: 0, y: 1 });
  });

  it("returns null when the board has no room left", () => {
    const blocks = [block("a", 0, 0, 2, 2)];
    expect(findFreeCell(blocks, 2, 2, 2, 2)).toBeNull();
  });
});

describe("packFirstFit", () => {
  it("fills a row before wrapping", () => {
    const packed = packFirstFit([{ w: 2, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 1 }], 4);
    expect(packed.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it("clamps a block wider than the board instead of dropping it", () => {
    const packed = packFirstFit([{ w: 9, h: 1 }], 4);
    expect(packed[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("reports a running row total that never decreases", () => {
    const packed = packFirstFit([{ w: 1, h: 2 }, { w: 1, h: 1 }, { w: 4, h: 1 }], 4);
    const rows = packed.map((p) => p.rows);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(rows.at(-1)).toBeGreaterThanOrEqual(2);
  });
});

describe("columnsThatFit", () => {
  it("returns the design columns when everything fits", () => {
    expect(columnsThatFit(2000, 8, 6)).toBe(6);
  });

  it("never drops below the reflow floor, however narrow the container", () => {
    expect(columnsThatFit(10, 8, 6)).toBe(MIN_REFLOW_COLUMNS);
  });

  it("falls back to the design columns for an unmeasured (zero) width", () => {
    expect(columnsThatFit(0, 8, 6)).toBe(6);
  });

  it("derives the count from the minimum readable cell size", () => {
    // Exactly three cells plus their two gutters.
    const width = MIN_CELL_PX * 3 + 8 * 2;
    expect(columnsThatFit(width, 8, 12)).toBe(3);
  });
});

describe("reflowBlocks", () => {
  it("abandons coordinates and repacks in reading order", () => {
    // Deliberately out of reading order: the lower block is listed first.
    const blocks = [block("bottom", 0, 2), block("top", 3, 0)];
    const { blocks: placed } = reflowBlocks(blocks, 6, 2);
    expect(placed.map((b) => b.key)).toEqual(["top", "bottom"]);
    expect(placed[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("scales spans by the column ratio so relative size survives", () => {
    const blocks = [block("wide", 0, 0, 6, 2), block("small", 0, 2, 3, 1)];
    const { blocks: placed } = reflowBlocks(blocks, 6, 3);
    expect(placed[0].w).toBe(3); // 6 * (3/6)
    expect(placed[1].w).toBe(2); // round(3 * 0.5)
  });

  it("keeps every block at least one cell wide and never wider than the board", () => {
    const blocks = [block("tiny", 0, 0, 1, 1), block("huge", 0, 1, 12, 1)];
    const { blocks: placed } = reflowBlocks(blocks, 12, 2);
    for (const b of placed) {
      expect(b.w).toBeGreaterThanOrEqual(1);
      expect(b.w).toBeLessThanOrEqual(2);
      expect(b.h).toBeGreaterThanOrEqual(1);
    }
  });

  it("produces a layout with no overlaps", () => {
    const blocks = [
      block("a", 0, 0, 4, 2),
      block("b", 4, 0, 2, 2),
      block("c", 0, 2, 3, 1),
      block("d", 3, 2, 3, 3),
    ];
    const { blocks: placed, rows } = reflowBlocks(blocks, 6, 3);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(placementsOverlap(placed[i], placed[j])).toBe(false);
      }
    }
    expect(rows).toBeGreaterThan(0);
  });
});
