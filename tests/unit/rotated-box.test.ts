import { describe, it, expect } from "vitest";
import {
  isTransposed,
  orientedSpan,
  placementForFootprint,
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
});

describe("placementForFootprint", () => {
  it("undoes the turn: the rect that COVERS these cells", () => {
    expect(placementForFootprint(box(1, 2, 3, 1), 90)).toEqual(box(2, 1, 1, 3));
    expect(placementForFootprint(box(1, 2, 3, 1), 0)).toEqual(box(1, 2, 3, 1));
  });

  it("round-trips EXACTLY, both ways, at every span and parity", () => {
    // What stops a resize walking the block across the board: drag its edges
    // to cover a set of cells and it covers exactly those cells, so the next
    // drag starts from where the last one finished.
    for (const angle of [0, 90, 180, 270, -90]) {
      for (const w of [1, 2, 3]) {
        for (const h of [1, 2, 3]) {
          const placement = box(2, 1, w, h);
          const covered = rotatedFootprint(placement, angle);
          expect(placementForFootprint(covered, angle)).toEqual(placement);

          const wanted = box(1, 2, w, h);
          const drawn = rotatedFootprint(
            placementForFootprint(wanted, angle),
            angle,
          );
          expect(drawn).toEqual(wanted);
        }
      }
    }
  });

  it("keeps the span whatever the parity", () => {
    // A 2x1 stood on its end has its centre on a half cell, so it cannot land
    // dead on the grid. It must still be a 1x2 and never a 1x3.
    const placement = placementForFootprint(box(0, 0, 2, 1), 90);
    expect(placement.w).toBe(1);
    expect(placement.h).toBe(2);
  });

  it("never returns a negative zero", () => {
    // JSON writes it as 0 either way, but Object.is and toEqual do not, and a
    // coordinate has one zero.
    const placement = placementForFootprint(box(0, 0, 2, 1), 90);
    expect(Object.is(placement.y, -0)).toBe(false);
    expect(Object.is(rotatedFootprint(box(0, 0, 1, 2), 90).y, -0)).toBe(false);
  });
});
