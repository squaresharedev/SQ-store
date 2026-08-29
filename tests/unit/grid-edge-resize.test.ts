import { describe, expect, it } from "vitest";
import {
  EDGE_GRAB_PX,
  boardInLocalFrame,
  edgeCursor,
  edgesUnderPointer,
  placementFromLocalBox,
  resizeLocalBox,
  type GridPlacement,
  type ResizeEdges,
} from "@/components/grid/gridConstants";
import { rotatePoint } from "@/components/grid/rotationMath";

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
