// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isHorizontallyShown,
  padBox,
  phoneCardEdge,
  placeCard,
  scrollDeltaFor,
} from "@/lib/onboarding/tour-geometry";

/**
 * The guided tour's geometry: what counts as on screen, the padded box, where
 * the card goes, and how far to scroll. Pure, so each rule is pinned with
 * numbers rather than discovered in a browser.
 */

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
});
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

describe("isHorizontallyShown", () => {
  it("rejects the phone's sidebar, which is the rail translated off the left edge", () => {
    expect(isHorizontallyShown(rect(-256, 0, 256, 844), PHONE.width)).toBe(false);
  });

  it("accepts a control below the fold, since the tour scrolls to it", () => {
    expect(isHorizontallyShown(rect(24, 2400, 120, 40), PHONE.width)).toBe(true);
  });

  it("rejects a box with nothing laid out (display: none)", () => {
    expect(isHorizontallyShown(rect(0, 0, 0, 0), PHONE.width)).toBe(false);
  });

  it("accepts a wide control that is only partly on screen", () => {
    expect(isHorizontallyShown(rect(-100, 0, 400, 40), PHONE.width)).toBe(true);
  });

  it("rejects a sliver at the edge", () => {
    expect(isHorizontallyShown(rect(380, 0, 100, 40), PHONE.width)).toBe(false);
  });
});

describe("padBox", () => {
  it("grows the box, keeps it inside the viewport, and snaps to whole pixels", () => {
    expect(padBox({ left: 0.4, top: 10.6, width: 100.2, height: 20 }, 6, DESKTOP)).toEqual({
      left: 0,
      top: 4,
      width: 107,
      height: 33,
    });
  });
});

describe("placeCard", () => {
  const card = { width: 320, height: 180 };

  it("hangs below the target, centred on it", () => {
    expect(placeCard({ left: 600, top: 100, width: 100, height: 40 }, card, DESKTOP)).toEqual({
      side: "bottom",
      top: 152,
      left: 490,
    });
  });

  it("flips above when there is no room below", () => {
    expect(placeCard({ left: 600, top: 760, width: 100, height: 40 }, card, DESKTOP)).toEqual({
      side: "top",
      top: 568,
      left: 490,
    });
  });

  it("sits to the right of the sidebar rail when asked to", () => {
    expect(
      placeCard({ left: 0, top: 0, width: 256, height: 900 }, card, DESKTOP, { side: "right" }),
    ).toEqual({ side: "right", left: 268, top: 360 });
  });

  it("sits to the left of a column docked on the right when asked to, and only then", () => {
    const column = { left: 1120, top: 92, width: 320, height: 320 };
    expect(placeCard(column, card, DESKTOP, { side: "left" })).toEqual({
      side: "left",
      left: 788,
      top: 162,
    });
    expect(placeCard(column, card, DESKTOP).side).toBe("bottom");
    // No room on the left: the usual order takes over.
    expect(
      placeCard({ left: 100, top: 92, width: 320, height: 320 }, card, DESKTOP, { side: "left" })
        .side,
    ).toBe("bottom");
  });

  it("stays inside the viewport for a target at its edge", () => {
    expect(placeCard({ left: 1400, top: 100, width: 30, height: 30 }, card, DESKTOP).left).toBe(
      1104,
    );
  });

  it("falls back to the corner when no side fits", () => {
    expect(placeCard({ left: 0, top: 0, width: 1440, height: 900 }, card, DESKTOP)).toEqual({
      side: "corner",
      left: 1104,
      top: 704,
    });
  });
});

describe("scrollDeltaFor", () => {
  const band = { top: 72, bottom: 16 };

  it("leaves a target that already fits alone", () => {
    expect(scrollDeltaFor({ left: 0, top: 200, width: 10, height: 40 }, DESKTOP, band)).toBe(0);
  });

  it("centres a target below the fold in the visible band", () => {
    expect(scrollDeltaFor({ left: 0, top: 2000, width: 10, height: 40 }, DESKTOP, band)).toBe(
      1542,
    );
  });

  it("brings a target out from under the sticky top bar", () => {
    expect(scrollDeltaFor({ left: 0, top: 20, width: 10, height: 40 }, DESKTOP, band)).toBe(-438);
  });

  it("keeps clear of the phone's card at the bottom", () => {
    expect(
      scrollDeltaFor({ left: 0, top: 610, width: 10, height: 40 }, PHONE, { top: 72, bottom: 216 }),
    ).toBe(280);
  });

  it("aligns a target taller than the band to the band's top", () => {
    expect(scrollDeltaFor({ left: 0, top: 500, width: 10, height: 2000 }, DESKTOP, band)).toBe(
      428,
    );
  });
});

describe("phoneCardEdge", () => {
  it("keeps the card at the bottom when the target is clear of it", () => {
    expect(phoneCardEdge({ left: 0, top: 100, width: 40, height: 40 }, 200, PHONE, 56)).toBe(
      "bottom",
    );
  });

  it("moves the card up when the target is stuck under it and the top has room", () => {
    expect(phoneCardEdge({ left: 0, top: 700, width: 40, height: 40 }, 200, PHONE, 56)).toBe(
      "top",
    );
  });

  it("stays at the bottom when neither edge would be clear", () => {
    expect(phoneCardEdge({ left: 0, top: 100, width: 40, height: 700 }, 200, PHONE, 56)).toBe(
      "bottom",
    );
  });
});
