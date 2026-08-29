import { describe, it, expect } from "vitest";
import {
  blockKey,
  layerOrder,
  readingOrder,
  type ShapeBlock,
  type StorefrontBlock,
} from "@/types/storefront";
import {
  bringForward,
  bringToFront,
  dropIndex,
  moveLayerTo,
  normalizeLayers,
  sendBackward,
  sendToBack,
} from "@/lib/storefront/layers";

/**
 * The stacking rules, away from any DOM.
 *
 * Two of these are the whole feature and both are easy to get subtly wrong: a
 * multi-selection has to travel as a RUN (keeping its own relative order), and
 * an operation that changes nothing has to hand back the same array so the
 * editor never records an undo step for a press that did nothing.
 */

/** A shape at a placement. The id doubles as the readable name in assertions. */
function block(name: string, x: number, y = 0, z?: number): ShapeBlock {
  return {
    type: "shape",
    // blockKey is `s_${id}`, so a one-letter id reads straight out of a
    // failure message.
    id: name,
    kind: "square",
    color: "#000000",
    x,
    y,
    w: 1,
    h: 1,
    ...(z !== undefined ? { z } : {}),
  };
}

const names = (blocks: readonly StorefrontBlock[]) =>
  blocks.map((b) => blockKey(b).slice(2)).join("");

/** A row of blocks left to right, so reading order is alphabetical. */
function row(spec: string, zs?: (number | undefined)[]): StorefrontBlock[] {
  return [...spec].map((name, index) => block(name, index, 0, zs?.[index]));
}

describe("layerOrder", () => {
  it("falls back to reading order on a board nobody has layered", () => {
    // Element for element: a config saved before layering existed has to
    // render exactly the way it always did.
    const blocks = [block("c", 2), block("a", 0), block("b", 1)];
    expect(layerOrder(blocks)).toEqual(readingOrder(blocks));
    expect(names(layerOrder(blocks))).toBe("abc");
  });

  it("reads top to bottom before left to right, like the eye does", () => {
    const blocks = [block("b", 0, 1), block("a", 5, 0)];
    expect(names(layerOrder(blocks))).toBe("ab");
  });

  it("is total and deterministic when only some blocks carry a z", () => {
    // b has no z, so it sorts at its reading index (1) and lands between the
    // two that do. Without the fallback this board would have no order at all.
    const blocks = row("abc", [2, undefined, 0]);
    expect(names(layerOrder(blocks))).toBe("cba");
    // Same answer whatever order the array happens to be in: array order is
    // meaningless in a config, so it must not leak into paint order.
    expect(names(layerOrder([...blocks].reverse()))).toBe("cba");
  });

  it("breaks a tie on reading index rather than on array position", () => {
    const blocks = row("abc", [1, 1, 0]);
    expect(names(layerOrder(blocks))).toBe("cab");
    expect(names(layerOrder([...blocks].reverse()))).toBe("cab");
  });

  it("does not mutate or re-use its input array", () => {
    const blocks = row("abc", [2, 1, 0]);
    const snapshot = [...blocks];
    const ordered = layerOrder(blocks);
    expect(blocks).toEqual(snapshot);
    expect(ordered).not.toBe(blocks);
  });
});

describe("normalizeLayers", () => {
  it("produces exactly 0..n-1, no gaps and no duplicates", () => {
    const blocks = row("abcd", [90, undefined, 7, 7]);
    const next = normalizeLayers(blocks);
    // -1 stands in for an absent z, so a block the writer skipped would show
    // up here rather than sorting quietly into place.
    expect([...next].map((b) => b.z ?? -1).sort((x, y) => x - y)).toEqual([
      0, 1, 2, 3,
    ]);
    // And the dense values agree with the order they came from.
    expect(names(layerOrder(next))).toBe(names(layerOrder(blocks)));
  });

  it("keeps the array in its original order, expressing depth only in z", () => {
    // Array order is deliberately meaningless (saveStorefront says so), and
    // reordering it would make a visual change look structural in every diff.
    const blocks = row("abc", [2, 1, 0]);
    expect(names(normalizeLayers(blocks))).toBe("abc");
    expect(normalizeLayers(blocks).map((b) => b.z)).toEqual([2, 1, 0]);
  });

  it("hands back the same array when every z is already dense", () => {
    const blocks = row("abc", [0, 1, 2]);
    expect(normalizeLayers(blocks)).toBe(blocks);
  });

  it("does not mutate its input", () => {
    const blocks = row("abc");
    const snapshot = structuredClone(blocks);
    normalizeLayers(blocks);
    expect(blocks).toEqual(snapshot);
  });
});

describe("moving a selection through the stack", () => {
  const keys = (spec: string) => [...spec].map((name) => `s_${name}`);

  it("brings a single block to the front", () => {
    const blocks = row("abcd");
    expect(names(layerOrder(bringToFront(blocks, keys("b"))))).toBe("acdb");
  });

  it("sends a single block to the back", () => {
    const blocks = row("abcd");
    expect(names(layerOrder(sendToBack(blocks, keys("c"))))).toBe("cabd");
  });

  it("moves a multi-selection to the front as ONE run, in its own order", () => {
    // The detail sellers notice first. Moving each key independently would
    // land them in selection order (or reversed), silently re-stacking blocks
    // the seller never touched relative to each other.
    const blocks = row("abcde");
    // Named back to front and out of order on purpose: the SELECTION's order
    // must not decide anything.
    const next = bringToFront(blocks, keys("dba"));
    expect(names(layerOrder(next))).toBe("ceabd");
  });

  it("moves a multi-selection to the back the same way", () => {
    const blocks = row("abcde");
    expect(names(layerOrder(sendToBack(blocks, keys("ec"))))).toBe("ceabd");
  });

  it("steps one block forward, past exactly one neighbour", () => {
    const blocks = row("abcd");
    expect(names(layerOrder(bringForward(blocks, keys("b"))))).toBe("acbd");
  });

  it("steps a run forward without letting it tunnel through itself", () => {
    const blocks = row("abcd");
    expect(names(layerOrder(bringForward(blocks, keys("bc"))))).toBe("adbc");
  });

  it("steps a run backward the same way", () => {
    const blocks = row("abcd");
    expect(names(layerOrder(sendBackward(blocks, keys("bd"))))).toBe("badc");
  });

  it("round-trips: backward past a neighbour, then forward again", () => {
    // What proves the swap logic rather than just exercising it.
    const blocks = row("abcd");
    const back = sendBackward(blocks, keys("c"));
    expect(names(layerOrder(back))).toBe("acbd");
    expect(names(layerOrder(bringForward(back, keys("c"))))).toBe("abcd");
  });

  it("returns the SAME array for a block already at the front", () => {
    // The caller reads this as "nothing happened" and skips recording an undo
    // step, so it has to be reference equality, not a deep match.
    const blocks = row("abc");
    expect(bringForward(blocks, keys("c"))).toBe(blocks);
    expect(bringToFront(blocks, keys("c"))).toBe(blocks);
  });

  it("returns the SAME array for a run already at the back", () => {
    const blocks = row("abc");
    expect(sendBackward(blocks, keys("ab"))).toBe(blocks);
    expect(sendToBack(blocks, keys("ab"))).toBe(blocks);
  });

  it("returns the SAME array for an empty or whole-board selection", () => {
    const blocks = row("abc");
    expect(bringToFront(blocks, [])).toBe(blocks);
    // Everything selected cannot move relative to itself.
    expect(sendToBack(blocks, keys("abc"))).toBe(blocks);
    // A key for a block that is not on this board is not a selection either.
    expect(bringForward(blocks, ["s_zzz"])).toBe(blocks);
  });

  it("leaves an untouched board with no z at all when nothing moves", () => {
    // A no-op must not spend the board's one-time dense-z diff.
    const blocks = row("abc");
    expect(bringForward(blocks, keys("c")).every((b) => b.z === undefined)).toBe(
      true,
    );
  });

  it("writes a dense z across the whole board on the first real move", () => {
    // The intentional one-time diff: a total order is the only thing "bring
    // forward" can be answered from, so the first operation layers everything.
    const blocks = row("abc");
    const next = bringToFront(blocks, keys("a"));
    expect(next.map((b) => b.z)).toEqual([2, 0, 1]);
  });

  it("never mutates its input", () => {
    for (const op of [bringToFront, sendToBack, bringForward, sendBackward]) {
      const blocks = row("abcd", [0, 1, 2, 3]);
      const snapshot = structuredClone(blocks);
      op(blocks, keys("bc"));
      expect(blocks).toEqual(snapshot);
    }
  });
});

/**
 * Dropping a row where it was let go, which is what a drag in the layers list
 * asks for. The trap this pins is the off-by-one: `index` counts in the blocks
 * that are NOT moving, so it means the same thing whether the row travelled up
 * or down. An index into the full order would not.
 */
describe("moveLayerTo", () => {
  const keys = (spec: string) => [...spec].map((name) => `s_${name}`);
  const moved = (spec: string, sel: string, index: number) =>
    names(layerOrder(moveLayerTo(row(spec), keys(sel), index)));

  it("drops a block behind everything at zero and in front at the end", () => {
    expect(moved("abcd", "c", 0)).toBe("cabd");
    expect(moved("abcd", "c", 3)).toBe("abdc");
  });

  it("counts the same whether the block travelled forward or back", () => {
    // The off-by-one this exists to avoid. `index` counts the blocks LEFT
    // BEHIND, so it means one thing wherever the block started: at 2, both of
    // these land third from the back. An index into the full order would mean
    // two different things depending on the direction of travel.
    expect(moved("abcd", "b", 2)).toBe("acbd");
    expect(moved("abcd", "d", 2)).toBe("abdc");
  });

  it("keeps a multi-selection's own order when the run lands", () => {
    expect(moved("abcd", "db", 1)).toBe("abdc");
  });

  it("clamps a drop that left the list rather than dropping the block", () => {
    expect(moved("abcd", "a", -5)).toBe("abcd");
    expect(moved("abcd", "a", 99)).toBe("bcda");
  });

  it("returns the SAME array for a drop that changes nothing", () => {
    const blocks = row("abcd");
    // Where it already is, an empty selection, and a nonsense index.
    expect(moveLayerTo(blocks, keys("b"), 1)).toBe(blocks);
    expect(moveLayerTo(blocks, [], 2)).toBe(blocks);
    expect(moveLayerTo(blocks, keys("b"), Number.NaN)).toBe(blocks);
  });

  it("never mutates its input", () => {
    const blocks = row("abcd", [0, 1, 2, 3]);
    const snapshot = structuredClone(blocks);
    moveLayerTo(blocks, keys("bc"), 0);
    expect(blocks).toEqual(snapshot);
  });
});

describe("dropIndex", () => {
  it("turns a front-counted row into a back-counted insert position", () => {
    // Top row of four = in front of the other three.
    expect(dropIndex(0, 4)).toBe(3);
    // Bottom row = behind all three.
    expect(dropIndex(3, 4)).toBe(0);
  });

  it("round-trips every row of a stack", () => {
    // What the list draws at row `to` is what a drop at row `to` produces:
    // the two directions of the same conversion have to agree, or a drag lands
    // one place off in one direction only.
    const blocks = row("abcde");
    const front = () => names(layerOrder(blocks)).split("").reverse().join("");
    for (let to = 0; to < 5; to += 1) {
      const next = moveLayerTo(blocks, ["s_c"], dropIndex(to, 5));
      const rows = names(layerOrder(next)).split("").reverse();
      expect(rows[to]).toBe("c");
    }
    expect(front()).toBe("edcba");
  });
});
