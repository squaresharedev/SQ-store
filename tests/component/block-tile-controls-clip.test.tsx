import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DEFAULT_STOREFRONT_CONFIG, type ShapeBlock } from "@/types/storefront";
import { BlockTile } from "@/components/storefront/BlockTile";

/**
 * A tile's chrome must survive heavy corner rounding. The regression this
 * pins: the grid cell used to clip everything (overflow hidden + contain
 * paint at the cell), so on a circle/pill tile the chrome hanging off the
 * tile's square edges was cut off. The fix moves the clip INSIDE BlockTile,
 * onto the face wrapper only — so structurally, no ancestor of the chrome may
 * clip, while the face content still clips to the radius.
 *
 * The chrome in question used to be the remove chip. The buttons have since
 * moved off the artwork entirely (SelectionToolbar), and what is left on the
 * tile is the FOOTPRINT: the outline of the square the block really occupies,
 * drawn a pixel outside the face and therefore the first thing a clipping
 * ancestor would eat.
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

function clips(element: HTMLElement): boolean {
  return (
    element.className.includes("overflow-hidden") ||
    element.className.includes("[contain:paint]")
  );
}

describe("BlockTile control clipping", () => {
  it("keeps the footprint outline outside every clipping ancestor", () => {
    const { container } = render(
      <BlockTile
        blockKey="s_1"
        block={block}
        product={null}
        theme={DEFAULT_STOREFRONT_CONFIG.theme}
        editable
        isEditing
        onToggleEdit={vi.fn()}
      />,
    );
    const footprint = container.querySelector<HTMLElement>(
      "[data-tile-footprint]",
    );
    expect(footprint).not.toBeNull();
    for (
      let node = footprint!.parentElement;
      node && node !== container;
      node = node.parentElement
    ) {
      expect(clips(node)).toBe(false);
    }
  });

  it("still clips the face content to the corner radius", () => {
    const { container } = render(
      <BlockTile
        blockKey="s_1"
        block={block}
        product={null}
        theme={DEFAULT_STOREFRONT_CONFIG.theme}
        editable={false}
      />,
    );
    // Exactly one clip wrapper, rounded like the cell, containing the face.
    const wrapper = container.querySelector(".overflow-hidden");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("rounded-[inherit]");
  });
});
