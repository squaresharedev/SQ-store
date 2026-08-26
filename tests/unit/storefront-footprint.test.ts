import { describe, it, expect } from "vitest";
import {
  blockFootprint,
  blocksOverlap,
  isFreelyArranged,
  placementsOverlap,
  readingOrder,
  type ShapeBlock,
  type StorefrontBlock,
} from "@/types/storefront";

/**
 * The contract's own view of where a block IS.
 *
 * The storefront asks three questions of this: which cells a block covers,
 * whether two blocks touch, and whether the board as a whole has been arranged
 * in a way a narrow screen cannot honestly repack. Each has a renderer or a
 * placement decision hanging off it.
 */

function shape(
  x: number,
  y: number,
  w = 1,
  h = 1,
  extra: Partial<ShapeBlock> = {},
): ShapeBlock {
  return {
    type: "shape",
    id: `${x}-${y}-${w}-${h}`,
    kind: "square",
    color: "#000000",
    x,
    y,
    w,
    h,
    ...extra,
  };
}

describe("blockFootprint", () => {
  it("is the block's own rect when it is level", () => {
    const block = shape(1, 2, 2, 3);
    expect(blockFootprint(block)).toEqual({ x: 1, y: 2, w: 2, h: 3 });
    // Including when the field is absent entirely, which is every block on
    // every board saved before tilting existed.
    expect(blockFootprint(shape(0, 0))).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("lays a quarter-turned bar across different cells", () => {
    // The whole point: the seller turns a 1x3 bar and it now covers 3x1.
    expect(blockFootprint(shape(2, 1, 1, 3, { rotation: 90 }))).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 1,
    });
  });

  it("survives a round trip: turned and turned back is the original block", () => {
    // Why the footprint is derived and never stored. Writing it back into
    // x/y/w/h would grow the block a little on every nudge, and there would be
    // no way back to the shape the seller drew.
    const level = shape(2, 1, 1, 3);
    const turned = { ...level, rotation: 90 };
    const back = { ...turned, rotation: 0 };
    expect(blockFootprint(back)).toEqual(blockFootprint(level));
  });
});

describe("blocksOverlap", () => {
  it("sees two level blocks sharing cells", () => {
    expect(blocksOverlap(shape(0, 0, 2, 2), shape(1, 1))).toBe(true);
    expect(blocksOverlap(shape(0, 0), shape(1, 0))).toBe(false);
  });

  it("sees a turned block reaching into a neighbour it does not touch on paper", () => {
    // Their stored rects are disjoint; the tilted one PAINTS across the other.
    const bar = shape(2, 0, 1, 3, { rotation: 90 });
    const neighbour = shape(1, 1);
    expect(placementsOverlap(bar, neighbour)).toBe(false);
    expect(blocksOverlap(bar, neighbour)).toBe(true);
  });
});

describe("isFreelyArranged", () => {
  it("is false for a plain grid, which can still be repacked honestly", () => {
    expect(isFreelyArranged([shape(0, 0), shape(1, 0), shape(0, 1, 2, 1)])).toBe(
      false,
    );
    expect(isFreelyArranged([])).toBe(false);
  });

  it("is true once anything is tilted", () => {
    expect(isFreelyArranged([shape(0, 0), shape(2, 2, 1, 1, { rotation: 8 })])).toBe(
      true,
    );
  });

  it("is true once two blocks are stacked", () => {
    expect(isFreelyArranged([shape(0, 0, 2, 2), shape(1, 1)])).toBe(true);
  });

  it("does not mistake a tilt of zero for an arrangement", () => {
    // An explicit 0 should never reach storage (withRotation drops it), but a
    // board that carries one must not lose its reflow over it.
    expect(isFreelyArranged([shape(0, 0, 1, 1, { rotation: 0 })])).toBe(false);
  });

  it("compares every pair exactly once, whatever order they arrive in", () => {
    const blocks: StorefrontBlock[] = [shape(3, 3), shape(0, 0, 2, 2), shape(1, 1)];
    expect(isFreelyArranged(blocks)).toBe(true);
    expect(isFreelyArranged(readingOrder(blocks))).toBe(true);
    expect(isFreelyArranged([...blocks].reverse())).toBe(true);
  });
});
