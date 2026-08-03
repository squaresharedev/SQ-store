import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";

/**
 * The preview's contract: it shows the storefront AS DESIGNED, shrunk to fit.
 *
 * The shared <Grid> normally reflows to fewer columns when it is too narrow
 * for legible cells. A preview box is always too narrow by that measure, so
 * without an opt-out every card would show a repacked layout that the seller's
 * storefront does not actually have. That is exactly the regression these
 * pin — and jsdom reports 0 for every layout box, which would let a reflowing
 * grid pass by accident, so the width is stubbed to a realistic card size.
 */

const NARROW_PX = 200;
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
  // A real preview box. columnsThatFit(200, 0, 6) is 2, so a responsive grid
  // here would drop from 6 columns to 2.
  widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(NARROW_PX);
});

afterAll(() => {
  widthSpy.mockRestore();
  vi.unstubAllGlobals();
});

afterEach(cleanup);

function shape(x: number, y: number, index: number): StorefrontBlock {
  return {
    type: "shape",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    kind: "square",
    color: "#171717",
    x,
    y,
    w: 1,
    h: 1,
  };
}

function configWith(over: Partial<StorefrontConfig["theme"]>): StorefrontConfig {
  const columns = over.columns ?? DEFAULT_STOREFRONT_CONFIG.theme.columns;
  const rows = over.rows ?? DEFAULT_STOREFRONT_CONFIG.theme.rows;
  const blocks: StorefrontBlock[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      blocks.push(shape(x, y, blocks.length + 1));
    }
  }
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, ...over },
    blocks,
  };
}

const NO_PRODUCTS: ReadonlyMap<string, Product> = new Map();

const gridEl = () => screen.getByRole("list", { name: "Storefront preview" });

describe("StorefrontPreview - shows the board as designed", () => {
  it("keeps the designed column count in a box far too narrow for it", () => {
    render(
      <StorefrontPreview config={configWith({ columns: 6, rows: 4 })} productsById={NO_PRODUCTS} />,
    );
    expect(gridEl().style.getPropertyValue("--ss-cols")).toBe("6");
  });

  it("keeps the designed column count at the schema maximum (12)", () => {
    render(
      <StorefrontPreview config={configWith({ columns: 12, rows: 3 })} productsById={NO_PRODUCTS} />,
    );
    expect(gridEl().style.getPropertyValue("--ss-cols")).toBe("12");
  });

  it("keeps the declared row count, so the board's shape survives", () => {
    render(
      <StorefrontPreview config={configWith({ columns: 6, rows: 24 })} productsById={NO_PRODUCTS} />,
    );
    expect(gridEl().style.getPropertyValue("--ss-rows")).toBe("24");
  });

  it("renders EVERY block, rather than a truncated slice of them", () => {
    // A preview that silently drops blocks is not a preview of that
    // storefront. 6 x 20 = 120 blocks, the schema's maximum.
    render(
      <StorefrontPreview config={configWith({ columns: 6, rows: 20 })} productsById={NO_PRODUCTS} />,
    );
    expect(within(gridEl()).getAllByRole("listitem")).toHaveLength(120);
  });
});
