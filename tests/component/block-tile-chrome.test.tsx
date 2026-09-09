import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DEFAULT_STOREFRONT_CONFIG, type ShapeBlock } from "@/types/storefront";
import { BlockTile } from "@/components/storefront/BlockTile";

/**
 * WHAT A TILE STILL DRAWS FOR ITSELF, now that its buttons have left.
 *
 * The controls used to be a chip welded to the tile's top edge. They live in
 * the selection's own island above the canvas instead (SelectionToolbar), so
 * the two things this file guards are what remains:
 *
 *   - NO BUTTONS ON THE ARTWORK. A button drawn here is a button drawn over
 *     the seller's own work, and it brings back every problem that made the
 *     chip worth removing: chrome hanging into the neighbouring cell, a cell
 *     that has to be lifted before it can be pressed, and a target that
 *     shrinks with the board's zoom. This assertion is what keeps one from
 *     quietly reappearing.
 *   - `data-block-selected`, which is how the tile tells the CELL around it
 *     that its chrome is out. The grid's resize and rotate handles still hang
 *     outside the cell, and every cell is its own stacking context, so a cell
 *     whose handles are showing has to be lifted clear of its neighbours or
 *     they cannot be pressed at all. Three separate things read this attribute
 *     and none of them are in this file (the lift in globals.css, the handles'
 *     visibility in components/grid/Grid.tsx, and the footprint's own
 *     variants), so it going missing breaks all three silently.
 */

afterEach(cleanup);

const block: ShapeBlock = {
  type: "shape",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  kind: "square",
  color: "#171717",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

function renderTile(props: { isEditing?: boolean; isFraming?: boolean } = {}) {
  return render(
    <BlockTile
      blockKey="s_1"
      block={block}
      product={null}
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      editable
      onToggleEdit={vi.fn()}
      {...props}
    />,
  );
}

describe("BlockTile selection chrome", () => {
  it("marks a selected tile for the cell around it", () => {
    const { container } = renderTile({ isEditing: true });
    expect(container.querySelector("[data-block-selected]")).not.toBeNull();
  });

  it("says nothing when the tile is not selected", () => {
    const { container } = renderTile();
    expect(container.querySelector("[data-block-selected]")).toBeNull();
  });

  it("draws no buttons of its own, selected or not", () => {
    renderTile({ isEditing: true });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("outlines the room the block takes while its chrome is out", () => {
    const { container } = renderTile({ isEditing: true });
    const footprint = container.querySelector("[data-tile-footprint]");
    expect(footprint).not.toBeNull();
    // In the tile's own 1px border ring, and square where the tile is not: on
    // a circular tile this is the only thing showing where the block's edges
    // actually run, and the handles hang off those edges.
    expect(footprint!.className).toContain("-inset-px");
    // Never in the way of a press on the face beneath it.
    expect(footprint!.className).toContain("pointer-events-none");
    // Revealed by selection on every pointer type. These used to be
    // `pointer-fine:` variants, with chrome drawn unconditionally for a finger
    // on the grounds that touch has no hover — but the lift that raises a
    // cell's chrome above its neighbours is spent on hover, focus or
    // selection, so on a phone an unselected tile's chrome was drawn into the
    // next tile's face. `group-hover` carries its own `hover: hover` query, so
    // a mouse keeps its hover reveal and a finger simply never matches it.
    expect(footprint!.className).toContain(
      "group-has-[[data-block-selected]]:opacity-100",
    );
    expect(footprint!.className).not.toContain("pointer-fine:");
  });

  it("drops the outline while the tile is being framed", () => {
    // Framing turns the tile into a single-purpose surface; chrome that is not
    // part of the crop is noise around the picture being positioned.
    const { container } = renderTile({ isFraming: true });
    expect(container.querySelector("[data-tile-footprint]")).toBeNull();
  });
});
