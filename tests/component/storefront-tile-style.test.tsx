import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ProductBlock,
  type StorefrontConfig,
} from "@/types/storefront";
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
});
