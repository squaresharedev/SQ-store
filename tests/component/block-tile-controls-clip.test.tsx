import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DEFAULT_STOREFRONT_CONFIG, type ShapeBlock } from "@/types/storefront";
import { BlockTile } from "@/components/storefront/BlockTile";

/**
 * The tile controls must survive heavy corner rounding. The regression this
 * pins: the grid cell used to clip everything (overflow hidden + contain
 * paint at the cell), so on a circle/pill tile the remove chip and resize
 * handle were cut off. The fix moves the clip INSIDE BlockTile, onto the
 * face wrapper only — so structurally, no ancestor of the remove control may
 * clip, while the face content still clips to the radius.
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
  it("keeps the remove control outside every clipping ancestor", () => {
    const { container } = render(
      <BlockTile
        blockKey="s_1"
        block={block}
        product={null}
        theme={DEFAULT_STOREFRONT_CONFIG.theme}
        editable
        onToggleEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const remove = screen.getByRole("button", { name: /remove/i });
    for (
      let node = remove.parentElement;
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
