import { describe, expect, it } from "vitest";
import {
  ROTATION_MAX,
  ROTATION_MIN,
  normalizeRotation,
  withRotation,
  type ShapeBlock,
  type TextBlock,
} from "@/types/storefront";
import {
  ROTATION_SNAP_STEP,
  angleFromCenter,
  normalizeAngle,
  snapAngle,
  toLocalPoint,
} from "@/components/grid/rotationMath";
import {
  EDGE_GRAB_PX,
  edgeCursor,
  edgesUnderPointer,
} from "@/components/grid/gridConstants";

/**
 * Block rotation: the stored value, and the geometry the gesture and the
 * hit-testing run on.
 *
 * The two things worth pinning hardest are that levelling a block DROPS the
 * field (an untilted block has to stay byte-identical to one saved before
 * tilting existed) and that a tilted cell hit-tests against its own space
 * rather than its bounding box, which is what makes edge-grab resize keep
 * working once a tile has been turned.
 */

const shape = (rotation?: number): ShapeBlock => ({
  type: "shape",
  id: "11111111-1111-4111-8111-111111111111",
  kind: "square",
  color: "#000000",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  ...(rotation !== undefined ? { rotation } : {}),
});

describe("normalizeRotation", () => {
  it("folds whole turns away", () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-370)).toBe(-10);
    expect(normalizeRotation(540)).toBe(180);
    expect(normalizeRotation(720)).toBe(0);
  });

  it("keeps the ends of the range reachable", () => {
    expect(normalizeRotation(ROTATION_MAX)).toBe(180);
    // -180 and 180 are the same angle; settling on the top of the range is
    // what lets the slider reach its own maximum.
    expect(normalizeRotation(ROTATION_MIN)).toBe(180);
    expect(normalizeRotation(-179)).toBe(-179);
  });

  it("rounds to whole degrees, since the schema stores an int", () => {
    expect(normalizeRotation(45.4)).toBe(45);
    expect(normalizeRotation(45.6)).toBe(46);
  });

  it("treats nonsense as level rather than storing NaN", () => {
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("agrees with the grid's own copy at every quarter turn", () => {
    // The two are deliberately duplicated (the config type must not import a
    // component module), so this is the test that stops them drifting.
    for (const angle of [-360, -181, -180, -90, 0, 45, 90, 180, 181, 359, 540]) {
      expect(normalizeRotation(angle)).toBe(normalizeAngle(angle));
    }
  });
});

describe("withRotation", () => {
  it("drops the field when the block goes level", () => {
    const tilted = shape(30);
    const level = withRotation(tilted, 0);
    expect("rotation" in level).toBe(false);
    // Byte-identical to a block saved before tilting existed.
    expect(JSON.stringify(level)).toBe(JSON.stringify(shape()));
  });

  it("drops the field when a whole turn lands back on level", () => {
    expect("rotation" in withRotation(shape(30), 360)).toBe(false);
  });

  it("returns the SAME object when the angle is unchanged", () => {
    const block = shape(45);
    // Identity, not equality: this is what keeps a drag that ends where it
    // started from marking the editor dirty.
    expect(withRotation(block, 45)).toBe(block);
    const level = shape();
    expect(withRotation(level, 0)).toBe(level);
  });

  it("normalizes on the way in", () => {
    expect(withRotation(shape(), 370).rotation).toBe(10);
  });

  it("never mutates its input", () => {
    const block = shape(10);
    withRotation(block, 90);
    expect(block.rotation).toBe(10);
  });

  it("carries every other field through untouched", () => {
    const text: TextBlock = {
      type: "text",
      id: "22222222-2222-4222-8222-222222222222",
      text: "Hello",
      variant: "heading",
      align: "left",
      x: 2,
      y: 3,
      w: 2,
      h: 1,
      bold: true,
    };
    expect(withRotation(text, 15)).toEqual({ ...text, rotation: 15 });
  });
});

describe("angleFromCenter", () => {
  const center = { x: 100, y: 100 };

  it("reads as a bearing, clockwise from twelve o'clock", () => {
    expect(angleFromCenter(center, { x: 100, y: 50 })).toBe(0);
    expect(angleFromCenter(center, { x: 150, y: 100 })).toBe(90);
    expect(angleFromCenter(center, { x: 100, y: 150 })).toBe(180);
    expect(angleFromCenter(center, { x: 50, y: 100 })).toBe(-90);
  });

  it("ignores distance, so a spin tracks the wrist not the reach", () => {
    expect(angleFromCenter(center, { x: 110, y: 90 })).toBeCloseTo(
      angleFromCenter(center, { x: 200, y: 0 }),
      6,
    );
  });
});

describe("snapAngle", () => {
  it("lands on the detents", () => {
    expect(snapAngle(7, ROTATION_SNAP_STEP)).toBe(0);
    expect(snapAngle(8, ROTATION_SNAP_STEP)).toBe(15);
    expect(snapAngle(-38, ROTATION_SNAP_STEP)).toBe(-45);
    expect(snapAngle(97, ROTATION_SNAP_STEP)).toBe(90);
  });

  it("passes the angle through when there is no step to snap to", () => {
    expect(snapAngle(37, 0)).toBe(37);
  });
});

describe("toLocalPoint", () => {
  const center = { x: 100, y: 100 };

  it("is the identity at zero", () => {
    const point = { x: 130, y: 110 };
    expect(toLocalPoint(center, 0, point)).toBe(point);
  });

  it("round-trips through equal and opposite turns", () => {
    const point = { x: 137, y: 42 };
    const there = toLocalPoint(center, 37, point);
    const back = toLocalPoint(center, -37, there);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it("undoes a clockwise quarter turn", () => {
    // Turn a card a quarter turn clockwise and its top edge swings to the
    // right, so a point painted on the RIGHT came from the cell's own TOP.
    // This is the mapping edge hit-testing depends on.
    const local = toLocalPoint(center, 90, { x: 150, y: 100 });
    expect(local.x).toBeCloseTo(100, 6);
    expect(local.y).toBeCloseTo(50, 6);
  });
});

/**
 * Edge grabbing is deliberately IN SCREEN SPACE, on the box the seller can
 * see (a turned block's footprint), rather than in the block's own turned
 * space. Reading the pointer through the rotation looked right at zero and
 * inverted at half a turn, where dragging the top edge upwards grew the block
 * downwards.
 */
describe("edgesUnderPointer", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it("reports the edge the pointer is actually on", () => {
    expect(edgesUnderPointer(rect, 50, 2)).toEqual({
      n: true,
      s: false,
      w: false,
      e: false,
    });
    expect(edgesUnderPointer(rect, 98, 50)?.e).toBe(true);
  });

  it("combines two sides at a corner", () => {
    expect(edgesUnderPointer(rect, 2, 2)).toEqual({
      n: true,
      s: false,
      w: true,
      e: false,
    });
  });

  it("returns null on the inner surface", () => {
    expect(edgesUnderPointer(rect, 50, 50)).toBeNull();
  });

  it("caps the grab zone at a quarter of the box", () => {
    // A tiny or zoomed-out tile keeps an inner area to drag from instead of
    // becoming all edge.
    const small = { left: 0, top: 0, width: 20, height: 20 };
    expect(edgesUnderPointer(small, 10, 10, EDGE_GRAB_PX)).toBeNull();
  });
});

describe("edgeCursor", () => {
  it("names the direction the grabbed edge grows in", () => {
    expect(edgeCursor({ n: true, s: false, w: false, e: false })).toBe("ns-resize");
    expect(edgeCursor({ n: false, s: true, w: false, e: false })).toBe("ns-resize");
    expect(edgeCursor({ n: false, s: false, w: false, e: true })).toBe("ew-resize");
    expect(edgeCursor({ n: false, s: false, w: true, e: false })).toBe("ew-resize");
  });

  it("picks the diagonal a corner actually runs along", () => {
    expect(edgeCursor({ n: true, s: false, w: true, e: false })).toBe("nwse-resize");
    expect(edgeCursor({ n: false, s: true, w: false, e: true })).toBe("nwse-resize");
    expect(edgeCursor({ n: true, s: false, w: false, e: true })).toBe("nesw-resize");
    expect(edgeCursor({ n: false, s: true, w: true, e: false })).toBe("nesw-resize");
  });
});
