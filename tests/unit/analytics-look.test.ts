import { describe, expect, it } from "vitest";
import { ANALYTICS_LOOK, averageLine, sumLine } from "@/components/analytics/look";
import { runningTotal } from "@/lib/series";

// The lines the analytics page draws from a range's buckets (look.ts): each
// bucket's own figure, or the figure so far, with gaps where there is nothing
// to say.

describe("runningTotal", () => {
  it("adds up as it goes", () => {
    expect(runningTotal([3, 0, 2, 5])).toEqual([3, 3, 5, 10]);
    expect(runningTotal([])).toEqual([]);
  });
});

describe("sumLine", () => {
  it("draws each bucket's own figure when daily", () => {
    expect(sumLine([4, 0, 6], "daily")).toEqual([4, 0, 6]);
  });

  it("draws the total so far when running", () => {
    expect(sumLine([4, 0, 6], "running")).toEqual([4, 4, 10]);
  });

  it("keeps a gap a gap, and carries the total past it", () => {
    // A previous period one bucket shorter than the range (alignPrevious).
    expect(sumLine([2, null, 3], "running")).toEqual([2, null, 5]);
    expect(sumLine([2, null, 3], "daily")).toEqual([2, null, 3]);
  });
});

describe("averageLine", () => {
  const buckets = [
    { totalCents: 0, count: 0 },
    { totalCents: 3_000, count: 1 },
    { totalCents: 0, count: 0 },
    { totalCents: 5_000, count: 1 },
  ];

  it("has no average where nothing sold, daily", () => {
    expect(averageLine(buckets, "daily")).toEqual([null, 3_000, null, 5_000]);
  });

  it("is the average so far once anything sold, running", () => {
    expect(averageLine(buckets, "running")).toEqual([null, 3_000, 3_000, 4_000]);
  });

  it("rounds to whole cents", () => {
    expect(averageLine([{ totalCents: 1_000, count: 3 }], "daily")).toEqual([333]);
  });
});

describe("ANALYTICS_LOOK", () => {
  it("is the pick of 2026-11-08: Payments card and tiles, full axes, green money, ink figure", () => {
    expect(ANALYTICS_LOOK).toEqual({
      lead: "card",
      tiles: "trend",
      joined: true,
      trends: "axes",
      line: "running",
      axes: "full",
      money: "green",
      figure: "ink",
    });
  });
});
