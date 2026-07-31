import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  clampDate,
  formatDisplayDate,
  fromISODate,
  fullDateLabel,
  isAfter,
  isBefore,
  isOutsideRange,
  isSameDay,
  toISODate,
} from "@/lib/format/calendar";

describe("fromISODate", () => {
  it("parses a valid date as a LOCAL date", () => {
    const d = fromISODate("2026-07-04")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(4);
  });

  it("rejects calendar rollovers (Feb 30, Apr 31)", () => {
    expect(fromISODate("2026-02-30")).toBeNull();
    expect(fromISODate("2026-04-31")).toBeNull();
    expect(fromISODate("2026-13-01")).toBeNull();
    expect(fromISODate("2026-00-10")).toBeNull();
  });

  it("accepts leap-day only in leap years", () => {
    expect(fromISODate("2024-02-29")).not.toBeNull();
    expect(fromISODate("2026-02-29")).toBeNull();
  });

  it("rejects junk and empties", () => {
    expect(fromISODate("")).toBeNull();
    expect(fromISODate(null)).toBeNull();
    expect(fromISODate(undefined)).toBeNull();
    expect(fromISODate("2026-7-4")).toBeNull();
    expect(fromISODate("20260704")).toBeNull();
    expect(fromISODate("2026-07-04T00:00:00Z")).toBeNull();
  });

  it("round-trips with toISODate", () => {
    for (const iso of ["2026-01-01", "2026-12-31", "2024-02-29"]) {
      expect(toISODate(fromISODate(iso)!)).toBe(iso);
    }
  });
});

describe("date arithmetic", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(toISODate(addDays(fromISODate("2026-01-31")!, 1))).toBe("2026-02-01");
    expect(toISODate(addDays(fromISODate("2026-12-31")!, 1))).toBe("2027-01-01");
    expect(toISODate(addDays(fromISODate("2026-03-01")!, -1))).toBe("2026-02-28");
  });

  it("addMonths clamps oddly (JS semantics: Jan 31 + 1mo = Mar 3 in non-leap)", () => {
    // Documenting the actual JS behavior the Calendar relies on.
    const d = addMonths(fromISODate("2026-01-31")!, 1);
    expect(d.getMonth()).toBe(2); // rolls into March
  });

  it("comparisons are day-granular", () => {
    const morning = new Date(2026, 6, 4, 1, 0, 0);
    const evening = new Date(2026, 6, 4, 23, 0, 0);
    expect(isBefore(morning, evening)).toBe(false);
    expect(isAfter(evening, morning)).toBe(false);
    expect(isSameDay(morning, evening)).toBe(true);
  });

  it("isSameDay handles nulls", () => {
    expect(isSameDay(null, new Date())).toBe(false);
    expect(isSameDay(null, null)).toBe(false);
  });
});

describe("range clamping", () => {
  const min = fromISODate("2026-07-01")!;
  const max = fromISODate("2026-07-31")!;

  it("isOutsideRange respects inclusive bounds", () => {
    expect(isOutsideRange(fromISODate("2026-07-01")!, min, max)).toBe(false);
    expect(isOutsideRange(fromISODate("2026-07-31")!, min, max)).toBe(false);
    expect(isOutsideRange(fromISODate("2026-06-30")!, min, max)).toBe(true);
    expect(isOutsideRange(fromISODate("2026-08-01")!, min, max)).toBe(true);
  });

  it("clampDate pulls out-of-range dates to the nearest bound", () => {
    expect(toISODate(clampDate(fromISODate("2026-06-01")!, min, max))).toBe("2026-07-01");
    expect(toISODate(clampDate(fromISODate("2026-09-01")!, min, max))).toBe("2026-07-31");
    expect(toISODate(clampDate(fromISODate("2026-07-15")!, min, max))).toBe("2026-07-15");
  });

  it("null bounds are open", () => {
    expect(isOutsideRange(fromISODate("1990-01-01")!, null, null)).toBe(false);
  });
});

describe("buildMonthGrid", () => {
  it("always returns 42 cells (6 full weeks)", () => {
    expect(buildMonthGrid(fromISODate("2026-07-01")!)).toHaveLength(42);
    expect(buildMonthGrid(fromISODate("2026-02-01")!)).toHaveLength(42);
  });

  it("is Monday-first and covers the whole month", () => {
    // July 2026 starts on a Wednesday → grid starts Mon 29 June.
    const grid = buildMonthGrid(fromISODate("2026-07-01")!);
    expect(toISODate(grid[0])).toBe("2026-06-29");
    expect(grid[0].getDay()).toBe(1); // Monday
    const isos = grid.map(toISODate);
    expect(isos).toContain("2026-07-01");
    expect(isos).toContain("2026-07-31");
  });

  it("month starting on Monday starts the grid on day 1", () => {
    // June 2026 starts on a Monday.
    const grid = buildMonthGrid(fromISODate("2026-06-01")!);
    expect(toISODate(grid[0])).toBe("2026-06-01");
  });

  it("consecutive cells are consecutive days (no gaps or repeats)", () => {
    const grid = buildMonthGrid(fromISODate("2026-02-01")!);
    for (let i = 1; i < grid.length; i += 1) {
      expect(toISODate(addDays(grid[i - 1], 1))).toBe(toISODate(grid[i]));
    }
  });
});

describe("labels", () => {
  it("fullDateLabel formats for screen readers", () => {
    // ICU versions differ on the comma after the weekday; both are fine.
    expect(fullDateLabel(fromISODate("2026-07-04")!)).toMatch(
      /^Saturday,? 4 July 2026$/,
    );
  });
  it("formatDisplayDate short form", () => {
    expect(formatDisplayDate(fromISODate("2026-07-04")!)).toBe("4 Jul 2026");
  });
});
