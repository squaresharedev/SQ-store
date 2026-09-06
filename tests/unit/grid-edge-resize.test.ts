import { describe, expect, it } from "vitest";
import {
  EDGE_GRAB_PX,
  boardInLocalFrame,
  edgeCursor,
  edgesUnderPointer,
  keyboardResizeStep,
  placementFromLocalBox,
  resizeLocalBox,
  type GridBlock,
  type GridPlacement,
  type ResizeEdges,
} from "@/components/grid/gridConstants";
import { rotatePoint, rotateVector, toLocalPoint, type Point } from "@/components/grid/rotationMath";

/**
 * Edge-grab resize contract: a press near a cell border resizes from that
 * side; the inner surface stays a move. These pin the pure halves the Grid's
 * gesture wiring stands on: the hit-test (edgesUnderPointer), the box math
 * with pinned opposite sides (resizeLocalBox), the trip back onto the board
 * (placementFromLocalBox), and the cursor mapping.
 *
 * All of it runs in the BLOCK'S own frame, which is what makes a tilted tile
 * grow along the axis the hand is pulling. The rotation-specific cases live in
 * tests/unit/storefront-rotation.test.ts.
 */

const RECT = { left: 100, top: 100, width: 96, height: 96 };

function edge(over: Partial<ResizeEdges> = {}): ResizeEdges {
  return { n: false, e: false, s: false, w: false, ...over };
}

describe("edgesUnderPointer", () => {
  it("returns null for the inner surface (a move, not a resize)", () => {
    expect(edgesUnderPointer(RECT, 148, 148)).toBeNull();
    expect(edgesUnderPointer(RECT, 120, 150)).toBeNull();
  });

  it("detects each single side inside the grab zone", () => {
    expect(edgesUnderPointer(RECT, 105, 148)).toEqual(edge({ w: true }));
    expect(edgesUnderPointer(RECT, 191, 148)).toEqual(edge({ e: true }));
    expect(edgesUnderPointer(RECT, 148, 105)).toEqual(edge({ n: true }));
    expect(edgesUnderPointer(RECT, 148, 191)).toEqual(edge({ s: true }));
  });

  it("detects corners as two combined sides", () => {
    expect(edgesUnderPointer(RECT, 103, 103)).toEqual(edge({ n: true, w: true }));
    expect(edgesUnderPointer(RECT, 193, 193)).toEqual(edge({ s: true, e: true }));
    expect(edgesUnderPointer(RECT, 193, 103)).toEqual(edge({ n: true, e: true }));
    expect(edgesUnderPointer(RECT, 103, 193)).toEqual(edge({ s: true, w: true }));
  });

  it("caps the grab zone on small cells so an inner area always survives", () => {
    // 24px cell: the zone shrinks to 6px per side (a quarter), so the exact
    // center is never an edge even though it is within EDGE_GRAB_PX of one.
    const tiny = { left: 0, top: 0, width: 24, height: 24 };
    expect(EDGE_GRAB_PX).toBeGreaterThan(6);
    expect(edgesUnderPointer(tiny, 12, 12)).toBeNull();
    expect(edgesUnderPointer(tiny, 2, 12)).toEqual(edge({ w: true }));
  });

  it("returns null for a zero-size rect (unlaid-out cell)", () => {
    expect(edgesUnderPointer({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});

describe("resizeLocalBox", () => {
  const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 2 };
  const COLS = 8;
  const ROWS = 8;
  // Level, so the block's own frame IS board space and the numbers below read
  // as grid lines on the board.
  const BOUNDS = boardInLocalFrame(origin, 0, COLS, ROWS);

  /** The placement a drag to this local point commits to. */
  function drag(
    edges: ResizeEdges,
    x: number,
    y: number,
    mode: "edge" | "corner" = "edge",
  ) {
    const { snapped, anchor } = resizeLocalBox(
      origin,
      edges,
      { x, y },
      BOUNDS,
      mode,
    );
    return placementFromLocalBox(origin, 0, snapped, anchor);
  }

  it("east drag grows and shrinks the width, x pinned", () => {
    expect(drag(edge({ e: true }), 7, 3)).toEqual({ x: 2, y: 2, w: 5, h: 2 });
    expect(drag(edge({ e: true }), 3, 3)).toEqual({ x: 2, y: 2, w: 1, h: 2 });
  });

  it("west drag moves x and grows w, right edge pinned", () => {
    expect(drag(edge({ w: true }), 0, 3)).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    // Dragged inward: shrinks toward the pinned right edge.
    expect(drag(edge({ w: true }), 3, 3)).toEqual({ x: 3, y: 2, w: 1, h: 2 });
  });

  it("north/south drags mirror the horizontal behavior", () => {
    expect(drag(edge({ n: true }), 3, 0)).toEqual({ x: 2, y: 0, w: 2, h: 4 });
    expect(drag(edge({ s: true }), 3, 8)).toEqual({ x: 2, y: 2, w: 2, h: 6 });
  });

  it("corner drags resize both axes at once", () => {
    expect(drag(edge({ s: true, e: true }), 6, 7)).toEqual({
      x: 2, y: 2, w: 4, h: 5,
    });
    expect(drag(edge({ n: true, w: true }), 0, 0)).toEqual({
      x: 0, y: 0, w: 4, h: 4,
    });
  });

  it("never collapses below one cell, even dragged past the far side", () => {
    expect(drag(edge({ w: true }), 7, 3)).toEqual({ x: 3, y: 2, w: 1, h: 2 });
    expect(drag(edge({ n: true }), 3, 8)).toEqual({ x: 2, y: 3, w: 2, h: 1 });
  });

  it("stops at the board so the result stays inside", () => {
    expect(drag(edge({ e: true }), 99, 3)).toEqual({ x: 2, y: 2, w: 6, h: 2 });
    expect(drag(edge({ w: true }), -5, 3)).toEqual({ x: 0, y: 2, w: 4, h: 2 });
  });

  it("hands back a live box that tracks the pointer between cells", () => {
    // The tile paints on `live` so its border stays under the hand, while the
    // ghost promises `snapped`. Both agree on which side is pinned.
    const { live, snapped } = resizeLocalBox(
      origin,
      edge({ e: true }),
      { x: 5.4, y: 3 },
      BOUNDS,
    );
    expect(live).toEqual({ l: 2, t: 2, r: 5.4, b: 4 });
    expect(snapped).toEqual({ l: 2, t: 2, r: 5, b: 4 });
  });

  it("corner mode spans to the cell under the hand, that cell included", () => {
    // Cells, not lines: the handle sits inside the corner it drags, so a
    // fraction of a cell short must still count as reaching that cell.
    expect(drag(edge(), 5.4, 5.4, "corner")).toEqual({
      x: 2, y: 2, w: 4, h: 4,
    });
    // Past the anchor cell: the span lands on the other side of it, so one
    // handle reaches every direction.
    expect(drag(edge(), 0.6, 0.6, "corner")).toEqual({
      x: 0, y: 0, w: 3, h: 3,
    });
  });
});

describe("placementFromLocalBox", () => {
  it("pins the anchor corner on screen as the box grows", () => {
    // A quarter turn: the block's own width is drawn DOWN the screen, so
    // growing it must not slide the corner the hand is not holding. Placement
    // and rotation together have to leave that corner exactly where it was.
    const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 2 };
    const grown = placementFromLocalBox(
      origin,
      90,
      { l: 2, t: 2, r: 4, b: 6 },
      { x: 2, y: 2 },
    );
    // Turned a quarter turn, the block's own height is drawn ACROSS the
    // screen, so growing it by two cells grows the tile leftwards. The stored
    // rect moves to suit, which is the whole point: leaving x/y alone is what
    // used to drag the far corner along with the near one.
    expect(grown).toEqual({ x: 1, y: 1, w: 2, h: 4 });
  });

  it("leaves the pinned corner exactly where it was, at ANY angle", () => {
    // The invariant the whole gesture rests on, and the one a seller feels:
    // drag one side and only that side moves. Checked before the placement is
    // rounded onto whole cells, which is the only thing that costs accuracy.
    const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 3 };
    const bounds = { l: -20, t: -20, r: 20, b: 20 };
    for (const angle of [0, 17, 45, 90, 137, 180, 250, -63]) {
      for (const edges of [
        { n: false, e: true, s: false, w: false },
        { n: false, e: false, s: false, w: true },
        { n: true, e: false, s: false, w: false },
        { n: false, e: false, s: true, w: false },
      ]) {
        const { snapped, anchor } = resizeLocalBox(
          origin,
          edges,
          { x: 6, y: 7 },
          bounds,
        );
        const next = placementFromLocalBox(origin, angle, snapped, anchor);
        // Where the anchor sits on screen, before and after. Same corner of the
        // same block, so the two have to agree.
        const was = rotatePoint(
          { x: origin.x + origin.w / 2, y: origin.y + origin.h / 2 },
          angle,
          anchor,
        );
        const now = rotatePoint(
          { x: next.x + next.w / 2, y: next.y + next.h / 2 },
          angle,
          { x: anchor.x - snapped.l + next.x, y: anchor.y - snapped.t + next.y },
        );
        expect(now.x).toBeCloseTo(was.x, 9);
        expect(now.y).toBeCloseTo(was.y, 9);
      }
    }
  });

  it("is the identity for a level block", () => {
    const origin: GridPlacement = { x: 1, y: 1, w: 3, h: 2 };
    expect(
      placementFromLocalBox(origin, 0, { l: 1, t: 1, r: 5, b: 3 }, { x: 1, y: 1 }),
    ).toEqual({ x: 1, y: 1, w: 4, h: 2 });
  });
});

describe("boardInLocalFrame", () => {
  it("always lands on whole cells, even about an off-grid centre", () => {
    // A block's own centre sits on a grid line only when BOTH its width and
    // height are even. A 2x1 bar's centre is half a cell down — turning the
    // board's corners about that centre by a quarter turn lands them on a
    // half-cell line too, even though the board itself is still an ordinary
    // rectangle. A resize that gets dragged past the edge clamps to this
    // bound, so a fractional bound is what used to hand the rest of the
    // gesture a box it could not round onto the board cleanly.
    const oddOrigins: GridPlacement[] = [
      { x: 2, y: 2, w: 2, h: 1 },
      { x: 2, y: 2, w: 1, h: 2 },
      { x: 2, y: 2, w: 3, h: 4 },
      { x: 2, y: 2, w: 1, h: 1 },
    ];
    for (const origin of oddOrigins) {
      for (const angle of [90, -90, 270, -270]) {
        const bounds = boardInLocalFrame(origin, angle, 6, 6);
        for (const value of [bounds.l, bounds.r, bounds.t, bounds.b]) {
          expect(Number.isInteger(value), `origin=${JSON.stringify(origin)} angle=${angle}`).toBe(true);
        }
      }
    }
  });

  it("still fully contains the board — a drag can reach every cell a level one could", () => {
    // Rounding OUTWARD (not to the nearest cell) is what makes this safe: the
    // bound must never cut into the true board, or a resize could refuse to
    // reach a cell that is genuinely still on it.
    const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 1 };
    for (const angle of [90, -90]) {
      const bounds = boardInLocalFrame(origin, angle, 6, 6);
      const center = { x: origin.x + origin.w / 2, y: origin.y + origin.h / 2 };
      for (let bx = 0; bx <= 6; bx += 1) {
        for (let by = 0; by <= 6; by += 1) {
          const local = toLocalPoint(center, angle, { x: bx, y: by });
          expect(local.x).toBeGreaterThanOrEqual(bounds.l - 1e-9);
          expect(local.x).toBeLessThanOrEqual(bounds.r + 1e-9);
          expect(local.y).toBeGreaterThanOrEqual(bounds.t - 1e-9);
          expect(local.y).toBeLessThanOrEqual(bounds.b + 1e-9);
        }
      }
    }
  });
});

/**
 * The full corner-drag gesture, ODD-dimensioned origin included, checked
 * AFTER rounding — which is exactly what "leaves the pinned corner exactly
 * where it was, at ANY angle" above deliberately checks BEFORE. A block whose
 * width and height differ in parity has its own centre on a half cell once it
 * stands on its side (see lib/geometry/rotated-box.ts), so SOME imprecision
 * here is inherent and accepted elsewhere in the codebase — rotatedFootprint
 * documents the identical half-cell tradeoff. What is not acceptable is the
 * full-cell drift a fractional boardInLocalFrame bound used to produce
 * whenever the drag reached past the board's edge: independently rounding
 * x, y, w and h from a box clamped to a half-cell bound could round two of
 * those the same direction and lose a whole cell, not half of one.
 */
describe("a resized odd-dimensioned tile at a quarter turn, after rounding", () => {
  function resizeAndRound(
    origin: GridPlacement,
    angle: number,
    local: Point,
    columns: number,
    rows: number,
  ) {
    const bounds = boardInLocalFrame(origin, angle, columns, rows);
    const { snapped, anchor } = resizeLocalBox(
      origin,
      { n: false, e: true, s: true, w: false },
      local,
      bounds,
      "corner",
    );
    const next = placementFromLocalBox(origin, angle, snapped, anchor);
    const rounded: GridPlacement = {
      x: Math.round(next.x),
      y: Math.round(next.y),
      w: Math.round(next.w),
      h: Math.round(next.h),
    };
    return { snapped, anchor, rounded };
  }

  /** How far the anchor corner drifted on screen once the result is rounded
   *  onto whole cells, in cells. */
  function anchorDrift(
    origin: GridPlacement,
    angle: number,
    snapped: { l: number; t: number },
    anchor: Point,
    rounded: GridPlacement,
  ) {
    const was = rotatePoint(
      { x: origin.x + origin.w / 2, y: origin.y + origin.h / 2 },
      angle,
      anchor,
    );
    const now = rotatePoint(
      { x: rounded.x + rounded.w / 2, y: rounded.y + rounded.h / 2 },
      angle,
      {
        x: anchor.x - snapped.l + rounded.x,
        y: anchor.y - snapped.t + rounded.y,
      },
    );
    return Math.max(Math.abs(now.x - was.x), Math.abs(now.y - was.y));
  }

  it("never drifts more than half a cell, including drags clamped past the board edge", () => {
    const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 1 };
    let maxDrift = 0;
    for (const angle of [90, -90]) {
      // A wide sweep, well past the board on every side, so the clamp this
      // bug lived in is exercised as often as the ordinary in-bounds case.
      for (let lx = -5; lx <= 11; lx += 1) {
        for (let ly = -5; ly <= 11; ly += 1) {
          const { snapped, anchor, rounded } = resizeAndRound(
            origin,
            angle,
            { x: lx, y: ly },
            6,
            6,
          );
          maxDrift = Math.max(
            maxDrift,
            anchorDrift(origin, angle, snapped, anchor, rounded),
          );
        }
      }
    }
    // Before the boardInLocalFrame fix this reached a full cell (1.0) at
    // several points in the sweep; 0.5 is the same inherent tradeoff
    // rotatedFootprint already documents and accepts for an odd dimension.
    expect(maxDrift).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("the exact drag from the bug report: past the board edge, corner still whole", () => {
    // A 2x1 bar at the board's near edge, turned -90, then the corner handle
    // dragged well past the far edge — the everyday shape of "rotate it,
    // then expand it" that produced a tile sitting offset from the grid.
    const origin: GridPlacement = { x: 0, y: 0, w: 2, h: 1 };
    const { snapped, anchor, rounded } = resizeAndRound(
      origin,
      -90,
      { x: 8, y: 8 },
      6,
      6,
    );
    expect(Number.isInteger(rounded.x)).toBe(true);
    expect(Number.isInteger(rounded.y)).toBe(true);
    expect(anchorDrift(origin, -90, snapped, anchor, rounded)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

describe("edgeCursor", () => {
  it("maps sides and corners to the standard resize cursors", () => {
    expect(edgeCursor(edge({ e: true }))).toBe("ew-resize");
    expect(edgeCursor(edge({ w: true }))).toBe("ew-resize");
    expect(edgeCursor(edge({ n: true }))).toBe("ns-resize");
    expect(edgeCursor(edge({ s: true }))).toBe("ns-resize");
    expect(edgeCursor(edge({ n: true, w: true }))).toBe("nwse-resize");
    expect(edgeCursor(edge({ s: true, e: true }))).toBe("nwse-resize");
    expect(edgeCursor(edge({ n: true, e: true }))).toBe("nesw-resize");
    expect(edgeCursor(edge({ s: true, w: true }))).toBe("nesw-resize");
  });

  it("turns the arrow to face the way the tilted edge does", () => {
    // The edges are named in the BLOCK's frame. A quarter turn puts its north
    // edge down the left of the screen, so the arrow has to point across.
    expect(edgeCursor(edge({ n: true }), 90)).toBe("ew-resize");
    expect(edgeCursor(edge({ e: true }), 90)).toBe("ns-resize");
    // Half a turn swaps which side is which but not which axis it lies on.
    expect(edgeCursor(edge({ n: true }), 180)).toBe("ns-resize");
    // And it folds onto the nearest of the four cursors in between.
    expect(edgeCursor(edge({ e: true }), 45)).toBe("nwse-resize");
    expect(edgeCursor(edge({ e: true }), -45)).toBe("nesw-resize");
  });
});

/**
 * Shift+Arrow, for a block that may be turned.
 *
 * The bug this pins: the keyboard step used to add straight to `w` on
 * Left/Right and `h` on Up/Down with no regard for rotation, while the mouse
 * resize handle (resizeLocalBox / placementFromLocalBox, above) already
 * un-rotates the pointer to find the block's own edge. A block turned a
 * quarter turn grew SIDEWAYS on screen when Down was pressed — the one
 * keyboard path that disagreed with every other resize gesture in the file.
 */
describe("keyboardResizeStep", () => {
  const RIGHT: [number, number] = [1, 0];
  const LEFT: [number, number] = [-1, 0];
  const UP: [number, number] = [0, -1];
  const DOWN: [number, number] = [0, 1];

  function tile(over: Partial<GridBlock<unknown>> = {}): GridBlock<unknown> {
    return { key: "b", data: null, x: 2, y: 2, w: 2, h: 3, ...over };
  }

  describe("level (0 degrees) — unchanged from before rotation existed", () => {
    it("Right grows width, Left shrinks it, from the same top-left anchor", () => {
      const block = tile();
      expect(keyboardResizeStep(block, RIGHT)).toEqual({ x: 2, y: 2, w: 3, h: 3 });
      expect(keyboardResizeStep(block, LEFT)).toEqual({ x: 2, y: 2, w: 1, h: 3 });
    });

    it("Down grows height, Up shrinks it, from the same top-left anchor", () => {
      const block = tile();
      expect(keyboardResizeStep(block, DOWN)).toEqual({ x: 2, y: 2, w: 2, h: 4 });
      expect(keyboardResizeStep(block, UP)).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    });

    it("never drops below one cell on either axis", () => {
      const thin = tile({ w: 1, h: 1 });
      expect(keyboardResizeStep(thin, LEFT).w).toBe(1);
      expect(keyboardResizeStep(thin, UP).h).toBe(1);
    });

    it("x and y are never touched", () => {
      for (const delta of [RIGHT, LEFT, UP, DOWN]) {
        const step = keyboardResizeStep(tile(), delta);
        expect(step.x).toBe(2);
        expect(step.y).toBe(2);
      }
    });
  });

  describe("turned a quarter turn — the screen direction still wins", () => {
    it("at 90: Left/Right now grow or shrink HEIGHT, not width", () => {
      const block = tile({ rotation: 90 });
      expect(keyboardResizeStep(block, RIGHT)).toEqual({ x: 2, y: 2, w: 2, h: 2 });
      expect(keyboardResizeStep(block, LEFT)).toEqual({ x: 2, y: 2, w: 2, h: 4 });
    });

    it("at 90: Up/Down now grow or shrink WIDTH, not height", () => {
      const block = tile({ rotation: 90 });
      expect(keyboardResizeStep(block, DOWN)).toEqual({ x: 2, y: 2, w: 3, h: 3 });
      expect(keyboardResizeStep(block, UP)).toEqual({ x: 2, y: 2, w: 1, h: 3 });
    });

    it("at -90: the axis swap is the same, but every sign is mirrored from +90", () => {
      const plus = tile({ rotation: 90 });
      const minus = tile({ rotation: -90 });
      for (const delta of [RIGHT, LEFT, UP, DOWN]) {
        const a = keyboardResizeStep(plus, delta);
        const b = keyboardResizeStep(minus, delta);
        // Same axis moves at both angles (a quarter turn either way stands
        // the block on its side)...
        expect(a.w === plus.w).toBe(b.w === minus.w);
        // ...but +90 and -90 are mirror images, so whichever way it moved
        // grows at one angle is the way it shrinks at the other.
        if (a.w !== plus.w) expect(a.w - plus.w).toBe(-(b.w - minus.w));
        if (a.h !== plus.h) expect(a.h - plus.h).toBe(-(b.h - minus.h));
      }
    });

    it("at 180: Left/Right and Up/Down keep their axis but flip which key grows", () => {
      // Upside down, screen-right is the block's own WEST — still the width
      // axis, but now the shrinking direction.
      const block = tile({ rotation: 180 });
      expect(keyboardResizeStep(block, RIGHT)).toEqual({ x: 2, y: 2, w: 1, h: 3 });
      expect(keyboardResizeStep(block, LEFT)).toEqual({ x: 2, y: 2, w: 3, h: 3 });
      expect(keyboardResizeStep(block, DOWN)).toEqual({ x: 2, y: 2, w: 2, h: 2 });
      expect(keyboardResizeStep(block, UP)).toEqual({ x: 2, y: 2, w: 2, h: 4 });
    });

    it("270 behaves exactly like -90, the same angle the other way round", () => {
      for (const delta of [RIGHT, LEFT, UP, DOWN]) {
        expect(keyboardResizeStep(tile({ rotation: 270 }), delta)).toEqual(
          keyboardResizeStep(tile({ rotation: -90 }), delta),
        );
      }
    });
  });

  describe("every angle — the invariants that must hold whatever the tilt", () => {
    const ANGLES = [0, 1, 15, 30, 44, 45, 46, 60, 89, 90, 91, 135, 137, 180, 250, 269, 270, 315, -1, -45, -90, -137, -179];

    it("touches exactly one axis per press, by exactly one cell", () => {
      for (const angle of ANGLES) {
        for (const delta of [RIGHT, LEFT, UP, DOWN]) {
          const block = tile({ rotation: angle });
          const step = keyboardResizeStep(block, delta);
          const dw = step.w - block.w;
          const dh = step.h - block.h;
          expect(Math.abs(dw) + Math.abs(dh), `angle=${angle} delta=${delta}`).toBe(1);
        }
      }
    });

    it("never moves the anchor — x and y are always the block's own", () => {
      for (const angle of ANGLES) {
        for (const delta of [RIGHT, LEFT, UP, DOWN]) {
          const block = tile({ rotation: angle });
          const step = keyboardResizeStep(block, delta);
          expect(step.x).toBe(block.x);
          expect(step.y).toBe(block.y);
        }
      }
    });

    it("opposite keys are exact inverses, so Right then Left is the identity", () => {
      for (const angle of ANGLES) {
        for (const [a, b] of [
          [RIGHT, LEFT],
          [UP, DOWN],
        ] as const) {
          const block = tile({ rotation: angle, w: 3, h: 3 });
          const there = keyboardResizeStep(block, a);
          const back = keyboardResizeStep({ ...block, w: there.w, h: there.h }, b);
          expect(back.w).toBe(block.w);
          expect(back.h).toBe(block.h);
        }
      }
    });

    it("agrees with which axis rotateVector says the arrow points along", () => {
      // The independent check: un-rotate the SAME delta by hand and confirm
      // the function moved whichever axis actually has the larger component.
      for (const angle of ANGLES) {
        for (const delta of [RIGHT, LEFT, UP, DOWN]) {
          const block = tile({ rotation: angle });
          const step = keyboardResizeStep(block, delta);
          const local = rotateVector({ x: delta[0], y: delta[1] }, -angle);
          const expectWidth = Math.abs(local.x) >= Math.abs(local.y);
          expect(step.w !== block.w, `angle=${angle} delta=${delta}`).toBe(expectWidth);
          expect(step.h !== block.h, `angle=${angle} delta=${delta}`).toBe(!expectWidth);
        }
      }
    });

    it("a level result is always a whole number of cells", () => {
      for (const angle of ANGLES) {
        for (const delta of [RIGHT, LEFT, UP, DOWN]) {
          const step = keyboardResizeStep(tile({ rotation: angle }), delta);
          expect(Number.isInteger(step.w)).toBe(true);
          expect(Number.isInteger(step.h)).toBe(true);
        }
      }
    });
  });

  it("an absent rotation behaves exactly like an explicit 0", () => {
    for (const delta of [RIGHT, LEFT, UP, DOWN]) {
      expect(keyboardResizeStep(tile({ rotation: undefined }), delta)).toEqual(
        keyboardResizeStep(tile({ rotation: 0 }), delta),
      );
    }
  });
});
