import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DEFAULT_STOREFRONT_CONFIG, type ShapeBlock } from "@/types/storefront";
import { BlockTile } from "@/components/storefront/BlockTile";

/**
 * THE ONE THING A SELECTED TILE HAS TO SAY OUT LOUD.
 *
 * The tile's controls hang OUTSIDE it, so they are drawn over the cells beside
 * it, and every grid cell is its own stacking context: a cell whose controls
 * are out has to be lifted clear of its neighbours or they cannot be pressed
 * at all. Hover cannot be what does the lifting for a SELECTED tile: its chip
 * stays out with the pointer nowhere near it, and chrome drawn under a
 * neighbour can never be hovered into reach, because the pointer arriving on it
 * lands on the neighbour instead.
 *
 * `data-block-selected` is how the tile tells the cell. Three separate things
 * read it and none of them are in this file (the lift in globals.css, the
 * handles' visibility in components/grid/Grid.tsx, and the chip's own
 * variants), so the attribute going missing breaks all three silently. Hence a
 * test on the attribute itself.
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

function renderTile(props: { isEditing?: boolean } = {}) {
  return render(
    <BlockTile
      blockKey="s_1"
      block={block}
      product={null}
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      editable
      onToggleEdit={vi.fn()}
      onRemove={vi.fn()}
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

  it("welds the chip to the tile's edge, seamless rather than floating or doubled", () => {
    renderTile({ isEditing: true });
    const chip = screen
      .getByRole("button", { name: /remove/i })
      .closest("[data-tile-chrome]");
    expect(chip).not.toBeNull();
    // FLUSH with a hairline of overlap: `bottom-full` puts it outside the
    // tile, `-mb-px` closes any subpixel gap a zoomed stage could otherwise
    // round open — dead space the pointer could fall into.
    expect(chip!.className).toContain("bottom-full");
    expect(chip!.className).toContain("-mb-px");
    // NO border on the overlapping edge: a full border there would draw two
    // lines on top of each other (the chip's own and the tile's), which is
    // what actually reads as a visible overlap glitch rather than a seam.
    expect(chip!.className).toContain("border-b-0");
    // Rounded only on the far corners; the touching ones stay square so the
    // chip continues the tile's own edge instead of notching into it.
    expect(chip!.className).toContain("rounded-t-sm");
    expect(chip!.className).toContain("rounded-b-none");
    // Invisible chrome takes no presses: it hangs over the cell above, which
    // on an editable board is a free cell that inserts a block when clicked.
    expect(chip!.className).toContain("pointer-fine:pointer-events-none");
    expect(chip!.className).toContain(
      "pointer-fine:group-has-[[data-block-selected]]:pointer-events-auto",
    );
  });
});
