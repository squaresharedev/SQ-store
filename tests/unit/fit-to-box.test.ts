// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fitScale } from "@/components/storefront/useFitToBox";

/**
 * The storefront card scales its preview down until the WHOLE board fits.
 * These pin the arithmetic, including the degenerate inputs that show up
 * during the first render pass before anything has been measured.
 */

const box = (width: number, height: number) => ({ width, height });

describe("fitScale - already fits", () => {
  it("returns 1 when the content is smaller than the box", () => {
    expect(fitScale(box(400, 300), box(200, 150))).toBe(1);
  });

  it("returns 1 at an exact fit", () => {
    expect(fitScale(box(400, 300), box(400, 300))).toBe(1);
  });

  it("never scales UP: small content stays its own size", () => {
    // "Make it smaller until it fits" — a one-block storefront should not be
    // blown up to fill the card and look nothing like the real thing.
    expect(fitScale(box(1000, 1000), box(50, 50))).toBe(1);
  });
});

describe("fitScale - needs shrinking", () => {
  it("scales by height when the content is too tall", () => {
    // The common case: a tall board at full card width.
    expect(fitScale(box(400, 300), box(400, 600))).toBe(0.5);
  });

  it("scales by width when the content is too wide", () => {
    expect(fitScale(box(400, 300), box(800, 300))).toBe(0.5);
  });

  it("takes the SMALLER factor when both axes overflow", () => {
    // 400/800 = 0.5 on width, 300/1500 = 0.2 on height. Picking the larger
    // would still leave the content overflowing the other axis.
    expect(fitScale(box(400, 300), box(800, 1500))).toBeCloseTo(0.2, 5);
  });

  it("preserves aspect ratio (one factor, both axes)", () => {
    const scale = fitScale(box(400, 300), box(800, 1200));
    // Both dimensions scaled by the same number must land inside the box.
    expect(800 * scale).toBeLessThanOrEqual(400 + 0.001);
    expect(1200 * scale).toBeLessThanOrEqual(300 + 0.001);
  });

  it("handles an extremely tall board without collapsing to zero", () => {
    // 24 rows on a 6-column board is the schema's tall extreme.
    const scale = fitScale(box(320, 240), box(320, 1280));
    expect(scale).toBeGreaterThan(0);
    expect(1280 * scale).toBeLessThanOrEqual(240 + 0.001);
  });
});

describe("fitScale - degenerate input", () => {
  it("assumes a fit when nothing has been measured yet", () => {
    // First paint: refs are attached but layout has not run. Returning a tiny
    // scale here would flash an invisible preview before settling.
    expect(fitScale(box(0, 0), box(0, 0))).toBe(1);
    expect(fitScale(box(400, 300), box(0, 0))).toBe(1);
    expect(fitScale(box(0, 0), box(400, 300))).toBe(1);
  });

  it("assumes a fit for a collapsed box (display:none, closed panel)", () => {
    expect(fitScale(box(400, 0), box(400, 600))).toBe(1);
    expect(fitScale(box(0, 300), box(400, 600))).toBe(1);
  });

  it("ignores negative measurements rather than inverting the scale", () => {
    expect(fitScale(box(-10, -10), box(400, 600))).toBe(1);
    expect(fitScale(box(400, 300), box(-1, -1))).toBe(1);
  });
});
