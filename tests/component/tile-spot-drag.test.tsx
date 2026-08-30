import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import type { TileSpotDrag } from "@/components/storefront/TileSpotDragLayer";

/**
 * Dragging the title and the price ON the tile.
 *
 * Two things are being pinned. One is the gesture contract: a press on a token
 * must not reach the grid cell underneath, or the block moves instead of the
 * label. The other is that NONE of it exists on a read-only render, because
 * this same component draws the buyer's storefront.
 */

afterEach(cleanup);

const PRODUCT: Product = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  title: "Enamel mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
};

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  cornerRadius: 0,
  ...over,
});

function dragBag(over: Partial<TileSpotDrag> = {}): TileSpotDrag {
  return {
    title: true,
    price: true,
    active: null,
    onGrab: vi.fn(),
    onCancel: vi.fn(),
    onArrow: vi.fn(),
    onTokenClick: vi.fn(),
    ...over,
  };
}

function renderTile(opts: {
  drag?: TileSpotDrag;
  overrides?: CardStyleOverrides;
} = {}) {
  return render(
    <ProductTileContent
      product={PRODUCT}
      theme={theme()}
      overrides={opts.overrides}
      spotDrag={opts.drag}
      placement={{ w: 1, h: 1 }}
    />,
  );
}

describe("a read-only tile", () => {
  it("has no tokens at all without the drag bag", () => {
    renderTile();
    // Not focusable, not a control, nothing for a buyer to grab by accident.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Enamel mug")).not.toHaveAttribute("tabindex");
    expect(screen.getByText("€12.50")).not.toHaveAttribute("tabindex");
  });

  it("stays read-only for the tokens the bag does not arm", () => {
    renderTile({ drag: dragBag({ title: true, price: false }) });
    expect(screen.getByText("Enamel mug")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("€12.50")).not.toHaveAttribute("tabindex");
  });
});

describe("grabbing a token", () => {
  it("takes the press so the block underneath never starts moving", () => {
    const drag = dragBag();
    const onCellPointerDown = vi.fn();
    render(
      // The grid cell's own handler, standing in for the one that starts a
      // block drag. A press on the title must never reach it.
      <div onPointerDown={onCellPointerDown}>
        <ProductTileContent
          product={PRODUCT}
          theme={theme()}
          spotDrag={drag}
          placement={{ w: 1, h: 1 }}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByText("Enamel mug"), { button: 0 });
    expect(drag.onGrab).toHaveBeenCalledWith("title", expect.anything());
    expect(onCellPointerDown).not.toHaveBeenCalled();
  });

  it("ignores a press from anything but the primary button", () => {
    const drag = dragBag();
    renderTile({ drag });
    fireEvent.pointerDown(screen.getByText("Enamel mug"), { button: 2 });
    expect(drag.onGrab).not.toHaveBeenCalled();
  });

  it("arrows the token and keeps the keys away from the board", () => {
    const drag = dragBag();
    const onCellKeyDown = vi.fn();
    render(
      // Arrows move the BLOCK on the board, so a focused token has to borrow
      // them or moving a title would shove the tile across the canvas.
      <div onKeyDown={onCellKeyDown}>
        <ProductTileContent
          product={PRODUCT}
          theme={theme()}
          spotDrag={drag}
          placement={{ w: 1, h: 1 }}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByText("Enamel mug"), { key: "ArrowUp" });
    expect(drag.onArrow).toHaveBeenCalledWith("title", "ArrowUp");
    expect(onCellKeyDown).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const drag = dragBag();
    renderTile({ drag });
    fireEvent.keyDown(screen.getByText("€12.50"), { key: "Escape" });
    expect(drag.onCancel).toHaveBeenCalled();
  });
});

describe("a token in flight", () => {
  it("draws the title where it is going, not where it is stored", () => {
    // The stored spot is the default bottom-left; the drag says top-right.
    renderTile({
      overrides: { titleStyle: "overlay" },
      drag: dragBag({ active: { token: "title", drop: "top-right" } }),
    });
    const band = screen.getByText("Enamel mug").parentElement!;
    expect(band).toHaveClass("top-0");
    expect(screen.getByText("Enamel mug")).toHaveClass("text-right");
  });

  it("moves the price out of the band and onto the image", () => {
    renderTile({
      overrides: { priceTagPosition: "below" },
      drag: dragBag({ active: { token: "price", drop: "top-right" } }),
    });
    const price = screen.getByText("€12.50");
    expect(price).toHaveClass("absolute");
    // The fixed "top-2" offset is now the scalable --tag-inset var (see
    // priceTagInsetStyle); an 8px fallback keeps it byte-identical here.
    expect(price).toHaveClass("top-[var(--tag-inset,8px)]");
  });

  it("brings the price back into the band, which lights up to say so", () => {
    renderTile({
      overrides: { priceTagPosition: "top-right" },
      drag: dragBag({ active: { token: "price", drop: "below" } }),
    });
    const price = screen.getByText("€12.50");
    // Back inside the band beside the title, not floating over the picture.
    expect(price).not.toHaveClass("absolute");
    expect(price.parentElement).toContainElement(screen.getByText("Enamel mug"));
    expect(price.parentElement).toHaveClass("ring-primary");
  });

  it("writes nothing while it flies, so a cancel needs no restore", () => {
    // The override the tile was given is the one it still holds: the flight is
    // drawn from the bag, never from the config.
    const overrides: CardStyleOverrides = { titlePosition: "bottom-left" };
    renderTile({
      overrides,
      drag: dragBag({ active: { token: "title", drop: "top-left" } }),
    });
    expect(overrides).toEqual({ titlePosition: "bottom-left" });
  });
});
