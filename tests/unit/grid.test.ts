import { describe, expect, it } from "vitest";
import {
  MIN_CELL_PX,
  MIN_REFLOW_COLUMNS,
  blockFootprint,
  clampToCanvas,
  columnsThatFit,
  findFreeCell,
  invertReflowResize,
  liftableChromeKeys,
  packFirstFit,
  placementIsFree,
  placementsOverlap,
  reflowBlocks,
  reflowHasRoom,
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

  /**
   * A tilted block, reflowed for a small screen.
   *
   * The bug this pins: packing and scaling used the block's own STORED w/h,
   * not the cells it actually paints on once turned — the same distinction
   * `tidyBlocks` (StorefrontDesigner) already makes when it packs by
   * footprint rather than by rect. A 1x3 bar stood on its side takes THREE
   * columns of room, not one; packing it as one let the very next block in
   * reading order land where the bar's turned body still is.
   */
  describe("with a turned block", () => {
    function turned(key: string, x: number, y: number, w: number, h: number, rotation: number): GridBlock<null> {
      return { key, data: null, x, y, w, h, rotation };
    }

    it("is unaffected for a level block — rotation 0 and no rotation at all agree", () => {
      // Same placement math either way (blockFootprint treats an absent
      // rotation and an explicit 0 identically); the objects merely differ
      // in whether the redundant key rides along, which reflowBlocks never
      // strips (it only ever spreads the block it was given).
      const withZero = [turned("a", 0, 0, 6, 2, 0), block("b", 0, 2, 3, 1)];
      const withNone = [block("a", 0, 0, 6, 2), block("b", 0, 2, 3, 1)];
      const a = reflowBlocks(withZero, 6, 3);
      const b = reflowBlocks(withNone, 6, 3);
      expect(a.rows).toBe(b.rows);
      expect(a.blocks.map(({ rotation: _rotation, ...rest }) => rest)).toEqual(
        b.blocks.map(({ rotation: _rotation, ...rest }) => rest),
      );
    });

    it("packs a quarter-turned bar by the columns it actually stands across", () => {
      // A 1x3 bar turned 90 stands across THREE columns and one row — the
      // opposite of its own stored w/h. Reflowed to HALF the columns (6 to
      // 3), that footprint scales down with everything else: 3 columns of
      // room becomes round(3 * 0.5) = 2, not the pre-scale 3.
      const bar = turned("bar", 0, 0, 1, 3, 90);
      const { blocks: placed } = reflowBlocks([bar], 6, 3);
      const footprint = blockFootprint(placed[0]);
      expect(footprint.w).toBe(2);
      expect(footprint.h).toBe(1);
      // Rotation itself survives the reflow — a tilted tile is still tilted.
      expect(placed[0].rotation).toBe(90);
    });

    it("clamps the footprint to the render width even when the STORED height is what needed clamping", () => {
      // A tall bar: its stored height (8) is not bounded by designColumns at
      // all (only stored WIDTH ever is — a block can't be wider than the
      // board it is designed on). Turned 90, that height becomes the
      // FOOTPRINT WIDTH, and it is only THIS reflow that has to notice it
      // needs clamping to fit 3 render columns. Scaling and clamping the
      // stored rect directly (the bug) clamped the wrong axis — the stored
      // width, which was never the problem — and let the footprint come out
      // four columns wide on a three-column board.
      const bar = turned("bar", 0, 0, 1, 8, 90);
      const { blocks: placed } = reflowBlocks([bar], 6, 3);
      const footprint = blockFootprint(placed[0]);
      expect(footprint.w).toBeLessThanOrEqual(3);
    });

    it("does not let the block placed right after a turned one overlap its real footprint", () => {
      // Reading order puts "next" immediately after "bar". Packed by the
      // bar's stored rect (1 wide, the bug) it would land one column over —
      // inside the bar's turned body, which actually spans four once its
      // true height is accounted for and clamped to the 3-column board.
      const bar = turned("bar", 0, 0, 1, 8, 90);
      const next = block("next", 1, 0, 1, 1);
      const { blocks: placed } = reflowBlocks([bar, next], 6, 3);
      const [placedBar, placedNext] = placed;
      expect(placementsOverlap(blockFootprint(placedBar), blockFootprint(placedNext))).toBe(false);
    });

    it("holds for a whole board of mixed turned and level blocks: footprints never overlap", () => {
      const blocks = [
        turned("a", 0, 0, 1, 3, 90),
        turned("b", 0, 1, 2, 1, -90),
        block("c", 2, 0, 2, 2),
        turned("d", 4, 0, 1, 2, 270),
        block("e", 0, 3, 3, 1),
      ];
      const { blocks: placed } = reflowBlocks(blocks, 8, 4);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          expect(
            placementsOverlap(blockFootprint(placed[i]), blockFootprint(placed[j])),
            `${placed[i].key} vs ${placed[j].key}`,
          ).toBe(false);
        }
      }
    });

    it("no turned block's footprint is ever wider than the render board, across a sweep of shapes", () => {
      for (const rotation of [90, -90, 270, -270]) {
        for (const h of [1, 2, 3, 4, 6, 8, 12, 20]) {
          const bar = turned("bar", 0, 0, 1, h, rotation);
          const { blocks: placed } = reflowBlocks([bar], 6, 3);
          const footprint = blockFootprint(placed[0]);
          expect(footprint.w, `h=${h} rotation=${rotation}`).toBeLessThanOrEqual(3);
        }
      }
    });

    it("every reflowed block's own STORED rect stays on the render board", () => {
      // The rect packFirstFit actually reserved room for. A turned block's
      // FOOTPRINT can still legitimately fall outside — rotatedFootprint
      // centres and floors around a possibly off-grid centre and openly
      // reports cells off the board when a block sits flush against an edge
      // (see rotated-box.test.ts, "reports cells off the board rather than
      // quietly moving the block"); that is an existing, accepted
      // imprecision of the footprint math itself; reflow neither fixes nor
      // worsens it. What reflow owns is the STORED rect it hands back, which
      // is exactly what packFirstFit placed.
      const blocks = [
        turned("a", 0, 0, 1, 4, 90),
        turned("b", 5, 0, 3, 1, -90),
        block("c", 0, 2, 4, 2),
      ];
      const { blocks: placed, rows } = reflowBlocks(blocks, 8, 3);
      for (const b of placed) {
        expect(withinCanvas(b, 3, rows)).toBe(true);
      }
    });

    it("a rotation that is not a quarter turn is treated exactly like level — footprint equals the stored rect", () => {
      // isTransposed snaps to the NEAREST quarter turn; 20 degrees is closer
      // to level, so a 20-degree tilt reflows by its own stored w/h, same as
      // an untilted block — and the same relation blockFootprint documents
      // for every other consumer.
      const tilted = turned("t", 0, 0, 4, 2, 20);
      const level = block("t", 0, 0, 4, 2);
      const withTilt = reflowBlocks([tilted], 6, 3).blocks[0];
      const withoutTilt = reflowBlocks([level], 6, 3).blocks[0];
      expect(withTilt.w).toBe(withoutTilt.w);
      expect(withTilt.h).toBe(withoutTilt.h);
      expect(withTilt.rotation).toBe(20);
    });

    it("round-trips a swap: packing a transposed footprint and un-transposing it back gives an integer stored rect", () => {
      for (const rotation of [90, -90, 270, -270]) {
        for (const [w, h] of [[1, 3], [2, 5], [1, 1], [4, 4], [3, 7]] as const) {
          const bar = turned("bar", 0, 0, w, h, rotation);
          const { blocks: placed } = reflowBlocks([bar], 10, 4);
          expect(Number.isInteger(placed[0].w), `w h=${w},${h} rot=${rotation}`).toBe(true);
          expect(Number.isInteger(placed[0].h), `w h=${w},${h} rot=${rotation}`).toBe(true);
          expect(placed[0].w).toBeGreaterThanOrEqual(1);
          expect(placed[0].h).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});

describe("liftableChromeKeys", () => {
  /** A block at a depth: `z` is the paint order the designer resolves. */
  const layered = (
    key: string,
    z: number,
    x: number,
    y: number,
    w = 1,
    h = 1,
  ): GridBlock<null> => ({ key, data: null, x, y, w, h, z });

  it("lifts everything on a board where nothing overlaps", () => {
    // The case the lift was written for: tiles side by side, chrome hanging
    // into the gap. Raising any of them is invisible, so all of them may.
    const blocks = [
      layered("a", 0, 0, 0, 2, 2),
      layered("b", 1, 2, 0, 2, 2),
      layered("c", 2, 0, 2, 2, 2),
    ];
    expect(liftableChromeKeys(blocks)).toEqual(new Set(["a", "b", "c"]));
  });

  it("withholds the lift from a block something in front overlaps", () => {
    // The reported bug: a shape at the back under two products. Lifting it
    // would paint it over the very tiles covering it.
    const blocks = [
      layered("shape", 0, 0, 1, 5, 3),
      layered("lamp", 1, 0, 0, 2, 2),
      layered("stool", 2, 3, 0, 2, 2),
    ];
    expect(liftableChromeKeys(blocks)).toEqual(new Set(["lamp", "stool"]));
  });

  it("still lifts a block that overlaps only things BEHIND it", () => {
    // Nothing it could be painted over: it is already in front of the block
    // it covers, so raising it changes nothing on screen.
    const blocks = [
      layered("back", 0, 0, 0, 3, 3),
      layered("front", 1, 1, 1, 2, 2),
    ];
    expect(liftableChromeKeys(blocks)).toEqual(new Set(["front"]));
  });

  it("touching edges is not overlapping, so both still lift", () => {
    const blocks = [layered("a", 0, 0, 0, 2, 2), layered("b", 1, 2, 0, 2, 2)];
    expect(liftableChromeKeys(blocks)).toEqual(new Set(["a", "b"]));
  });

  it("falls back to array order when no block states a depth", () => {
    // An unlayered board paints in document order, so the LATER block is the
    // one in front and the earlier one must not lift over it.
    const blocks = [block("first", 0, 0, 2, 2), block("second", 1, 1, 2, 2)];
    expect(liftableChromeKeys(blocks)).toEqual(new Set(["second"]));
  });

  it("reads a turned block where it PAINTS, not where it is placed", () => {
    // A quarter-turned 1x3 bar lies across 3x1. It reaches the tile beside it
    // even though their stored rects never meet, so the one behind it is
    // buried by it in fact as well as on screen.
    const bar: GridBlock<null> = {
      key: "bar",
      data: null,
      x: 2,
      y: 0,
      w: 1,
      h: 3,
      z: 1,
      rotation: 90,
    };
    const under = layered("under", 0, 0, 1, 2, 1);
    expect(liftableChromeKeys([under, bar])).toEqual(new Set(["bar"]));
  });

  it("says nothing about an empty board", () => {
    expect(liftableChromeKeys([])).toEqual(new Set());
  });
});

describe("reflowHasRoom", () => {
  it("is true when width has slack", () => {
    expect(reflowHasRoom({ w: 1, h: 4 }, 4, 4)).toBe(true);
  });

  it("is true when height has slack, even at full width", () => {
    expect(reflowHasRoom({ w: 4, h: 1 }, 4, 4)).toBe(true);
  });

  it("is false only once BOTH dimensions already fill the repacked board", () => {
    expect(reflowHasRoom({ w: 4, h: 4 }, 4, 4)).toBe(false);
  });
});

describe("invertReflowResize", () => {
  // A 6-column design reflowed to 4 columns for a phone-width preview — the
  // same numbers 43-mobile-tile-chrome.spec.ts drives end to end.
  const ratio = 4 / 6;

  it("scales a grow by reflow's own ratio, not 1:1", () => {
    // Grew by one shown cell (1 -> 2) on the repacked board; the stored
    // block is twice as wide in real columns as it is on the phone, so the
    // same one-cell tug is worth two stored columns.
    const origin = at(0, 0, 1, 1);
    const derived = at(0, 0, 2, 1);
    const real = at(0, 0, 2, 1);
    expect(invertReflowResize(origin, derived, real, ratio, 6, 3)).toEqual(
      at(0, 0, 4, 1),
    );
  });

  it("leaves the placement untouched when the gesture never moved", () => {
    const origin = at(1, 0, 2, 1);
    const real = at(1, 0, 3, 1);
    expect(invertReflowResize(origin, origin, real, ratio, 6, 3)).toEqual(real);
  });

  it("never shrinks a dimension below one cell", () => {
    // Shrunk from 2 to 1 on the repacked board (a whole shown cell), but the
    // stored width is already at its floor.
    const origin = at(0, 0, 2, 1);
    const derived = at(0, 0, 1, 1);
    const real = at(0, 0, 1, 1);
    expect(invertReflowResize(origin, derived, real, ratio, 6, 3).w).toBe(1);
  });

  it("clamps the result to the STORED board, not the repacked one", () => {
    // A huge shown-cell grow would overflow a 6-column design; the inverted
    // result still has to fit on it.
    const origin = at(0, 0, 1, 1);
    const derived = at(0, 0, 4, 1);
    const real = at(0, 0, 1, 1);
    const result = invertReflowResize(origin, derived, real, ratio, 6, 3);
    expect(result.w).toBeLessThanOrEqual(6);
    expect(result.x + result.w).toBeLessThanOrEqual(6);
  });

  it("carries a shift in x/y through the same scale (the flip-past-anchor case)", () => {
    const origin = at(2, 0, 2, 1);
    const derived = at(1, 0, 3, 1); // grew left by one shown cell
    const real = at(3, 0, 3, 1);
    const result = invertReflowResize(origin, derived, real, ratio, 6, 3);
    // One shown cell of leftward growth is ~1.5 stored columns, rounded to 2.
    expect(result.x).toBe(1);
    expect(result.w).toBe(5);
  });
});
