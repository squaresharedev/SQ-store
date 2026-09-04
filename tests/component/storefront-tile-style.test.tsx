import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ProductBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import {
  GESTURE_Z,
  LAYER_Z_BASE,
  LAYER_Z_CEILING,
  OVERLAY_Z,
  layerZIndex,
} from "@/components/grid/gridConstants";
import { MAX_BLOCKS } from "@/lib/validation/storefront";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";

/**
 * Per-tile style overrides through the REAL render path (StorefrontPreview →
 * shared Grid → BlockTile → ProductTileContent): two product blocks on one
 * board, one following the theme and one overriding it, must come out with
 * different corner radii and different title/price treatment. This is the
 * whole feature: "one product can be a circle and the other a square".
 */

const PRODUCT_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PRODUCT_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

let widthSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(300);
});

afterAll(() => {
  widthSpy.mockRestore();
  vi.unstubAllGlobals();
});

afterEach(cleanup);

function product(id: string, title: string): Product {
  return {
    id,
    title,
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
}

const PRODUCTS: ReadonlyMap<string, Product> = new Map([
  [PRODUCT_A, product(PRODUCT_A, "Plain tile")],
  [PRODUCT_B, product(PRODUCT_B, "Styled tile")],
]);

function configWith(blocks: ProductBlock[]): StorefrontConfig {
  return {
    ...structuredClone(DEFAULT_STOREFRONT_CONFIG),
    theme: {
      ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
      columns: 3,
      rows: 2,
      cornerRadius: 0,
      showTitle: true,
    },
    blocks,
  };
}

const cells = () =>
  within(
    screen.getByRole("list", { name: "Storefront preview" }),
  ).getAllByRole("listitem");

describe("per-tile style overrides", () => {
  it("rounds only the tile that overrides cornerRadius (circle next to square)", () => {
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1 },
          {
            type: "product",
            productId: PRODUCT_B,
            x: 1,
            y: 0,
            w: 1,
            h: 1,
            style: { cornerRadius: 100 },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const [plain, styled] = cells();
    expect(plain.style.borderRadius).toBe("0px");
    expect(styled.style.borderRadius).toBe("100px");
  });

  it("scales an overridden radius by the tile's span, like the theme radius", () => {
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            style: { cornerRadius: 100 },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    expect(cells()[0].style.borderRadius).toBe("200px");
  });

  it("hides the title only on the tile that overrides showTitle", () => {
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1 },
          {
            type: "product",
            productId: PRODUCT_B,
            x: 1,
            y: 0,
            w: 1,
            h: 1,
            style: { showTitle: false, priceTagPosition: "hidden" },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    expect(screen.getByText("Plain tile")).toBeInTheDocument();
    expect(screen.queryByText("Styled tile")).not.toBeInTheDocument();
    // The theme-following tile still shows its price in the title bar; the
    // overridden tile hid its tag, so exactly one price renders.
    expect(screen.getAllByText("€12.50")).toHaveLength(1);
  });

  it("renders every price tag appearance field from the tile's overrides", () => {
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            style: {
              priceTagPosition: "top-right",
              priceTagFont: "mono",
              priceTagSize: 14,
              priceTagColor: "#fbbf24",
              priceTagTextColor: "#1c1917",
              priceTagBorderColor: "#d97706",
              priceTagBorderWidth: 2,
              priceTagRadius: 4,
            },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const tag = screen.getByText("€12.50");
    expect(tag).toHaveClass("font-mono");
    expect(tag.style.fontSize).toBe("14px");
    expect(tag.style.backgroundColor).toBe("rgb(251, 191, 36)");
    expect(tag.style.color).toBe("rgb(28, 25, 23)");
    expect(tag.style.borderColor).toBe("rgb(217, 119, 6)");
    expect(tag.style.borderWidth).toBe("2px");
    expect(tag.style.borderRadius).toBe("4px");
    // Padding scales with the type, so one slider sizes the whole chip.
    expect(tag.style.paddingInline).toBe("7px");
  });

  it("draws no border at all at thickness 0, even with a border color stored", () => {
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            style: { priceTagBorderColor: "#d97706", priceTagBorderWidth: 0 },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    expect(screen.getByText("€12.50").style.borderWidth).toBe("");
  });

  it("lifts a bottom price tag off an overlay title so the two never collide", () => {
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            // The title bar is drawn over the image's bottom edge, which is
            // the same box this floated tag sits in.
            style: { titleStyle: "overlay", priceTagPosition: "bottom-left" },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const tag = screen.getByText("€12.50");
    // The fixed "top-2"/"bottom-2" offsets are now the scalable --tag-inset
    // var (see priceTagInsetStyle); an 8px fallback keeps them byte-identical
    // here.
    expect(tag).toHaveClass("top-[var(--tag-inset,8px)]");
    expect(tag).not.toHaveClass("bottom-[var(--tag-inset,8px)]");
    // And the title is still there, at the bottom, unmoved.
    expect(screen.getByText("Plain tile")).toBeInTheDocument();
  });
});

/**
 * Title placement through the same real render path. The title is placed on
 * the SAME seven-spot board as the price tag, so these pin the three things
 * that follow from that: the row decides where the band goes, the column which
 * way the words pull, and the tag gets out of whichever row the band holds.
 */
describe("title placement", () => {
  /** The band is the element the title text sits directly inside. */
  const band = (title: string) => screen.getByText(title).parentElement!;

  function renderTile(style: ProductBlock["style"]) {
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1, style },
        ])}
        productsById={PRODUCTS}
      />,
    );
  }

  it("pins an overlaid band to the row its spot names", () => {
    for (const [titlePosition, pin] of [
      ["top-center", "top-0"],
      ["middle-center", "top-1/2"],
      ["bottom-center", "bottom-0"],
    ] as const) {
      renderTile({ titleStyle: "overlay", titlePosition });
      expect(band("Plain tile")).toHaveClass(pin);
      cleanup();
    }
  });

  it("steers the words with the spot's column", () => {
    for (const [titlePosition, align] of [
      ["bottom-left", "text-left"],
      ["bottom-center", "text-center"],
      ["bottom-right", "text-right"],
    ] as const) {
      renderTile({ titleStyle: "overlay", titlePosition });
      expect(screen.getByText("Plain tile")).toHaveClass(align);
      cleanup();
    }
  });

  it("puts a top bar ABOVE the picture, not over it", () => {
    // A bar is a real row in the tile's column: the only placement that
    // reorders the tile rather than pinning a band onto the image.
    renderTile({ titleStyle: "bar", titlePosition: "top-left" });
    const bar = band("Plain tile");
    expect(bar).not.toHaveClass("absolute");
    expect(bar.previousElementSibling).toBeNull();
    expect(bar.nextElementSibling).not.toBeNull();
  });

  it("drops a bar's middle spot to the bottom, since a bar has no middle", () => {
    renderTile({ titleStyle: "bar", titlePosition: "middle-center" });
    const bar = band("Plain tile");
    expect(bar).not.toHaveClass("top-1/2");
    expect(bar.nextElementSibling).toBeNull();
  });

  it("moves a floated tag off the row the title took, not off the bottom", () => {
    // With the title at the top, the bottom is free and the tag belongs there.
    renderTile({
      titleStyle: "overlay",
      titlePosition: "top-left",
      priceTagPosition: "top-right",
    });
    expect(screen.getByText("€12.50")).toHaveClass("bottom-[var(--tag-inset,8px)]");
  });

  it("keeps the price beside the title in the one band, wherever it sits", () => {
    // "Below" means "in the title band" — the price follows it up rather than
    // stranding a second bar at the bottom of the tile.
    renderTile({
      titleStyle: "overlay",
      titlePosition: "top-right",
      priceTagPosition: "below",
    });
    expect(band("Plain tile")).toContainElement(screen.getByText("€12.50"));
  });

  it("holds the words off a rounded corner on its own, and takes an inset", () => {
    // Auto reads the tile's real clip radius in CSS, so the rule travels with
    // the tile's span instead of being computed from the config.
    renderTile({ titleStyle: "bar", cornerRadius: 40 });
    expect(band("Plain tile").style.paddingInline).toContain("--tile-radius");
    cleanup();

    renderTile({ titleStyle: "bar", cornerRadius: 40, titleInset: 12 });
    expect(band("Plain tile").style.paddingInline).toBe("12px");
  });

  it("reveals an overlay band from the edge it is pinned to", () => {
    // A bottom bar rises, a top one drops. Getting this wrong sends the band
    // sliding out of the tile instead of into it.
    renderTile({
      titleStyle: "overlay",
      titleDisplay: "hover",
      titlePosition: "bottom-left",
    });
    expect(band("Plain tile")).toHaveClass("translate-y-full");
    cleanup();

    renderTile({
      titleStyle: "overlay",
      titleDisplay: "hover",
      titlePosition: "top-left",
    });
    expect(band("Plain tile")).toHaveClass("-translate-y-full");
    cleanup();

    // The middle band's own transform already centers it, so it fades.
    renderTile({
      titleStyle: "overlay",
      titleDisplay: "hover",
      titlePosition: "middle-center",
    });
    const middle = band("Plain tile");
    expect(middle).not.toHaveClass("translate-y-full");
    expect(middle).toHaveClass("opacity-0");
  });

  it("steps the sold-out badge away from a title band at the top", () => {
    // A full-width band would paint straight over it.
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            soldOut: true,
            style: { titleStyle: "overlay", titlePosition: "top-left" },
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    expect(screen.getByText("Sold out")).toHaveClass("bottom-2");
  });

  it("publishes the tile's clip radius for the band to read", () => {
    renderTile({ cornerRadius: 24 });
    expect(cells()[0].style.getPropertyValue("--tile-radius")).toBe("24px");
  });
});

describe("block rotation through the render path", () => {
  it("tilts only the block that carries a rotation", () => {
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1 },
          {
            type: "product",
            productId: PRODUCT_B,
            x: 1,
            y: 0,
            w: 1,
            h: 1,
            rotation: 30,
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const [level, tilted] = cells();
    // The standalone property, NOT transform: the grid paints live drag
    // offsets into `translate` and the two have to be able to coexist.
    expect(tilted.style.rotate).toBe("30deg");
    expect(tilted.style.transform).toBe("");
    // An untilted block emits no rotate at all, so it stays exactly the
    // element it was before tilting existed.
    expect(level.style.rotate).toBe("");
  });

  it("carries the tilt into the read-only miniature", () => {
    // A preview that straightened everything would be a preview of a design
    // the storefront does not have.
    render(
      <StorefrontPreview
        config={configWith([
          {
            type: "product",
            productId: PRODUCT_A,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            rotation: -12,
          },
        ])}
        productsById={PRODUCTS}
      />,
    );
    expect(cells()[0].style.rotate).toBe("-12deg");
  });
});

describe("block layering through the render path", () => {
  /** The z-index each cell actually paints at, in DOM order. */
  const depths = () => cells().map((cell) => Number(cell.style.zIndex));

  it("paints an unlayered board in reading order", () => {
    // DOM order IS reading order, so the depths come out ascending: a config
    // saved before layering existed renders exactly as it always did.
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1 },
          { type: "product", productId: PRODUCT_B, x: 1, y: 0, w: 1, h: 1 },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const [first, second] = depths();
    expect(second).toBeGreaterThan(first);
  });

  it("orders the cells by z, not by their place in the array", () => {
    // The block that comes FIRST in reading order is sent to the front, so
    // paint order and DOM order deliberately disagree. DOM order is what a
    // screen reader walks and must not have moved.
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1, z: 1 },
          { type: "product", productId: PRODUCT_B, x: 1, y: 0, w: 1, h: 1, z: 0 },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const [first, second] = depths();
    expect(first).toBeGreaterThan(second);
    // Reading order is untouched: the first cell is still the first product.
    expect(within(cells()[0]).getByText("Plain tile")).toBeInTheDocument();
  });

  it("keeps every rendered block inside the content band", () => {
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 1, h: 1, z: 1 },
          { type: "product", productId: PRODUCT_B, x: 1, y: 0, w: 1, h: 1, z: 0 },
        ])}
        productsById={PRODUCTS}
      />,
    );
    for (const depth of depths()) {
      expect(depth).toBeGreaterThanOrEqual(LAYER_Z_BASE);
      expect(depth).toBeLessThan(GESTURE_Z);
      expect(depth).toBeLessThan(OVERLAY_Z);
    }
  });

  it("renders BOTH blocks when two are stacked on the same cells", () => {
    // The arrangement that used to be rejected outright. Neither block is
    // dropped, they are laid on the same grid area, and z is what separates
    // them.
    render(
      <StorefrontPreview
        config={configWith([
          { type: "product", productId: PRODUCT_A, x: 0, y: 0, w: 2, h: 2, z: 0 },
          { type: "product", productId: PRODUCT_B, x: 0, y: 0, w: 2, h: 2, z: 1 },
        ])}
        productsById={PRODUCTS}
      />,
    );
    const [under, over] = cells();
    expect(cells()).toHaveLength(2);
    expect(under.style.gridColumn).toBe(over.style.gridColumn);
    expect(under.style.gridRow).toBe(over.style.gridRow);
    expect(Number(over.style.zIndex)).toBeGreaterThan(Number(under.style.zIndex));
  });

  it("clamps depth under the editor's own chrome at any board size", () => {
    // The rule that stops a future 200-block board from painting over the drag
    // lift, the framing spill and the marquee. Asserted on the mapping rather
    // than by rendering two hundred tiles, since the mapping is what every
    // renderer of the grid shares.
    expect(layerZIndex(MAX_BLOCKS - 1)).toBeLessThan(GESTURE_Z);
    expect(layerZIndex(5_000)).toBe(LAYER_Z_CEILING);
    expect(LAYER_Z_CEILING).toBeLessThan(GESTURE_Z);
    expect(GESTURE_Z).toBeLessThanOrEqual(OVERLAY_Z);
  });
});
