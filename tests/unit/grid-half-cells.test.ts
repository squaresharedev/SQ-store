import { describe, expect, it } from "vitest";
import {
  HALF_STEP_SPAN_MAX,
  cellPaintStyle,
  drawnInset,
  drawnPlacement,
  followRows,
  fromHalves,
  halfStepSizes,
  hasInset,
  moveHalfBox,
  resizeHalfBox,
  resizeHalfCorner,
  roundToStep,
  toHalves,
  underlayBehind,
  type GridBlock,
} from "@/components/grid/gridConstants";

// HALF-CELL INSETS and FULL-ROW UNDERLAYS: the grid's two new pieces of
// geometry. A block never leaves its whole cells; insets only pull its paint
// in, and an underlay follows the blocks on it once the board is repacked.

const at = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });
const block = (key: string, x: number, y: number, w = 1, h = 1): GridBlock<null> => ({ key, data: null, x, y, w, h });

describe("half-cell lines", () => {
  it("round-trip a placement and its insets", () => {
    const cases = [
      { placement: at(2, 1, 1, 1), inset: { right: true, bottom: true } },
      { placement: at(0, 0, 3, 2), inset: { left: true, top: true } },
      { placement: at(4, 3, 2, 1), inset: undefined },
    ];
    for (const { placement, inset } of cases) {
      expect(fromHalves(toHalves(placement, inset))).toEqual({ placement, inset });
    }
  });

  it("put a box back on the smallest run of cells that holds it", () => {
    // A whole cell moved half a cell right now reaches into two cells.
    expect(fromHalves({ l: 1, r: 3, t: 0, b: 2 })).toEqual({ placement: at(0, 0, 2, 1), inset: { left: true, right: true } });
    // Half a cell at the right of cell 2.
    expect(fromHalves({ l: 5, r: 6, t: 4, b: 6 })).toEqual({ placement: at(2, 2, 1, 1), inset: { left: true } });
  });

  it("never pull a one-cell side in from both ends", () => {
    expect(drawnInset({ left: true, right: true }, 1, 1)).toEqual({ left: true });
    expect(drawnInset({ top: true, bottom: true }, 2, 1)).toEqual({ top: true });
    expect(drawnInset({ left: true, right: true }, 2, 1)).toEqual({ left: true, right: true });
    expect(drawnInset({}, 1, 1)).toBeUndefined();
    expect(hasInset({ left: false } as never)).toBe(false);
  });

  it("say where a block is drawn, in cells", () => {
    expect(drawnPlacement(at(1, 1, 2, 1), { left: true, bottom: true })).toEqual({ x: 1.5, y: 1, w: 1.5, h: 0.5 });
    expect(drawnPlacement(at(1, 1, 2, 1))).toEqual(at(1, 1, 2, 1));
  });
});

describe("half steps", () => {
  it("are half a cell along an axis the block is small on, a whole cell along any other", () => {
    expect(halfStepSizes(toHalves(at(0, 0, 1, 1)))).toEqual({ x: 1, y: 1 });
    expect(halfStepSizes(toHalves(at(0, 0, HALF_STEP_SPAN_MAX + 1, 1)))).toEqual({ x: 2, y: 1 });
    expect(roundToStep(2.6, 1)).toBe(3);
    expect(roundToStep(2.6, 2)).toBe(2);
    expect(roundToStep(3.2, 2)).toBe(4);
  });

  it("move a box as one body, stopping at the board's edge", () => {
    const box = toHalves(at(0, 0, 1, 1), { right: true });
    expect(moveHalfBox(box, 1, 0, 6, 6)).toEqual({ l: 1, r: 2, t: 0, b: 2 });
    expect(moveHalfBox(box, -3, -3, 6, 6)).toEqual(box);
    expect(moveHalfBox(toHalves(at(5, 5)), 4, 4, 6, 6)).toEqual(toHalves(at(5, 5)));
  });

  it("stretch the dragged edges only, never below half a cell or past the board", () => {
    const box = toHalves(at(1, 1, 1, 1));
    expect(resizeHalfBox(box, { n: false, e: true, s: false, w: false }, { x: 5, y: 0 }, 6, 6)).toEqual({ ...box, r: 5 });
    expect(resizeHalfBox(box, { n: false, e: true, s: true, w: false }, { x: 0, y: 0 }, 6, 6)).toEqual({ ...box, r: box.l + 1, b: box.t + 1 });
    expect(resizeHalfBox(box, { n: true, e: false, s: false, w: true }, { x: -4, y: -4 }, 6, 6)).toEqual({ ...box, l: 0, t: 0 });
    expect(resizeHalfBox(box, { n: false, e: true, s: false, w: false }, { x: 99, y: 0 }, 6, 6).r).toBe(12);
  });

  it("flip the corner handle past the anchor cell, the way the whole-cell handle does", () => {
    const box = toHalves(at(1, 1, 1, 1));
    // Out: the far corner follows the hand.
    expect(resizeHalfCorner(box, { x: 6, y: 5 }, 6, 6)).toEqual({ l: 2, t: 2, r: 6, b: 5 });
    // Not yet past the anchor cell: as small as half a cell, no flip.
    expect(resizeHalfCorner(box, { x: 3, y: 3 }, 6, 6)).toEqual({ l: 2, t: 2, r: 3, b: 3 });
    // One whole cell back, left and up: the span lands on the other side of the
    // anchor cell, which stays inside it.
    expect(resizeHalfCorner(box, { x: 2, y: 2 }, 6, 6)).toEqual({ l: 0, t: 0, r: 4, b: 4 });
    // Each axis on its own.
    expect(resizeHalfCorner(box, { x: 2, y: 5 }, 6, 6)).toEqual({ l: 0, t: 2, r: 4, b: 5 });
    // Held to the board.
    expect(resizeHalfCorner(box, { x: -9, y: -9 }, 6, 6)).toEqual({ l: 0, t: 0, r: 4, b: 4 });
  });
});

describe("a cell's paint", () => {
  it("is nothing new for a level block on its own cells", () => {
    expect(cellPaintStyle(at(0, 0, 2, 2), { x: 0, y: 0 }, undefined)).toEqual({});
  });

  it("keeps the turned block's nudge where it was before insets, the vertical one as a length", () => {
    // `top` is in row pitches, not a percentage of the area: WebKit ignores a
    // percentage `top` on a grid item. A pitch is the same either way.
    expect(cellPaintStyle(at(0, 0, 2, 3), { x: 0.5, y: -1 }, undefined)).toEqual({
      left: "calc((100% + var(--grid-gap, 0px)) * 0.5 / 2)",
      top: "calc((var(--ss-cell) + var(--grid-gap, 0px)) * -1)",
    });
  });

  it("pulls an inset side in by half a pitch, in the block's own area", () => {
    expect(cellPaintStyle(at(0, 0, 2, 1), { x: 0, y: 0 }, { left: true, bottom: true })).toEqual({
      left: "calc((100% + var(--grid-gap, 0px)) * 0.5 / 2)",
      width: "calc(100% - calc((100% + var(--grid-gap, 0px)) * 0.5 / 2))",
      height: "calc(100% - calc((100% + var(--grid-gap, 0px)) * 0.5 / 1))",
    });
    expect(cellPaintStyle(at(0, 0, 3, 1), { x: 0, y: 0 }, { left: true, right: true }).width).toBe(
      "calc(100% - calc((100% + var(--grid-gap, 0px)) * 1 / 3))",
    );
  });
});

describe("an underlay on a repacked board", () => {
  it("runs from its lead block to every member touching it", () => {
    const placed = [block("a", 0, 0, 2, 1), block("b", 2, 1, 1, 2), block("c", 0, 3)];
    expect(followRows(["a", "b", "c"], placed)).toEqual({ y: 0, h: 4 });
    expect(followRows(["b", "a"], placed)).toEqual({ y: 0, h: 3 });
  });

  it("leaves off a member the layout put somewhere else, rather than stretching over everything", () => {
    const placed = [block("lead", 0, 5, 2, 1), block("strayed", 3, 1), block("other", 0, 2, 4, 2)];
    expect(followRows(["lead", "strayed"], placed)).toEqual({ y: 5, h: 1 });
  });

  it("is not drawn with none of its blocks on the board", () => {
    expect(followRows([], [block("a", 0, 0)])).toBeNull();
    expect(followRows(["gone"], [block("a", 0, 0)])).toBeNull();
  });

  it("is behind a block by its middle row, the later one on top", () => {
    const strips = [{ key: "one", y: 0, h: 2 }, { key: "two", y: 1, h: 2 }];
    expect(underlayBehind(strips, at(0, 0))).toBe("one");
    expect(underlayBehind(strips, at(0, 1))).toBe("two");
    expect(underlayBehind(strips, at(0, 4))).toBeNull();
    expect(underlayBehind(strips, at(0, 2, 1, 3))).toBeNull();
  });
});
