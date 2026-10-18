import { describe, expect, it } from "vitest";
import { runProgress, usageProgress } from "@/lib/discounts/progress";

// The two fractions a discount's row draws as a bar.

describe("how far through its run a discount is", () => {
  const run = { startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z" };
  const at = (iso: string) => new Date(iso);

  it("is nothing before the start, all of it after the end, and the share in between", () => {
    expect(runProgress(run, at("2026-09-30T00:00:00.000Z"))).toBe(0);
    expect(runProgress(run, at("2026-10-01T00:00:00.000Z"))).toBe(0);
    expect(runProgress(run, at("2026-10-06T00:00:00.000Z"))).toBe(0.5);
    expect(runProgress(run, at("2026-10-11T00:00:00.000Z"))).toBe(1);
    expect(runProgress(run, at("2026-12-01T00:00:00.000Z"))).toBe(1);
  });

  it("has no fraction when there is no end to be a fraction of", () => {
    expect(runProgress({ ...run, endsAt: null }, at("2026-10-06T00:00:00.000Z"))).toBeNull();
  });

  it("reads the same instant however it is printed", () => {
    // PostgREST prints an offset and microseconds; a browser prints Z.
    const stored = { startsAt: "2026-10-01T00:00:00+00:00", endsAt: "2026-10-11T02:00:00.000000+02:00" };
    expect(runProgress(stored, at("2026-10-06T00:00:00.000Z"))).toBe(0.5);
  });

  it("treats a run with no length as over or not, never as a division by zero", () => {
    const instant = { startsAt: run.startsAt, endsAt: run.startsAt };
    expect(runProgress(instant, at("2026-09-30T00:00:00.000Z"))).toBe(0);
    expect(runProgress(instant, at("2026-10-01T00:00:00.000Z"))).toBe(1);
  });
});

describe("how much of a code's limit is used", () => {
  it("is the share of the limit, never past all of it", () => {
    expect(usageProgress(0, 50)).toBe(0);
    expect(usageProgress(3, 50)).toBe(0.06);
    expect(usageProgress(50, 50)).toBe(1);
    // An order can land between the check and the count.
    expect(usageProgress(51, 50)).toBe(1);
  });

  it("has no fraction for a code with no limit", () => {
    expect(usageProgress(12, null)).toBeNull();
  });
});
