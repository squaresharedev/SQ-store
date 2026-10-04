import { describe, expect, it } from "vitest";
import { heroCeiling, heroSide } from "@/components/analytics/revenue-hero-layout";
import { niceTicks } from "@/components/charts/scale";

// The revenue hero lays its figure over the chart. Two rules keep that
// readable, and both are decided here: which top corner the figure takes, and
// how high the value axis has to reach so the line never runs under it.

describe("heroSide", () => {
  it("puts the figure top left when the graph is going up", () => {
    expect(heroSide([10, 20, 30, 40, 50, 60])).toBe("left");
  });

  it("puts the figure top right when the graph is going down", () => {
    expect(heroSide([60, 50, 40, 30, 20, 10])).toBe("right");
  });

  it("follows where the room is, not the overall slope", () => {
    // Climbing all month, but day two was the biggest day of it: the free
    // corner is the right one, and a slope would have said left.
    expect(heroSide([10, 900, 20, 30, 40, 50, 60, 70, 80])).toBe("right");
  });

  it("goes left on a tie, and when there is nothing to compare", () => {
    expect(heroSide([40, 40, 40, 40])).toBe("left");
    expect(heroSide([40])).toBe("left");
    expect(heroSide([])).toBe("left");
  });
});

describe("heroCeiling", () => {
  const rising = [100, 120, 150, 200, 400, 700, 900, 1000];

  it("leaves a little air above the peak when the figure covers nothing tall", () => {
    // The figure sits over the first two points (100, 120) and the neighbour
    // just past its edge (150): far below the peak, so the peak sets the axis.
    const ceiling = heroCeiling(rising, { from: 0, to: 0.2, depth: 0.3 });
    expect(ceiling).toBeCloseTo(1060, 5);
  });

  it("raises the axis until the line under the figure clears it", () => {
    // The figure reaches halfway down the plot over a stretch that peaks at
    // 700, so 700 has to land at or below the halfway mark.
    const ceiling = heroCeiling(rising, { from: 0, to: 0.7, depth: 0.5 });
    expect(ceiling).toBeCloseTo(1400, 5);
    expect(700 / ceiling).toBeLessThanOrEqual(0.5);
  });

  it("counts the point just outside the figure's edge", () => {
    // The edge falls between the 3rd and 4th points; the curve between them
    // passes under the figure, so the 4th point is part of the stretch.
    const values = [10, 10, 10, 800, 10, 10, 10];
    const ceiling = heroCeiling(values, { from: 0, to: 0.4, depth: 0.5 });
    expect(ceiling).toBeCloseTo(1600, 5);
  });

  it("never flattens the line for a figure deeper than the plot allows", () => {
    const ceiling = heroCeiling([500, 500], { from: 0, to: 1, depth: 5 });
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(ceiling).toBeCloseTo(2000, 5);
  });

  it("is zero for a series with nothing in it", () => {
    expect(heroCeiling([], { from: 0, to: 0.5, depth: 0.3 })).toBe(0);
    expect(heroCeiling([0, 0, 0], { from: 0, to: 0.5, depth: 0.3 })).toBe(0);
  });
});

describe("niceTicks", () => {
  it("steps in round amounts and never past the top of the axis", () => {
    expect(niceTicks(30)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(niceTicks(9)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0.9)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("keeps money steps to whole units of the currency", () => {
    // Integer cents. A 50 cent step would print the same whole amount on two
    // gridlines, so a small axis steps by whole euros instead.
    expect(niceTicks(450, 100)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(127_200, 100)).toEqual([0, 20_000, 40_000, 60_000, 80_000, 100_000, 120_000]);
    for (const tick of niceTicks(93_417, 100)) expect(tick % 100).toBe(0);
  });

  it("only uses steps a one-decimal compact label can state exactly", () => {
    // 1,250 would be labelled "1.3k". Steps of 1, 2 and 5 never land there.
    for (const max of [1_010, 1_272, 3_900, 7_600, 12_345, 99_999]) {
      for (const tick of niceTicks(max)) {
        if (tick >= 1_000) expect(Number.isInteger(tick / 100)).toBe(true);
      }
    }
  });

  it("draws only the baseline when there is nothing to scale", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(99, 100)).toEqual([0]);
  });
});
