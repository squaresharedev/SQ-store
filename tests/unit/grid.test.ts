import { describe, expect, it } from "vitest";
import {
  GRID_SIZES,
  MAX_COL_SPAN,
  MAX_ROW_SPAN,
  SIZE_LABELS,
  SIZE_SPANS,
  clampSpanToColumns,
  snapToSize,
  trailingPlaceholderCount,
  type GridSpan,
} from "@/components/grid/gridConstants";
import { BLOCK_SIZES } from "@/types/storefront";

describe("size model", () => {
  it("grid sizes and storefront BLOCK_SIZES are the same closed set", () => {
    expect([...GRID_SIZES]).toEqual([...BLOCK_SIZES]);
  });

  it("SIZE_SPANS parses every size correctly", () => {
    expect(SIZE_SPANS["1x1"]).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(SIZE_SPANS["3x1"]).toEqual({ colSpan: 3, rowSpan: 1 });
    expect(SIZE_SPANS["1x3"]).toEqual({ colSpan: 1, rowSpan: 3 });
    expect(SIZE_SPANS["3x3"]).toEqual({ colSpan: 3, rowSpan: 3 });
  });

  it("every size has an a11y label matching its span", () => {
    for (const size of GRID_SIZES) {
      const { colSpan, rowSpan } = SIZE_SPANS[size];
      expect(SIZE_LABELS[size]).toBe(`${colSpan} wide by ${rowSpan} tall`);
    }
  });
});

describe("snapToSize", () => {
  it("rounds fractional drags to the nearest size", () => {
    expect(snapToSize(1.4, 1.4)).toBe("1x1");
    expect(snapToSize(1.5, 1.0)).toBe("2x1");
    expect(snapToSize(2.49, 2.51)).toBe("2x3");
  });

  it("clamps below 1 up to 1", () => {
    expect(snapToSize(0, 0)).toBe("1x1");
    expect(snapToSize(-5, 0.2)).toBe("1x1");
  });

  it("clamps above the max span down to 3", () => {
    expect(snapToSize(99, 1)).toBe("3x1");
    expect(snapToSize(4, 4)).toBe("3x3");
    expect(snapToSize(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe("3x3");
  });

  it("NaN degrades to a valid member of the set, never garbage", () => {
    const result = snapToSize(Number.NaN, Number.NaN);
    expect(GRID_SIZES).toContain(result);
  });

  it("always returns a member of GRID_SIZES for a sweep of inputs", () => {
    for (let c = -2; c <= 6; c += 0.25) {
      for (let r = -2; r <= 6; r += 0.25) {
        expect(GRID_SIZES).toContain(snapToSize(c, r));
      }
    }
  });

  it("MAX spans agree with the size set", () => {
    const maxCol = Math.max(...GRID_SIZES.map((s) => SIZE_SPANS[s].colSpan));
    const maxRow = Math.max(...GRID_SIZES.map((s) => SIZE_SPANS[s].rowSpan));
    expect(MAX_COL_SPAN).toBe(maxCol);
    expect(MAX_ROW_SPAN).toBe(maxRow);
  });
});

describe("clampSpanToColumns", () => {
  it("clamps a 3-wide block into a 2-column layout", () => {
    expect(clampSpanToColumns({ colSpan: 3, rowSpan: 2 }, 2)).toEqual({
      colSpan: 2,
      rowSpan: 2,
    });
  });

  it("leaves spans alone when they fit", () => {
    expect(clampSpanToColumns({ colSpan: 2, rowSpan: 1 }, 4)).toEqual({
      colSpan: 2,
      rowSpan: 1,
    });
  });

  it("never emits a span below 1 in either axis", () => {
    expect(clampSpanToColumns({ colSpan: 0, rowSpan: 0 }, 1)).toEqual({
      colSpan: 1,
      rowSpan: 1,
    });
  });
});

describe("trailingPlaceholderCount", () => {
  const s = (colSpan: number, rowSpan: number): GridSpan => ({ colSpan, rowSpan });

  it("empty grid gets no placeholders", () => {
    expect(trailingPlaceholderCount([], 4, 1)).toBe(0);
  });

  it("a full single row needs only the growth row", () => {
    // 4 × 1x1 in 4 columns → row is complete; 1 growth row = 4 cells.
    expect(trailingPlaceholderCount([s(1, 1), s(1, 1), s(1, 1), s(1, 1)], 4, 1)).toBe(4);
  });

  it("a partial row is completed plus the growth row", () => {
    // one 1x1 in 4 columns → 3 to complete the row + 4 growth.
    expect(trailingPlaceholderCount([s(1, 1)], 4, 1)).toBe(7);
  });

  it("tall blocks leave holes that count as empty cells", () => {
    // 2x2 + 1x1 in 4 columns: occupied rows = 2, area = 5 → 8 - 5 = 3 empty + 4 growth.
    expect(trailingPlaceholderCount([s(2, 2), s(1, 1)], 4, 1)).toBe(7);
  });

  it("zero growth rows yields only the row-completion cells", () => {
    expect(trailingPlaceholderCount([s(1, 1)], 4, 0)).toBe(3);
  });

  it("spans wider than the column count are clamped in the math (no negative empties)", () => {
    const n = trailingPlaceholderCount([s(3, 1)], 2, 0);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
