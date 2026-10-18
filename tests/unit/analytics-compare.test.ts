import { describe, expect, it } from "vitest";
import { alignPrevious, changeRatio, formatChange } from "@/components/analytics/compare";
import { previousRange } from "@/lib/analytics/buckets";
import { heroCeiling } from "@/components/analytics/revenue-hero-layout";

// THIS PERIOD VERSUS THE ONE BEFORE IT. The trend charts draw the previous
// period under the current one and the revenue hero states the change. What
// has to hold: the two periods are the same length and line up day for day,
// and nothing claims a change against a period that had nothing in it.

describe("previousRange", () => {
  it("is the same number of days, ending the day before the range starts", () => {
    expect(previousRange({ from: "2026-09-05", to: "2026-10-04" })).toEqual({
      from: "2026-08-06",
      to: "2026-09-04",
    });
    // One day against the day before it.
    expect(previousRange({ from: "2026-10-04", to: "2026-10-04" })).toEqual({
      from: "2026-10-03",
      to: "2026-10-03",
    });
    // Across a month boundary and a leap day.
    expect(previousRange({ from: "2028-03-01", to: "2028-03-31" })).toEqual({
      from: "2028-01-30",
      to: "2028-02-29",
    });
  });

  it("has nothing to offer a range with no start, or one that runs backwards", () => {
    expect(previousRange({ from: null, to: "2026-10-04" })).toBeNull();
    expect(previousRange({ from: null, to: null })).toBeNull();
    expect(previousRange({ from: "2026-10-04", to: "2026-10-01" })).toBeNull();
  });
});

describe("alignPrevious", () => {
  it("lays the previous period under the current one, first bucket on first", () => {
    expect(alignPrevious(3, [10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("pads a shorter previous period and drops the tail of a longer one", () => {
    expect(alignPrevious(4, [10, 20])).toEqual([10, 20, null, null]);
    expect(alignPrevious(2, [10, 20, 30])).toEqual([10, 20]);
  });

  it("keeps a gap as a gap", () => {
    expect(alignPrevious(3, [10, null, 30])).toEqual([10, null, 30]);
  });

  it("draws no comparison at all against a period with nothing in it", () => {
    expect(alignPrevious(3, [])).toBeNull();
    expect(alignPrevious(0, [10])).toBeNull();
  });
});

describe("changeRatio and formatChange", () => {
  it("states the change the way people write it", () => {
    expect(formatChange(changeRatio(11_200, 10_000)!, "en")).toBe("+12%");
    expect(formatChange(changeRatio(9_160, 10_000)!, "en")).toBe("-8.4%");
    expect(formatChange(changeRatio(10_000, 10_000)!, "en")).toBe("0%");
    expect(formatChange(changeRatio(25_000, 10_000)!, "en")).toBe("+150%");
  });

  it("never signs a change that rounds to nothing", () => {
    expect(formatChange(0.0002, "en")).toBe("0%");
    expect(formatChange(-0.0002, "en")).toBe("0%");
  });

  it("has no percentage for growth from nothing", () => {
    expect(changeRatio(5_000, 0)).toBeNull();
    expect(changeRatio(0, 0)).toBeNull();
  });
});

describe("heroCeiling with a single value", () => {
  // One value is drawn as one point in the middle of the plot, so the figure
  // only has to clear it when the figure itself reaches the middle (a phone).
  it("ignores the figure when it is off to one side", () => {
    expect(heroCeiling([1000], { from: 0, to: 0.3, depth: 0.5 })).toBeCloseTo(1120, 5);
  });

  it("clears the point when the figure spans the middle", () => {
    expect(heroCeiling([1000], { from: 0, to: 0.8, depth: 0.5 })).toBeCloseTo(2000, 5);
  });
});
