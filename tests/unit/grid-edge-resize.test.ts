import { describe, expect, it } from "vitest";
import {
  EDGE_GRAB_PX,
  edgeCursor,
  edgesUnderPointer,
  resizeByEdges,
  type GridPlacement,
  type ResizeEdges,
} from "@/components/grid/gridConstants";

/**
 * Edge-grab resize contract: a press near a cell border resizes from that
 * side; the inner surface stays a move. These pin the pure halves the Grid's
 * gesture wiring stands on: the hit-test (edgesUnderPointer), the placement
 * math with pinned opposite sides (resizeByEdges), and the cursor mapping.
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

describe("resizeByEdges", () => {
  const origin: GridPlacement = { x: 2, y: 2, w: 2, h: 2 };
  const COLS = 8;
  const ROWS = 8;

  it("east drag grows and shrinks the width, x pinned", () => {
    expect(resizeByEdges(origin, edge({ e: true }), 6, 3, COLS, ROWS)).toEqual({
      x: 2, y: 2, w: 5, h: 2,
    });
    expect(resizeByEdges(origin, edge({ e: true }), 2, 3, COLS, ROWS)).toEqual({
      x: 2, y: 2, w: 1, h: 2,
    });
  });

  it("west drag moves x and grows w, right edge pinned", () => {
    expect(resizeByEdges(origin, edge({ w: true }), 0, 3, COLS, ROWS)).toEqual({
      x: 0, y: 2, w: 4, h: 2,
    });
    // Dragged inward: shrinks toward the pinned right edge.
    expect(resizeByEdges(origin, edge({ w: true }), 3, 3, COLS, ROWS)).toEqual({
      x: 3, y: 2, w: 1, h: 2,
    });
  });

  it("north/south drags mirror the horizontal behavior", () => {
    expect(resizeByEdges(origin, edge({ n: true }), 3, 0, COLS, ROWS)).toEqual({
      x: 2, y: 0, w: 2, h: 4,
    });
    expect(resizeByEdges(origin, edge({ s: true }), 3, 7, COLS, ROWS)).toEqual({
      x: 2, y: 2, w: 2, h: 6,
    });
  });

  it("corner drags resize both axes at once", () => {
    expect(
      resizeByEdges(origin, edge({ s: true, e: true }), 5, 6, COLS, ROWS),
    ).toEqual({ x: 2, y: 2, w: 4, h: 5 });
    expect(
      resizeByEdges(origin, edge({ n: true, w: true }), 0, 0, COLS, ROWS),
    ).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it("never collapses below one cell, even dragged past the far side", () => {
    expect(resizeByEdges(origin, edge({ w: true }), 7, 3, COLS, ROWS)).toEqual({
      x: 3, y: 2, w: 1, h: 2,
    });
    expect(resizeByEdges(origin, edge({ n: true }), 3, 7, COLS, ROWS)).toEqual({
      x: 2, y: 3, w: 2, h: 1,
    });
  });

  it("clamps the cursor to the board so the result stays inside", () => {
    expect(resizeByEdges(origin, edge({ e: true }), 99, 3, COLS, ROWS)).toEqual({
      x: 2, y: 2, w: 6, h: 2,
    });
    expect(resizeByEdges(origin, edge({ w: true }), -5, 3, COLS, ROWS)).toEqual({
      x: 0, y: 2, w: 4, h: 2,
    });
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
});
