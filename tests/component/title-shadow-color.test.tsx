import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type CardStyleOverrides,
  type ProductBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { CardStyleControls } from "@/components/storefront/CardStyleControls";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";

/**
 * The shadow title's tint, end to end: the picker in a tile's style panel, and
 * the gradient it paints through the real render path.
 */

afterEach(cleanup);

const PRODUCT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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

const themed = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});

function renderTile(overrides: CardStyleOverrides, theme = themed()) {
  const onChange = vi.fn();
  render(
    <CardStyleControls
      value={resolveCardStyle(theme, overrides)}
      onChange={onChange}
      colorScope={{ theme, overrides, scope: { blockKey: "p_1" } }}
    />,
  );
  return onChange;
}

describe("shadow color picker", () => {
  it("only appears while the tile draws a shadow title", () => {
    renderTile({ titleStyle: "bar" });
    expect(
      screen.queryByRole("group", { name: "Shadow color swatches" }),
    ).not.toBeInTheDocument();
    cleanup();

    renderTile({ titleStyle: "shadow", showTitle: false });
    expect(
      screen.queryByRole("group", { name: "Shadow color swatches" }),
    ).not.toBeInTheDocument();
    cleanup();

    renderTile({ titleStyle: "shadow", showTitle: true });
    expect(
      screen.getByRole("group", { name: "Shadow color swatches" }),
    ).toBeInTheDocument();
  });

  it("emits only the tint, and clears it back to the theme", async () => {
    const user = userEvent.setup();
    const onChange = renderTile({
      titleStyle: "shadow",
      showTitle: true,
      titleShadowColor: "#ff0000",
    });
    const group = screen.getByRole("group", { name: "Shadow color swatches" });

    await user.click(group.querySelector<HTMLButtonElement>('[aria-label^="Grey"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ titleShadowColor: "#737373" });

    await user.click(group.querySelector<HTMLButtonElement>('[aria-label^="Use "]')!);
    expect(onChange).toHaveBeenLastCalledWith({ titleShadowColor: undefined });
  });
});

describe("shadow tint on the rendered tile", () => {
  function product(): Product {
    return {
      id: PRODUCT_ID,
      title: "Fade tile",
      description: "",
      price: 12.5,
      currency: "EUR",
      status: "active",
      imageUrl: null,
      digitalFileName: null,
      trackStock: false,
      stockQuantity: null,
      lowStockThreshold: 3,
      maxPerOrder: 10,
    };
  }

  function renderBlock(style: CardStyleOverrides) {
    const block: ProductBlock = {
      type: "product",
      productId: PRODUCT_ID,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      style,
    };
    const config: StorefrontConfig = {
      ...structuredClone(DEFAULT_STOREFRONT_CONFIG),
      theme: themed({ columns: 2, rows: 1, cornerRadius: 0 }),
      blocks: [block],
    };
    render(
      <StorefrontPreview
        config={config}
        productsById={new Map([[PRODUCT_ID, product()]])}
      />,
    );
    const title = screen.getByText("Fade tile");
    return { title, band: title.closest<HTMLElement>("[data-title-band]")! };
  }

  it("paints the tile's own tint and keeps white words on a dark one", () => {
    const { title, band } = renderBlock({
      titleStyle: "shadow",
      showTitle: true,
      titlePosition: "bottom-left",
      priceTagPosition: "hidden",
      titleShadowColor: "#1e3a8a",
    });
    // jsdom normalizes the #rrggbbaa stops to rgba().
    expect(band.style.backgroundImage).toContain("rgba(30, 58, 138, 0.7)");
    expect(title.style.color).toBe("rgb(255, 255, 255)");
    expect(title).toHaveClass("drop-shadow-sm");
  });

  it("switches the words to dark ink on a light tint", () => {
    const { title } = renderBlock({
      titleStyle: "shadow",
      showTitle: true,
      priceTagPosition: "hidden",
      titleShadowColor: "#fde68a",
    });
    expect(title.style.color).toBe("rgb(23, 23, 23)");
    expect(title).not.toHaveClass("drop-shadow-sm");
  });
});
