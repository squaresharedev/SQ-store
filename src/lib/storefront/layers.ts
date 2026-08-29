import {
  blockKey,
  layerOrder,
  type StorefrontBlock,
} from "@/types/storefront";

// STACKING ORDER, as pure data. No React and no DOM, so the rules are
// unit-testable and the future agent surface can reuse them verbatim.
//
// Every operation reads the order layerOrder gives, moves the selection
// within it, and writes a DENSE z (0..n-1) back over the whole board. Dense
// normalization is deliberate: sparse or drifting values are how a layering
// model ends up needing a migration, and a total order is the only thing
// "bring forward" can be answered from.
//
// The price is that the FIRST layering operation on a board writes z to every
// block on it, which is one intentional, one-time diff. Everything after it
// touches only the blocks that actually moved.
//
// Selection rule, shared by all four operations: a multi-selection KEEPS its
// own relative order. Three blocks sent to the front arrive as a contiguous
// run in the order they were already in, which is the detail sellers notice
// first and the one the easy implementation (moving each key independently)
// gets wrong.

/** Where a block should end up, relative to the rest of the board. */
export type LayerOp = "front" | "forward" | "backward" | "back";

/** Write a dense z over the board, following `ordered` back to front.
 *
 *  Returns the blocks in their ORIGINAL array order: array order is
 *  deliberately meaningless in a config (saveStorefront says so), and
 *  reordering it here would make a purely visual change look like a structural
 *  one in every diff. Returns the input array itself when nothing moves, so a
 *  caller can skip recording an undo step. */
function writeLayers(
  blocks: StorefrontBlock[],
  ordered: readonly StorefrontBlock[],
): StorefrontBlock[] {
  const depths = new Map(ordered.map((block, index) => [blockKey(block), index]));
  let changed = false;
  const next = blocks.map((block) => {
    const z = depths.get(blockKey(block)) ?? 0;
    if (block.z === z) return block;
    changed = true;
    return { ...block, z };
  });
  return changed ? next : blocks;
}

/** Every block given a dense z, 0..n-1, back to front. The one writer of z. */
export function normalizeLayers(blocks: StorefrontBlock[]): StorefrontBlock[] {
  return writeLayers(blocks, layerOrder(blocks));
}

/**
 * Move the selection within the paint order, then re-normalize.
 *
 * Bails to the SAME array reference whenever the resulting order matches the
 * one it started from, which covers every no-op a seller can ask for: an empty
 * selection, a selection that is already at the end it is being sent to, and a
 * whole-board selection (which cannot move relative to itself). Returning the
 * input is what lets the designer skip an undo step, and it also keeps a no-op
 * from writing z across a board that has never been layered.
 */
function reorder(
  blocks: StorefrontBlock[],
  keys: readonly string[],
  move: (
    ordered: readonly StorefrontBlock[],
    selected: (block: StorefrontBlock) => boolean,
  ) => StorefrontBlock[],
): StorefrontBlock[] {
  if (keys.length === 0 || blocks.length < 2) return blocks;
  const wanted = new Set(keys);
  const isSelected = (block: StorefrontBlock) => wanted.has(blockKey(block));
  const ordered = layerOrder(blocks);
  const count = ordered.filter(isSelected).length;
  if (count === 0 || count === ordered.length) return blocks;
  const moved = move(ordered, isSelected);
  if (moved.every((block, index) => block === ordered[index])) return blocks;
  return writeLayers(blocks, moved);
}

export function bringToFront(
  blocks: StorefrontBlock[],
  keys: readonly string[],
): StorefrontBlock[] {
  return reorder(blocks, keys, (ordered, selected) => [
    ...ordered.filter((block) => !selected(block)),
    ...ordered.filter(selected),
  ]);
}

export function sendToBack(
  blocks: StorefrontBlock[],
  keys: readonly string[],
): StorefrontBlock[] {
  return reorder(blocks, keys, (ordered, selected) => [
    ...ordered.filter(selected),
    ...ordered.filter((block) => !selected(block)),
  ]);
}

/**
 * One step toward the front.
 *
 * Walked from the FRONT backwards, swapping each selected block with the
 * unselected one ahead of it. Taking the run in that direction is what makes a
 * multi-selection travel as a block: a selected neighbour is never swapped
 * past, so the run's internal order survives and it cannot tunnel through
 * itself.
 */
export function bringForward(
  blocks: StorefrontBlock[],
  keys: readonly string[],
): StorefrontBlock[] {
  return reorder(blocks, keys, (ordered, selected) => {
    const next = [...ordered];
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (selected(next[i]) && !selected(next[i + 1])) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
    return next;
  });
}

/** One step toward the back. The mirror of {@link bringForward}, walked from
 *  the back forwards for the same reason. */
export function sendBackward(
  blocks: StorefrontBlock[],
  keys: readonly string[],
): StorefrontBlock[] {
  return reorder(blocks, keys, (ordered, selected) => {
    const next = [...ordered];
    for (let i = 1; i < next.length; i += 1) {
      if (selected(next[i]) && !selected(next[i - 1])) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
    return next;
  });
}

/**
 * Drop the selection at an EXPLICIT depth, the way a dragged row in the layers
 * list lands where it was let go rather than one step at a time.
 *
 * `index` counts in the blocks that are NOT moving: 0 puts the run behind all
 * of them, `rest.length` puts it in front of all of them. Counted that way
 * because it is the only reading that survives the removal — an index into the
 * full order would mean two different things depending on whether the run
 * started above or below the target, which is exactly the off-by-one every
 * hand-rolled reorder gets wrong.
 *
 * Out-of-range values clamp to the ends: a drag can leave the list, and a drop
 * past the top is a request for the front, not an error.
 */
export function moveLayerTo(
  blocks: StorefrontBlock[],
  keys: readonly string[],
  index: number,
): StorefrontBlock[] {
  if (!Number.isFinite(index)) return blocks;
  return reorder(blocks, keys, (ordered, selected) => {
    const rest = ordered.filter((block) => !selected(block));
    const run = ordered.filter(selected);
    const at = Math.max(0, Math.min(rest.length, Math.round(index)));
    return [...rest.slice(0, at), ...run, ...rest.slice(at)];
  });
}

/**
 * The one place the two ways of counting a stack meet.
 *
 * A layers LIST is drawn front first, the way every layers list a seller has
 * used is drawn; z counts from the back. Given a row dropped at front-counted
 * position `to` on a board of `total` blocks, this is the index
 * {@link moveLayerTo} wants — and since exactly one row is moving, the other
 * `total - 1` keep their order, so landing with `to` of them in front is
 * landing with `total - 1 - to` behind.
 *
 * Kept here rather than in the panel so the arithmetic is unit-testable
 * without a DOM, like every other rule in this file.
 */
export function dropIndex(to: number, total: number): number {
  return total - 1 - to;
}

/** The four operations behind one name, so callers (the panel, the keyboard,
 *  the designer's mutator) route an op string rather than each holding their
 *  own switch over the same four functions. */
export const LAYER_OPS: Record<
  LayerOp,
  (blocks: StorefrontBlock[], keys: readonly string[]) => StorefrontBlock[]
> = {
  front: bringToFront,
  forward: bringForward,
  backward: sendBackward,
  back: sendToBack,
};
