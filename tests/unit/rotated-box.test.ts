import { describe, it, expect } from "vitest";
import {
  footprintOffset,
  isTransposed,
  orientedSpan,
  rotatedFootprint,
} from "@/lib/geometry/rotated-box";

/**
 * Where a turned block sits.
 *
 * The rule the whole editor rests on: turning a block changes which way round
 * its cells lie and NOTHING else. It cannot gain a cell, lose one, or move.
 * Anything else and a rotate control starts behaving like a resize, which is
 * the complaint that produced this module in its current form.
 */

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("isTransposed", () => {
  it("is true for the quarter turns and false for level", () => {
    for (const angle of [90, -90, 270, -270, 450]) {
      expect(isTransposed(angle)).toBe(true);
    }
    for (const angle of [0, 180, -180, 360]) {
      expect(isTransposed(angle)).toBe(false);
    }
  });

  it("follows the NEAREST quarter turn for everything in between", () => {
    expect(isTransposed(20)).toBe(false);
    expect(isTransposed(44)).toBe(false);
    expect(isTransposed(60)).toBe(true);
    expect(isTransposed(-100)).toBe(true);
    expect(isTransposed(160)).toBe(false);
  });
});

describe("orientedSpan", () => {
  it("keeps the same two numbers, in the order the turn leaves them", () => {
    expect(orientedSpan(1, 3, 0)).toEqual({ w: 1, h: 3 });
    expect(orientedSpan(1, 3, 180)).toEqual({ w: 1, h: 3 });
    expect(orientedSpan(1, 3, 90)).toEqual({ w: 3, h: 1 });
    expect(orientedSpan(1, 3, -90)).toEqual({ w: 3, h: 1 });
  });

  it("never changes the AREA, at any angle", () => {
    // The rule in one assertion: a turned block takes the same number of
    // squares as it did before it was turned.
    for (const angle of [0, 15, 45, 90, 137, 180, 250, 315, -47]) {
      const span = orientedSpan(2, 5, angle);
      expect(span.w * span.h).toBe(10);
    }
  });
});

describe("rotatedFootprint", () => {
  it("is the block's own rect when it is level", () => {
    expect(rotatedFootprint(box(1, 2, 2, 3), 0)).toEqual(box(1, 2, 2, 3));
    expect(rotatedFootprint(box(1, 2, 2, 3), 180)).toEqual(box(1, 2, 2, 3));
    expect(rotatedFootprint(box(1, 2, 2, 3))).toEqual(box(1, 2, 2, 3));
  });

  it("stands a bar on its side about its own centre", () => {
    // A 1x3 at column 2, rows 1..3 turns about (2.5, 2.5) and lies across
    // columns 1..3 of row 2. Three cells before, three cells after.
    expect(rotatedFootprint(box(2, 1, 1, 3), 90)).toEqual(box(1, 2, 3, 1));
    expect(rotatedFootprint(box(2, 1, 1, 3), -90)).toEqual(box(1, 2, 3, 1));
  });

  it("never grows, at any angle", () => {
    // The 45 degree case is the one that used to claim nine cells for one.
    for (const angle of [0, 30, 45, 90, 135, 180, 270]) {
      const covered = rotatedFootprint(box(1, 1, 1, 1), angle);
      expect(covered.w).toBe(1);
      expect(covered.h).toBe(1);
    }
    for (const angle of [0, 30, 45, 90, 135, 180, 270]) {
      const covered = rotatedFootprint(box(0, 0, 2, 4), angle);
      expect(covered.w * covered.h).toBe(8);
    }
  });

  it("reports cells off the board rather than quietly moving the block", () => {
    // A bar in the corner really does reach past the edge when it is stood on
    // its side. Saying so is the caller's business to act on (or, as the
    // editor does, to leave alone); hiding it would be a lie about where the
    // block is.
    expect(rotatedFootprint(box(0, 0, 1, 3), 90)).toEqual(box(-1, 1, 3, 1));
  });

  it("does not mutate the box it is given", () => {
    const original = box(2, 1, 1, 3);
    rotatedFootprint(original, 90);
    expect(original).toEqual(box(2, 1, 1, 3));
  });

  it("never returns a negative zero", () => {
    // JSON writes it as 0 either way, but Object.is and toEqual do not, and a
    // coordinate has one zero.
    expect(Object.is(rotatedFootprint(box(0, 0, 1, 2), 90).y, -0)).toBe(false);
  });
});

/**
 * WHERE A TURNED BLOCK PAINTS, and the nudge that puts it on the cells it claims.
 *
 * The bug this closes: rotate a block, resize it, and the whole tile sits
 * offset from the board — visibly out of line with every level tile beside it,
 * and not on the cells its own ghost promised. It happens whenever a block
 * whose width and height differ in parity is stood on its side, because turning
 * about the centre moves the corners by (w - h) / 2, a HALF cell.
 *
 * The nudge follows the FOOTPRINT, not the exact angle. Gating it on a perfect
 * 90 left 89 and 91 sitting half a cell away from 90, so the tile stepped
 * sideways as it was turned through the very angle a seller aims for. There is
 * one discontinuity to spend and isTransposed already spends it at 45.
 */
describe("footprintOffset", () => {
  /** Where the box's corner really lands once turned, before any nudge. */
  function paintedOrigin(b: ReturnType<typeof box>, degrees: number) {
    const span = orientedSpan(b.w, b.h, degrees);
    return {
      x: b.x + b.w / 2 - span.w / 2,
      y: b.y + b.h / 2 - span.h / 2,
    };
  }

  /** Quarter turns, and the angles either side of them a seller really lands
   *  on — the ones that used to be left half a cell out. */
  const TRANSPOSING = [90, 91, 89, 85, 95, 60, 46, -90, -91, -85, 270, 274];
  const LEVELISH = [0, 1, 20, 44, 180, 179, 137, 360, -44];

  it("is nothing at all for a block that already lands on the grid", () => {
    // Level, half turned, or stood on its side with its two dimensions
    // matching in parity: every one of these is already on a line, so a nudge
    // would be pure drift.
    expect(footprintOffset(box(1, 2, 2, 3), 0)).toEqual({ x: 0, y: 0 });
    expect(footprintOffset(box(1, 2, 2, 3), 180)).toEqual({ x: 0, y: 0 });
    expect(footprintOffset(box(1, 2, 2, 2), 90)).toEqual({ x: 0, y: 0 });
    expect(footprintOffset(box(2, 1, 1, 3), 90)).toEqual({ x: 0, y: 0 });
    expect(footprintOffset(box(0, 0, 2, 4), -90)).toEqual({ x: 0, y: 0 });
  });

  it("is half a cell on each axis when the two dimensions differ in parity", () => {
    // The everyday shape of the bug: a square block grown by one cell while it
    // is standing on its side.
    expect(footprintOffset(box(0, 0, 2, 1), 90)).toEqual({ x: -0.5, y: -0.5 });
    expect(footprintOffset(box(3, 2, 3, 2), -90)).toEqual({ x: -0.5, y: -0.5 });
  });

  it("TREATS 85 AND 91 EXACTLY LIKE 90 — no step through the right angle", () => {
    // The complaint: it worked at 90 and nowhere near it, so turning a tile the
    // last degree onto the detent shifted the whole container half a cell.
    const bar = box(0, 0, 2, 1);
    const at90 = footprintOffset(bar, 90);
    for (const angle of [85, 88, 89, 91, 92, 95]) {
      expect(footprintOffset(bar, angle), `${angle}`).toEqual(at90);
    }
    const back = footprintOffset(bar, -90);
    for (const angle of [-85, -89, -91, -95]) {
      expect(footprintOffset(bar, angle), `${angle}`).toEqual(back);
    }
  });

  it("nudges every angle the footprint transposes, and no other", () => {
    // The rule in one assertion: the nudge is the footprint's, so it applies
    // exactly where the footprint has swapped the block's two spans over.
    const bar = box(0, 0, 2, 1);
    for (const angle of TRANSPOSING) {
      expect(isTransposed(angle), `${angle}`).toBe(true);
      expect(footprintOffset(bar, angle), `${angle}`).toEqual({
        x: -0.5,
        y: -0.5,
      });
    }
    for (const angle of LEVELISH) {
      expect(isTransposed(angle), `${angle}`).toBe(false);
      expect(footprintOffset(bar, angle), `${angle}`).toEqual({ x: 0, y: 0 });
    }
  });

  it("never returns a negative zero", () => {
    for (const angle of [...TRANSPOSING, ...LEVELISH]) {
      for (const b of [box(0, 0, 1, 1), box(2, 3, 2, 2), box(1, 1, 3, 1)]) {
        const offset = footprintOffset(b, angle);
        expect(Object.is(offset.x, -0), `${angle}`).toBe(false);
        expect(Object.is(offset.y, -0), `${angle}`).toBe(false);
      }
    }
  });

  it("PUTS EVERY TURNED BLOCK ON A WHOLE CELL — the whole point", () => {
    // The sweep. Every placement and every span the board can hold, at every
    // angle either side of a quarter turn as well as on it: the corner the tile
    // paints on must land on a grid line, never between two.
    for (const angle of [...TRANSPOSING, ...LEVELISH]) {
      for (let x = 0; x < 6; x += 1) {
        for (let y = 0; y < 6; y += 1) {
          for (let w = 1; w <= 6 - x; w += 1) {
            for (let h = 1; h <= 6 - y; h += 1) {
              const b = box(x, y, w, h);
              const painted = paintedOrigin(b, angle);
              const offset = footprintOffset(b, angle);
              const landed = {
                x: painted.x + offset.x,
                y: painted.y + offset.y,
              };
              const where = `${angle}deg ${x},${y} ${w}x${h}`;
              expect(Number.isInteger(landed.x), where).toBe(true);
              expect(Number.isInteger(landed.y), where).toBe(true);
              // Never more than the half cell it is there to close.
              expect(Math.abs(offset.x), where).toBeLessThanOrEqual(0.5);
              expect(Math.abs(offset.y), where).toBeLessThanOrEqual(0.5);
            }
          }
        }
      }
    }
  });

  it("lands the block on exactly the cells its footprint claims", () => {
    // The invariant that makes the nudge safe rather than merely tidy: the
    // ghost a drag draws, the cells the board treats as taken, and the box the
    // tile paints are all one rect. Before this they could differ by half a
    // cell, so a tile landed beside the ghost that promised it — and while the
    // nudge was gated on an exact 90, they still did at every angle near it.
    for (const angle of [...TRANSPOSING, ...LEVELISH]) {
      for (let x = 0; x < 5; x += 1) {
        for (let y = 0; y < 5; y += 1) {
          for (let w = 1; w <= 4; w += 1) {
            for (let h = 1; h <= 4; h += 1) {
              const b = box(x, y, w, h);
              const painted = paintedOrigin(b, angle);
              const offset = footprintOffset(b, angle);
              const covered = rotatedFootprint(b, angle);
              const where = `${angle}deg ${x},${y} ${w}x${h}`;
              expect(painted.x + offset.x, where).toBe(covered.x);
              expect(painted.y + offset.y, where).toBe(covered.y);
            }
          }
        }
      }
    }
  });

  it("does not mutate the box it is given", () => {
    const original = box(0, 0, 2, 1);
    footprintOffset(original, 90);
    expect(original).toEqual(box(0, 0, 2, 1));
  });
});
