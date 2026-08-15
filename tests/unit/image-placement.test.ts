// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PLACEMENT,
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  backgroundStyle,
  clampPlacement,
  imageStyle,
  isDefaultPlacement,
  panPlacement,
  zoomPlacement,
  zoomPlacementTo,
  type ImagePlacement,
} from "@/lib/images/placement";

/**
 * The arithmetic behind framing an image in a box, tested the way this repo
 * tests gesture maths (see grid-edge-resize.test.ts): plain numbers and fake
 * rects, no DOM, no rendering. The component wiring on top is only worth
 * trusting if these hold.
 */

const centred: ImagePlacement = { ...DEFAULT_IMAGE_PLACEMENT };

/** A 200x200 frame showing a 400x200 landscape photo: overhang on x only. */
const LANDSCAPE = {
  width: 200,
  height: 200,
  naturalWidth: 400,
  naturalHeight: 200,
};

describe("clampPlacement", () => {
  it("keeps a valid placement untouched", () => {
    expect(clampPlacement({ x: 20, y: 80, scale: 150 })).toEqual({
      x: 20,
      y: 80,
      scale: 150,
    });
  });

  it("holds the focal point inside the picture", () => {
    expect(clampPlacement({ x: -40, y: 250, scale: 100 })).toEqual({
      x: 0,
      y: 100,
      scale: 100,
    });
  });

  it("never lets the scale fall below covering the frame", () => {
    // Anything under 100 would letterbox, which no frame in this app allows.
    expect(clampPlacement({ x: 50, y: 50, scale: 40 }).scale).toBe(IMAGE_SCALE_MIN);
    expect(clampPlacement({ x: 50, y: 50, scale: 900 }).scale).toBe(IMAGE_SCALE_MAX);
  });

  it("rounds to whole percents, because the config stores bounded ints", () => {
    expect(clampPlacement({ x: 33.7, y: 12.2, scale: 149.6 })).toEqual({
      x: 34,
      y: 12,
      scale: 150,
    });
  });

  it("fills in the centre for anything missing", () => {
    expect(clampPlacement(undefined)).toEqual(DEFAULT_IMAGE_PLACEMENT);
    expect(clampPlacement({ x: 10 })).toEqual({ x: 10, y: 50, scale: 100 });
  });
});

describe("isDefaultPlacement", () => {
  it("is true for centred-and-unzoomed, and for nothing at all", () => {
    expect(isDefaultPlacement(centred)).toBe(true);
    expect(isDefaultPlacement(undefined)).toBe(true);
  });

  it("is false as soon as any axis moves", () => {
    expect(isDefaultPlacement({ ...centred, x: 51 })).toBe(false);
    expect(isDefaultPlacement({ ...centred, scale: 101 })).toBe(false);
  });
});

describe("panPlacement", () => {
  it("moves the focal point AGAINST the pointer", () => {
    // Dragging right pulls the picture right, which reveals more of its left
    // side — a smaller x. Backwards here would feel like a broken map.
    const dragged = panPlacement(centred, 20, 0, LANDSCAPE);
    expect(dragged.x).toBeLessThan(centred.x);

    const back = panPlacement(centred, -20, 0, LANDSCAPE);
    expect(back.x).toBeGreaterThan(centred.x);
  });

  it("tracks the pointer 1:1 across the picture's real overhang", () => {
    // 400x200 photo covering a 200x200 frame renders 400x200: 200px of
    // overhang on x. So 200px of drag must sweep the entire 0..100 range,
    // and 50px must move exactly a quarter of it.
    expect(panPlacement(centred, 50, 0, LANDSCAPE).x).toBe(25);
    expect(panPlacement({ ...centred, x: 100 }, 200, 0, LANDSCAPE).x).toBe(0);
  });

  it("slows down as the picture is zoomed, so the drag still feels 1:1", () => {
    // At 2x every pixel of overhang is magnified, so the same pointer travel
    // must change the percentage by less. Without this the picture outruns
    // the cursor the moment you zoom in.
    const at1x = centred.x - panPlacement(centred, 40, 0, LANDSCAPE).x;
    const at2x =
      centred.x -
      panPlacement({ ...centred, scale: 200 }, 40, 0, LANDSCAPE).x;
    expect(at2x).toBeLessThan(at1x);
  });

  it("refuses to move an axis that has nowhere to go", () => {
    // A square photo in a square frame at 1x covers it exactly: no overhang,
    // no pan. Dividing by that zero would fling the focal point to an edge.
    const square = { width: 200, height: 200, naturalWidth: 200, naturalHeight: 200 };
    expect(panPlacement(centred, 60, 60, square)).toEqual(centred);
  });

  it("pans a square photo once zoom has created room", () => {
    const square = {
      width: 200,
      height: 200,
      naturalWidth: 200,
      naturalHeight: 200,
    };
    const zoomed = { ...centred, scale: 200 };
    expect(panPlacement(zoomed, 60, 0, square).x).toBeLessThan(50);
  });

  it("still drags before the image has reported its size", () => {
    // naturalWidth/Height are absent until load. A dead frame in that window
    // reads as a broken feature, so it falls back to the frame box.
    const unloaded = { width: 200, height: 200 };
    expect(panPlacement(centred, 50, 0, unloaded).x).toBe(25);
  });

  it("keeps the background's flat travel exactly as it shipped", () => {
    // A background crops through background-size, not a transform, so the
    // cover model would be wrong for it — and adopting the shared maths must
    // not re-tune the feel of a surface sellers already use. One frame width
    // sweeps the whole range, zoom or no zoom.
    const frame = { width: 200, height: 200, mode: "frame" as const };
    expect(panPlacement(centred, 50, 0, frame).x).toBe(25);
    expect(panPlacement({ ...centred, scale: 300 }, 50, 0, frame).x).toBe(25);
  });

  it("clamps at the edges of the picture", () => {
    expect(panPlacement({ ...centred, x: 5 }, 400, 0, LANDSCAPE).x).toBe(0);
    expect(panPlacement({ ...centred, x: 95 }, -400, 0, LANDSCAPE).x).toBe(100);
  });
});

describe("zoomPlacement", () => {
  it("steps within bounds and keeps the focal point", () => {
    expect(zoomPlacement({ x: 20, y: 30, scale: 150 }, 25)).toEqual({
      x: 20,
      y: 30,
      scale: 175,
    });
    expect(zoomPlacement(centred, -50).scale).toBe(IMAGE_SCALE_MIN);
    expect(zoomPlacement(centred, 9999).scale).toBe(IMAGE_SCALE_MAX);
  });

  it("takes an absolute scale for a pinch, which knows its own ratio", () => {
    expect(zoomPlacementTo(centred, 220).scale).toBe(220);
    expect(zoomPlacementTo(centred, 20).scale).toBe(IMAGE_SCALE_MIN);
  });
});

describe("imageStyle", () => {
  it("emits nothing for an unframed tile", () => {
    // So a storefront nobody has framed renders exactly as it did before this
    // feature existed — no inline style, no diff.
    expect(imageStyle(centred)).toEqual({});
    expect(imageStyle(undefined)).toEqual({});
  });

  it("positions without a transform when only the focal point moved", () => {
    expect(imageStyle({ x: 20, y: 80, scale: 100 })).toEqual({
      objectPosition: "20% 80%",
    });
  });

  it("pins the transform origin to the focal point when zoomed", () => {
    // THE load-bearing assertion. object-position puts the focal point at that
    // spot in the box; scaling about the same spot is what keeps it there.
    // Any other origin and the picture swims away as it grows.
    const style = imageStyle({ x: 25, y: 75, scale: 200 });
    expect(style.objectPosition).toBe("25% 75%");
    expect(style.transformOrigin).toBe(style.objectPosition);
    expect(style.transform).toBe("scale(2)");
  });
});

describe("backgroundStyle", () => {
  it("keeps the shape the storefront background has always stored", () => {
    // A background crops by background-size, not by a transform, so the same
    // numbers render through different CSS. Changing this would silently
    // re-frame every storefront background already saved.
    expect(backgroundStyle({ x: 30, y: 70, scale: 150 })).toEqual({
      backgroundSize: "150% auto",
      backgroundPosition: "30% 70%",
      backgroundRepeat: "no-repeat",
    });
  });
});
