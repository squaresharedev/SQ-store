import { describe, expect, it } from "vitest";
import {
  boardLanding,
  clampOntoBoard,
  clampStep,
  isOnBoard,
  isTransposed,
  moveReach,
  rotatedFootprint,
  type Box,
} from "@/lib/geometry/rotated-box";
import {
  findFreeCell,
  placementIsFree,
  type GridBlock,
} from "@/components/grid/gridConstants";

/**
 * A TURNED BLOCK GOES WHEREVER IT VISIBLY FITS.
 *
 * The bug: turn a tile, even a clean 90 degrees, and it refuses cells it
 * plainly fits in, most visibly the top and bottom rows for a turned bar and
 * the last column for a turned 2x1. Every gesture held the block's STORED rect
 * to the board, and a turned block's stored rect shares a centre with its
 * footprint, so against an edge the stored rect reaches past the board while
 * every cell the tile covers is on it.
 *
 * These sweep every span a handful of boards can hold, at every kind of angle,
 * and pin the promise from both sides: every footprint that fits is reachable
 * by a move from anywhere on the board, and nothing a clamp hands back is ever
 * off it. Failures are collected rather than asserted one by one, so a sweep of
 * a few hundred thousand cases stays fast and reports the first few that broke.
 */

const BOARDS = [
  { columns: 6, rows: 6 },
  { columns: 3, rows: 8 },
  { columns: 8, rows: 3 },
  { columns: 12, rows: 5 },
  { columns: 4, rows: 2 },
];

/** Quarter turns, the angles either side of them, and angles nearer level. */
const ANGLES = [0, 90, -90, 180, 270, 89, 91, 46, 44, 20, -135, 135];

function* spans(columns: number, rows: number) {
  for (let w = 1; w <= columns; w += 1) {
    for (let h = 1; h <= rows; h += 1) yield { w, h };
  }
}

/** Every whole-cell origin within a board's width of the board, either way. */
function* origins(columns: number, rows: number) {
  const reach = Math.max(columns, rows);
  for (let y = -reach; y <= rows + 1; y += 1) {
    for (let x = -reach; x <= columns + 1; x += 1) yield { x, y };
  }
}

function inside(start: number, span: number, size: number) {
  return start >= 0 && start + span <= size;
}

/** Collects failures; the test asserts the list is empty. */
function failures() {
  const found: string[] = [];
  return {
    add(message: string) {
      if (found.length < 10) found.push(message);
    },
    get list() {
      return found;
    },
  };
}

const at = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

describe("the bug, as a seller meets it", () => {
  it("a quarter-turned 1x3 bar can lie across the top row and the bottom row", () => {
    // Stored 1x3 at column 2, turned: it covers columns 1..3 of the row below
    // its stored top. Lying across row 0 therefore stores y = -1.
    const landing = boardLanding(at(2, 1, 1, 3), 90, 6, 6);
    expect(landing.y).toEqual({ min: -1, max: 4 });
    expect(rotatedFootprint(at(2, -1, 1, 3), 90)).toEqual(at(1, 0, 3, 1));
    expect(rotatedFootprint(at(2, 4, 1, 3), 90)).toEqual(at(1, 5, 3, 1));

    // The drag from the middle of the board all the way up and all the way
    // down arrives, rather than stopping a row short at either end.
    const reach = moveReach(at(2, 1, 1, 3), 90, 6, 6);
    expect(clampStep(-9, reach.y)).toBe(-2);
    expect(clampStep(9, reach.y)).toBe(3);
  });

  it("a quarter-turned 2x1 can stand in the last column", () => {
    // Standing, it covers one column: the stored rect's own. In the last
    // column its stored rect runs one past the right edge.
    const landing = boardLanding(at(0, 2, 2, 1), 90, 6, 6);
    expect(landing.x).toEqual({ min: 0, max: 5 });
    expect(rotatedFootprint(at(5, 2, 2, 1), 90)).toEqual(at(5, 1, 1, 2));
    expect(isOnBoard(at(5, 2, 2, 1), 90, 6, 6)).toBe(true);
  });

  it("the rule for a level block is unchanged: its rect, on the board", () => {
    expect(boardLanding(at(0, 0, 2, 3), 0, 6, 6)).toEqual({
      x: { min: 0, max: 4 },
      y: { min: 0, max: 3 },
    });
    expect(isOnBoard(at(0, -1, 1, 3), 0, 6, 6)).toBe(false);
    expect(isOnBoard(at(5, 0, 2, 1), 0, 6, 6)).toBe(false);
  });
});

describe("isOnBoard", () => {
  it("is true exactly when the span fits and, per axis, either rect is inside", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns + 1, rows + 1)) {
        for (const angle of ANGLES) {
          for (const { x, y } of origins(columns, rows)) {
            const box = at(x, y, w, h);
            const covered = rotatedFootprint(box, angle);
            const expected =
              w <= columns &&
              h <= rows &&
              (inside(x, w, columns) || inside(covered.x, covered.w, columns)) &&
              (inside(y, h, rows) || inside(covered.y, covered.h, rows));
            if (isOnBoard(box, angle, columns, rows) !== expected) {
              bad.add(`${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`);
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("counts every footprint wholly on the board as on it", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          for (const { x, y } of origins(columns, rows)) {
            const box = at(x, y, w, h);
            const covered = rotatedFootprint(box, angle);
            const fits =
              inside(covered.x, covered.w, columns) &&
              inside(covered.y, covered.h, rows);
            if (fits && !isOnBoard(box, angle, columns, rows)) {
              bad.add(`${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`);
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });
});

describe("boardLanding", () => {
  it("names exactly the origins where the rect a move aims for is on the board", () => {
    // By the footprint along an axis it fits, otherwise by the stored rect.
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          const landing = boardLanding(at(0, 0, w, h), angle, columns, rows);
          for (const { x, y } of origins(columns, rows)) {
            const box = at(x, y, w, h);
            const covered = rotatedFootprint(box, angle);
            const onX =
              covered.w <= columns
                ? inside(covered.x, covered.w, columns)
                : inside(x, w, columns);
            const onY =
              covered.h <= rows
                ? inside(covered.y, covered.h, rows)
                : inside(y, h, rows);
            const listed =
              x >= landing.x.min &&
              x <= landing.x.max &&
              y >= landing.y.min &&
              y <= landing.y.max;
            const where = `${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`;
            if (listed !== (onX && onY)) bad.add(`listed=${listed} ${where}`);
            if (listed && !isOnBoard(box, angle, columns, rows)) {
              bad.add(`listed but off the board: ${where}`);
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("does not depend on which origin it is asked from", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          const expected = JSON.stringify(
            boardLanding(at(0, 0, w, h), angle, columns, rows),
          );
          for (const { x, y } of origins(columns, rows)) {
            const got = JSON.stringify(
              boardLanding(at(x, y, w, h), angle, columns, rows),
            );
            if (got !== expected) {
              bad.add(`${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`);
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });
});

describe("moveReach", () => {
  it("THE BUG: from anywhere on the board, a move reaches every spot the block fits", () => {
    // Every on-board origin, every footprint position that fits: the step
    // there must come back from the clamp untouched.
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          const span = rotatedFootprint(at(0, 0, w, h), angle);
          if (span.w > columns || span.h > rows) continue;
          for (const { x, y } of origins(columns, rows)) {
            const origin = at(x, y, w, h);
            if (!isOnBoard(origin, angle, columns, rows)) continue;
            const from = rotatedFootprint(origin, angle);
            const reach = moveReach(origin, angle, columns, rows);
            for (let fy = 0; fy + span.h <= rows; fy += 1) {
              for (let fx = 0; fx + span.w <= columns; fx += 1) {
                const step = { x: fx - from.x, y: fy - from.y };
                if (
                  clampStep(step.x, reach.x) !== step.x ||
                  clampStep(step.y, reach.y) !== step.y
                ) {
                  bad.add(
                    `${columns}x${rows} ${angle}deg ${w}x${h} from ${x},${y} to footprint ${fx},${fy}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("never lands a block that started on the board off it, however far the hand goes", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          for (const { x, y } of origins(columns, rows)) {
            const origin = at(x, y, w, h);
            if (!isOnBoard(origin, angle, columns, rows)) continue;
            const reach = moveReach(origin, angle, columns, rows);
            for (let sy = -rows - 2; sy <= rows + 2; sy += 1) {
              for (let sx = -columns - 2; sx <= columns + 2; sx += 1) {
                const landed = at(
                  x + clampStep(sx, reach.x),
                  y + clampStep(sy, reach.y),
                  w,
                  h,
                );
                if (!isOnBoard(landed, angle, columns, rows)) {
                  bad.add(
                    `${columns}x${rows} ${angle}deg ${w}x${h} from ${x},${y} step ${sx},${sy}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("never pushes against the hand, never overshoots it, and always allows standing still", () => {
    // The manners that make it safe to hand any block to it, including one
    // already hanging past an edge: a group intersects these ranges, and that
    // only works because every one of them contains zero.
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns + 1, rows + 1)) {
        for (const angle of [0, 90, 45, 180]) {
          for (const { x, y } of origins(columns, rows)) {
            const reach = moveReach(at(x, y, w, h), angle, columns, rows);
            const where = `${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`;
            for (const axis of [reach.x, reach.y]) {
              if (!(axis.min <= 0 && axis.max >= 0)) bad.add(`no zero: ${where}`);
              for (let step = -8; step <= 8; step += 1) {
                const got = clampStep(step, axis);
                if (Math.sign(got) !== 0 && Math.sign(got) !== Math.sign(step)) {
                  bad.add(`against the hand (${step} -> ${got}): ${where}`);
                }
                if (Math.abs(got) > Math.abs(step)) {
                  bad.add(`overshoot (${step} -> ${got}): ${where}`);
                }
              }
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("leaves a block turned against an edge where it is until the hand brings it in", () => {
    // A turn never moves a block, so a 1x3 at the left edge turned flat hangs a
    // cell past it (footprint at column -1). Dragging it further left does
    // nothing; dragging it right by one puts the whole bar on the board.
    const origin = at(0, 1, 1, 3);
    expect(rotatedFootprint(origin, 90).x).toBe(-1);
    const reach = moveReach(origin, 90, 6, 6);
    expect(clampStep(-3, reach.x)).toBe(0);
    expect(clampStep(1, reach.x)).toBe(1);
    expect(rotatedFootprint(at(1, 1, 1, 3), 90).x).toBe(0);
  });
});

describe("clampOntoBoard", () => {
  it("leaves every axis that is already on the board exactly where it is", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of ANGLES) {
          for (const { x, y } of origins(columns, rows)) {
            const box = at(x, y, w, h);
            const covered = rotatedFootprint(box, angle);
            const got = clampOntoBoard(box, angle, columns, rows);
            const where = `${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`;
            if (
              (inside(x, w, columns) || inside(covered.x, covered.w, columns)) &&
              got.x !== x
            ) {
              bad.add(`moved x: ${where}`);
            }
            if (
              (inside(y, h, rows) || inside(covered.y, covered.h, rows)) &&
              got.y !== y
            ) {
              bad.add(`moved y: ${where}`);
            }
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("puts anything at all back on the board, span capped to the board", () => {
    const bad = failures();
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns + 2, rows + 2)) {
        for (const angle of ANGLES) {
          for (const { x, y } of origins(columns, rows)) {
            const got = clampOntoBoard(at(x, y, w, h), angle, columns, rows);
            const where = `${columns}x${rows} ${angle}deg ${x},${y} ${w}x${h}`;
            if (got.w !== Math.min(w, columns) || got.h !== Math.min(h, rows)) {
              bad.add(`span: ${where}`);
            }
            if (!isOnBoard(got, angle, columns, rows)) bad.add(`off: ${where}`);
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });

  it("does not shove a turned bar lying across the top row back down (a resize there)", () => {
    expect(clampOntoBoard(at(2, -1, 1, 3), 90, 6, 6)).toEqual(at(2, -1, 1, 3));
    expect(clampOntoBoard(at(2, 4, 1, 3), 90, 6, 6)).toEqual(at(2, 4, 1, 3));
    // One row further up is off by both rects, and comes back to the top row
    // by its footprint, the nearer of the two.
    expect(clampOntoBoard(at(2, -2, 1, 3), 90, 6, 6)).toEqual(at(2, -1, 1, 3));
  });
});

describe("the grid's free-cell questions, for a turned block", () => {
  const block = (key: string, x: number, y: number, w = 1, h = 1): GridBlock<null> => ({
    key,
    data: null,
    x,
    y,
    w,
    h,
  });

  it("calls the top row free for a turned bar, and still refuses it for a level one", () => {
    expect(placementIsFree([], at(2, -1, 1, 3), null, 6, 6, 90)).toBe(true);
    expect(placementIsFree([], at(2, -1, 1, 3), null, 6, 6)).toBe(false);
  });

  it("measures the candidate by the cells it covers, not by its stored rect", () => {
    // The stored rect of a turned 1x3 at (2, 1) covers (2, 1); its footprint
    // lies along row 2 and does not.
    const neighbour = [block("n", 2, 1)];
    expect(placementIsFree(neighbour, at(2, 1, 1, 3), null, 6, 6, 90)).toBe(true);
    expect(placementIsFree(neighbour, at(2, 1, 1, 3), null, 6, 6)).toBe(false);
    // ...and a neighbour in the row it lies along is in its way.
    const inRow = [block("n", 1, 2)];
    expect(placementIsFree(inRow, at(2, 1, 1, 3), null, 6, 6, 90)).toBe(false);
  });

  it("finds room for a turned bar in the top row of an empty board", () => {
    const spot = findFreeCell([], 1, 3, 6, 6, 90);
    expect(spot).toEqual({ x: 1, y: -1 });
    expect(rotatedFootprint({ ...spot!, w: 1, h: 3 }, 90)).toEqual(at(0, 0, 3, 1));
    // Level blocks scan exactly as they always did.
    expect(findFreeCell([], 2, 2, 6, 6)).toEqual({ x: 0, y: 0 });
  });

  it("only ever hands back a free, on-board spot, and puts the footprint at the corner of an empty board", () => {
    const bad = failures();
    const crowd = [block("a", 0, 0, 2, 2), block("b", 3, 1, 1, 3)];
    for (const { columns, rows } of BOARDS) {
      for (const { w, h } of spans(columns, rows)) {
        for (const angle of [0, 90, -90, 30, 60]) {
          const where = `${columns}x${rows} ${angle}deg ${w}x${h}`;
          const covered = rotatedFootprint(at(0, 0, w, h), angle);
          const fits = covered.w <= columns && covered.h <= rows;
          const empty = findFreeCell([], w, h, columns, rows, angle);
          if (fits) {
            if (!empty) {
              bad.add(`no room on an empty board: ${where}`);
            } else {
              const landed = rotatedFootprint({ ...empty, w, h }, angle);
              if (landed.x !== 0 || landed.y !== 0) {
                bad.add(`not at the corner: ${where}`);
              }
            }
          }
          const spot = findFreeCell(crowd, w, h, columns, rows, angle);
          if (
            spot &&
            !placementIsFree(crowd, { ...spot, w, h }, null, columns, rows, angle)
          ) {
            bad.add(`not free: ${where}`);
          }
          if (isTransposed(angle) === false && fits && empty) {
            if (empty.x !== 0 || empty.y !== 0) bad.add(`level moved: ${where}`);
          }
        }
      }
    }
    expect(bad.list).toEqual([]);
  });
});
