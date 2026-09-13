import { describe, expect, it } from "vitest";
import {
  NO_INSETS,
  centerIntoView,
  panelInset,
  reanchorPan,
  revealPan,
  safeSpan,
  slideIntoView,
  type Box,
} from "@/components/storefront/canvas-geometry";

/**
 * The designer's workspace, roughly a laptop with the editor header above it.
 * Panels are positioned against this in client coordinates, the same way the
 * browser reports them.
 */
const WORKSPACE: Box = { left: 0, top: 60, width: 1200, height: 800 };

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height };
}

describe("panelInset", () => {
  it("charges nothing for a panel docked BESIDE the workspace", () => {
    // The design column on the right is laid out next to the canvas, so the
    // workspace box has already paid for it.
    const rightColumn = box(1200, 60, 320, 800);
    expect(panelInset(WORKSPACE, rightColumn)).toEqual(NO_INSETS);
  });

  it("reads a full-width bottom sheet as a bottom inset", () => {
    // Flush with the left, right AND bottom edges at once, which is why the
    // rule is "cheapest edge to clear" rather than "edge it touches".
    const sheet = box(0, 560, 1200, 400);
    expect(panelInset(WORKSPACE, sheet)).toEqual({ ...NO_INSETS, bottom: 300 });
  });

  it("reads a floating layer as an inset on the edge it hugs", () => {
    // The colour palette: inset a little from the workspace's top-left corner
    // and stopping short of the toolbar, so it is flush with no edge at all.
    const layer = box(12, 72, 280, 680);
    expect(panelInset(WORKSPACE, layer)).toEqual({ ...NO_INSETS, left: 292 });
  });

  it("reads drawers from every side, at any size", () => {
    expect(panelInset(WORKSPACE, box(0, 60, 240, 800))).toEqual({
      ...NO_INSETS,
      left: 240,
    });
    expect(panelInset(WORKSPACE, box(900, 60, 400, 800))).toEqual({
      ...NO_INSETS,
      right: 300,
    });
    expect(panelInset(WORKSPACE, box(0, 0, 1200, 160))).toEqual({
      ...NO_INSETS,
      top: 100,
    });
  });

  it("ignores a floating widget that does not span an edge", () => {
    // A toast in the corner is not a wall, and reserving a whole side for it
    // would cost the board room it is entitled to.
    const toast = box(900, 760, 260, 80);
    expect(panelInset(WORKSPACE, toast)).toEqual(NO_INSETS);
  });

  it("ignores a panel that leaves nothing to recover into", () => {
    const fullScreen = box(0, 60, 1200, 800);
    expect(panelInset(WORKSPACE, fullScreen)).toEqual(NO_INSETS);
  });

  it("ignores a hidden panel, which measures as an empty rect", () => {
    expect(panelInset(WORKSPACE, box(0, 0, 0, 0))).toEqual(NO_INSETS);
  });
});

describe("safeSpan", () => {
  it("takes the insets off both ends", () => {
    expect(safeSpan(1000, 280, 320)).toEqual([280, 680]);
  });

  it("falls back to the whole axis when the strip left is unusable", () => {
    expect(safeSpan(800, 0, 780)).toEqual([0, 800]);
  });
});

describe("slideIntoView", () => {
  it("does not move content that is already visible", () => {
    expect(slideIntoView(100, 300, 0, 1000)).toBe(0);
  });

  it("moves by exactly the overlap, no further", () => {
    expect(slideIntoView(-40, 300, 0, 1000)).toBe(40);
    expect(slideIntoView(800, 300, 0, 1000)).toBe(-100);
  });

  it("leaves content bigger than the room alone", () => {
    // No position shows all of it; sliding would only swap which edge is
    // cropped, out from under the seller's cursor.
    expect(slideIntoView(-200, 1400, 0, 1000)).toBe(0);
    expect(slideIntoView(50, 1400, 0, 1000)).toBe(0);
  });
});

describe("centerIntoView", () => {
  it("puts the run in the middle of the room", () => {
    expect(centerIntoView(0, 300, 0, 1000)).toBe(350);
    expect(centerIntoView(800, 300, 0, 1000)).toBe(-450);
  });

  it("agrees with slideIntoView about which WAY to move", () => {
    // The recover rule guards on the sign of the minimal move and then hands
    // back the centring one, so the two must never disagree about direction.
    for (const pos of [-400, -40, 0, 700, 800, 1200]) {
      const minimal = slideIntoView(pos, 300, 0, 1000);
      if (minimal === 0) continue;
      expect(Math.sign(centerIntoView(pos, 300, 0, 1000))).toBe(
        Math.sign(minimal),
      );
    }
  });

  it("gives up on exactly the same cases slideIntoView does", () => {
    expect(centerIntoView(-200, 1400, 0, 1000)).toBe(0);
    expect(centerIntoView(50, 300, 400, 400)).toBe(0);
  });
});

describe("revealPan", () => {
  const workspace: Box = { left: 0, top: 60, width: 390, height: 700 };

  it("leaves a selection that is already in the open exactly where it is", () => {
    // Every selection on a desktop, and the reason clicking around the board
    // does not send it sliding about.
    const tile: Box = { left: 40, top: 40, width: 96, height: 96 };
    expect(
      revealPan({
        pan: { x: 0, y: 0 },
        zoom: 1,
        workspace,
        insets: { ...NO_INSETS, bottom: 420 },
        anchor: tile,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("centres a selection the sheet is sitting on", () => {
    // 100..196 across and 380..476 down, with [0, 390] and [0, 280] to work
    // with: across it is already fine, down it comes to 92..188.
    const tile: Box = { left: 100, top: 380, width: 96, height: 96 };
    expect(
      revealPan({
        pan: { x: 0, y: 0 },
        zoom: 1,
        workspace,
        insets: { ...NO_INSETS, bottom: 420 },
        anchor: tile,
      }),
    ).toEqual({ x: 0, y: -288 });
  });

  it("does not evict the board's own edge from the strip to centre a tile", () => {
    // The board's top carries the masthead and the preview switch, and on a
    // phone they ride the same pan. This tile can be revealed with the board's
    // top still inside the strip, so the extra half of the centring move is
    // given up rather than spent pushing that top out of view.
    const board: Box = { left: 0, top: 0, width: 340, height: 300 };
    const tile: Box = { left: 100, top: 250, width: 60, height: 40 };
    const pan = { x: 0, y: 20 };
    const { y } = revealPan({
      pan,
      zoom: 1,
      workspace,
      insets: { ...NO_INSETS, bottom: 400 },
      anchor: tile,
      board,
    });
    // Room is [0, 300]. The tile paints at 270..310, so it needs 10 to come
    // in and 140 to centre — but the board's top is only 20 clear, so 20 is as
    // far as it goes. Still revealed, just not perfectly centred.
    expect(y).toBe(0);
  });

  it("centres anyway once the reveal has already spent that edge", () => {
    // Same board, a tile far enough down that no pan showing it can keep the
    // board's top in the strip. The edge is gone either way, so holding back
    // the rest of the move would buy nothing.
    const board: Box = { left: 0, top: 0, width: 340, height: 900 };
    const tile: Box = { left: 100, top: 700, width: 60, height: 40 };
    const { y } = revealPan({
      pan: { x: 0, y: 0 },
      zoom: 1,
      workspace,
      insets: { ...NO_INSETS, bottom: 500 },
      anchor: tile,
      board,
    });
    // Room is [0, 200]; centred puts the tile at 80..120, i.e. up by 620.
    expect(y).toBe(-620);
  });

  it("falls back to the bare tile when the strip cannot hold its chrome", () => {
    // withChrome is 96 + 60 of handles = taller than the 120px strip, so it
    // could never fit and asking for it would move nothing at all. The bare
    // cell fits, and centres.
    const tile: Box = { left: 100, top: 380, width: 96, height: 96 };
    const withChrome: Box = { left: 100, top: 380, width: 96, height: 156 };
    expect(
      revealPan({
        pan: { x: 0, y: 0 },
        zoom: 1,
        workspace,
        insets: { ...NO_INSETS, bottom: 580 },
        anchor: withChrome,
        anchorFallback: tile,
      }),
    ).toEqual({ x: 0, y: -368 });
  });
});

describe("reanchorPan", () => {
  /** A board comfortably smaller than the workspace. */
  const board: Box = { left: 0, top: 0, width: 600, height: 500 };
  const wide = box(0, 60, 1200, 800);
  /** The same workspace with a 280px column DOCKED beside it. */
  const narrowed = box(280, 60, 920, 800);

  it("holds the board still when a docked panel moves the workspace corner", () => {
    // The workspace starts 280px further right, so the pan has to come back by
    // the same 280 to stay on the same screen pixels. The board sat clear of
    // that strip, so nothing else happens.
    const { pan } = reanchorPan({
      pan: { x: 500, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: narrowed,
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    expect(pan).toEqual({ x: 220, y: 100 });
  });

  it("slides out from under a docked panel that lands on the board", () => {
    // Same panel, but the board was parked at the left edge: holding it still
    // would put its first 180px behind the column, so it steps clear.
    const { pan } = reanchorPan({
      pan: { x: 100, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: narrowed,
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    // Held still at -180, then the least move that clears the panel.
    expect(pan).toEqual({ x: 0, y: 100 });
  });

  it("separates the correction from the move", () => {
    // `hold` is where the board already was on screen and is applied in the
    // same frame; only the difference between it and `pan` is a real move that
    // may be eased. Easing the correction would draw the very slide it exists
    // to hide.
    const { hold, pan } = reanchorPan({
      pan: { x: 100, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: narrowed,
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    expect(hold).toEqual({ x: -180, y: 100 });
    expect(pan).toEqual({ x: 0, y: 100 });
  });

  it("needs no correction at all for a panel that FLOATS over the canvas", () => {
    // The colour layer and every bottom sheet: the workspace box is untouched,
    // so there is nothing to hold, only cover to get out from under.
    const { hold, pan } = reanchorPan({
      pan: { x: 40, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: wide,
      insets: { ...NO_INSETS, left: 280 },
      board,
      anchor: board,
    });
    expect(hold).toEqual({ x: 40, y: 100 });
    expect(pan).toEqual({ x: 280, y: 100 });
  });

  it("does nothing when a panel only narrows the workspace clear of the board", () => {
    // The right-hand column: same corner, smaller box, board untouched.
    const { pan } = reanchorPan({
      pan: { x: 40, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: box(0, 60, 880, 800),
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    expect(pan).toEqual({ x: 40, y: 100 });
  });

  it("does not haul back a board the seller had parked off the edge", () => {
    // Closing the column gives 280px back. The board's right end was already
    // past the workspace before that, by the seller's own hand, and freeing
    // room is not permission to undo their pan.
    const { pan } = reanchorPan({
      pan: { x: 700, y: 100 },
      zoom: 1,
      previous: narrowed,
      previousInsets: NO_INSETS,
      workspace: wide,
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    // Held still (980 in the old box, 1280 in the new one): same screen pixels.
    expect(pan).toEqual({ x: 980, y: 100 });
  });

  it("lifts the board off a bottom sheet, which never moves the corner", () => {
    const workspace = box(0, 60, 390, 700);
    const { pan } = reanchorPan({
      pan: { x: 20, y: 400 },
      zoom: 0.5,
      previous: workspace,
      previousInsets: NO_INSETS,
      workspace,
      insets: { ...NO_INSETS, bottom: 420 },
      board,
      anchor: board,
    });
    // 250px of board (500 * 0.5) starting at 400, with only [0, 280] visible.
    expect(pan).toEqual({ x: 20, y: 30 });
  });

  it("puts the board back down when that sheet closes again", () => {
    const workspace = box(0, 60, 390, 700);
    const { pan } = reanchorPan({
      pan: { x: 20, y: 30 },
      zoom: 0.5,
      previous: workspace,
      previousInsets: { ...NO_INSETS, bottom: 420 },
      workspace,
      insets: NO_INSETS,
      board,
      anchor: board,
    });
    // Nothing moved the corner and nothing is covering the board any more, so
    // it stays exactly where the sheet left it.
    expect(pan).toEqual({ x: 20, y: 30 });
  });

  it("prefers the WHOLE BOARD over the selection while the board still fits", () => {
    // A board that can be shown entirely should be: clearing the panel by just
    // enough to reveal the selected tile would leave the board's own edge
    // tucked under it, which reads as a bug rather than as restraint.
    const tile: Box = { left: 200, top: 40, width: 96, height: 96 };
    const { pan } = reanchorPan({
      pan: { x: 40, y: 100 },
      zoom: 1,
      previous: wide,
      previousInsets: NO_INSETS,
      workspace: wide,
      insets: { ...NO_INSETS, left: 280 },
      board,
      anchor: tile,
    });
    // The tile alone would have needed 40 to clear; the board needs 240.
    expect(pan).toEqual({ x: 280, y: 100 });
  });

  it("CENTRES a selected tile in the strip a sheet leaves behind", () => {
    const workspace = box(0, 60, 390, 700);
    const tile: Box = { left: 100, top: 380, width: 96, height: 96 };
    const { pan } = reanchorPan({
      pan: { x: 0, y: 0 },
      zoom: 1,
      previous: workspace,
      previousInsets: NO_INSETS,
      workspace,
      insets: { ...NO_INSETS, bottom: 420 },
      board,
      anchor: tile,
    });
    // The tile ran from 380 to 476 with only [0, 280] left. Coming up by the
    // least it could (196) would land it at 184..280 — flush with the sheet's
    // own top edge, which is where its resize and rotate handles hang, so they
    // would be buried by the very panel it was just revealed from under. It
    // centres in the strip instead: 92..188, i.e. up by 288.
    expect(pan).toEqual({ x: 0, y: -288 });
  });

  it("still clears the WHOLE BOARD by the least it can, never centring it", () => {
    // Centring is for a selection, which is the seller pointing at something.
    // The board merely being tucked under a panel's edge asks for exactly one
    // thing — get out from under it — and re-centring it in the workspace is a
    // far bigger move than anything the panel justified.
    const workspace = box(0, 60, 1200, 800);
    const { pan } = reanchorPan({
      pan: { x: 100, y: 100 },
      zoom: 1,
      previous: workspace,
      previousInsets: NO_INSETS,
      workspace,
      insets: { ...NO_INSETS, left: 280 },
      board,
      anchor: board,
    });
    // Flush with the panel's inner edge; centred it would have been at 460.
    expect(pan).toEqual({ x: 280, y: 100 });
  });

  it("scales both boxes by the zoom", () => {
    const workspace = box(0, 60, 1000, 800);
    const tile: Box = { left: 400, top: 0, width: 100, height: 100 };
    const { pan } = reanchorPan({
      pan: { x: 0, y: 0 },
      zoom: 2,
      previous: workspace,
      previousInsets: NO_INSETS,
      workspace,
      insets: { ...NO_INSETS, left: 300 },
      board,
      anchor: tile,
    });
    // At 2x the board is 1200 wide against 700 of room, so the tile answers:
    // it paints at 800..1000, already inside [300, 1000]. Nothing to do.
    expect(pan.x).toBe(0);
  });
});
