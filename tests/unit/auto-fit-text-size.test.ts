// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAutoFitSize } from "@/components/storefront/useAutoFitTextSize";

/**
 * The shrink search a text block runs when it has no size of its own: find
 * the largest size, at or below the style's ceiling, that a real
 * `fits(px)` (built on scrollHeight/scrollWidth, which jsdom cannot produce)
 * would call true. Pinned here against a fake `fits` instead, so the search
 * itself is covered without a real layout engine.
 */

/** A `fits` stand-in for a box that can hold up to `threshold` px and no
 *  more — every real fits() is exactly this shape, just backed by the DOM. */
function fitsUpTo(threshold: number) {
  return (px: number) => px <= threshold;
}

describe("resolveAutoFitSize - already fits", () => {
  it("keeps the ceiling when the box has room to spare", () => {
    expect(resolveAutoFitSize(24, 8, fitsUpTo(100))).toBe(24);
  });

  it("keeps the ceiling at an exact fit", () => {
    expect(resolveAutoFitSize(24, 8, fitsUpTo(24))).toBe(24);
  });
});

describe("resolveAutoFitSize - needs shrinking", () => {
  it("finds a size between floor and ceiling", () => {
    const resolved = resolveAutoFitSize(24, 8, fitsUpTo(15));
    expect(resolved).toBeLessThanOrEqual(15);
    expect(resolved).toBeGreaterThan(8);
  });

  it("gets within a pixel of the real threshold", () => {
    const resolved = resolveAutoFitSize(200, 8, fitsUpTo(53));
    expect(resolved).toBeGreaterThanOrEqual(52);
    expect(resolved).toBeLessThanOrEqual(53);
  });

  it("never returns an integer that overflows, even one rounding would pick", () => {
    // The search converges on a FRACTIONAL size that fits (here, 15.5 for a
    // 15.6 threshold); rounding it naively (Math.round rounds .5 up) lands on
    // 16, which does not fit. The result has to be the integer that actually
    // fits, not just close to one that did.
    const resolved = resolveAutoFitSize(24, 8, fitsUpTo(15.6));
    expect(resolved).toBe(15);
  });

  it("never returns more than the ceiling", () => {
    const resolved = resolveAutoFitSize(24, 8, fitsUpTo(1000));
    expect(resolved).toBeLessThanOrEqual(24);
  });
});

describe("resolveAutoFitSize - degenerate input", () => {
  it("settles on the floor rather than nothing when even that overflows", () => {
    // The absolute smallest size still has to render as SOMETHING.
    expect(resolveAutoFitSize(24, 8, fitsUpTo(0))).toBe(8);
  });

  it("never returns less than the floor", () => {
    const resolved = resolveAutoFitSize(200, 8, fitsUpTo(3));
    expect(resolved).toBeGreaterThanOrEqual(8);
  });
});
