import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "../setup/render";
import type { Product } from "@/types/product";
import { DEFAULT_STOREFRONT_CONFIG, type ProductBlock } from "@/types/storefront";

// The name and price save through the product's own action; nothing here saves.
vi.mock("@/lib/products/actions", () => ({ updateProduct: vi.fn() }));

const { ProductBlockEditor } = await import("@/components/storefront/ProductBlockEditor");

afterEach(cleanup);

const PRODUCT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const block: ProductBlock = { type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 1, h: 1 };

function product(purchaseUrl: string | null): Product {
  return {
    id: PRODUCT_ID,
    title: "Oak lamp",
    description: "",
    price: 40,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    purchaseUrl,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
    maxPerOrder: 10,
  };
}

function renderEditor(purchaseUrl: string | null, sellerEmail?: string) {
  return render(
    <ProductBlockEditor
      block={block}
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      product={product(purchaseUrl)}
      onStyleChange={vi.fn()}
      onStyleReset={vi.fn()}
      onRemove={vi.fn()}
      onProductSaved={vi.fn()}
      sellerEmail={sellerEmail}
    />,
  );
}

const warning = () => document.querySelector("[data-product-no-cta]");

describe("the product tile's inspector", () => {
  it("warns when the product page's buy button would have nowhere to go", () => {
    renderEditor(null);
    expect(warning()).toHaveTextContent("The buy button on its page has nowhere to go yet.");
  });

  it("says nothing once the product has a buy link, or the seller a contact email", () => {
    renderEditor("https://shop.example/oak-lamp");
    expect(warning()).toBeNull();
    cleanup();
    renderEditor(null, "hello@shop.example");
    expect(warning()).toBeNull();
  });

  it("follows the page's own rule: a link that is not https is no link", () => {
    renderEditor("http://shop.example/oak-lamp");
    expect(warning()).not.toBeNull();
  });

  it("labels the product's own details, apart from the tile's style", () => {
    // The name and price save to the product everywhere, behind a Save button;
    // the style below applies at once. The label says which is which before
    // that button ever appears.
    const { getByText } = renderEditor(null);
    expect(getByText("Product details")).toBeInTheDocument();
  });

  it("opens on the tile's style, leaving the other groups shut", () => {
    // With every group shut, a selected tile read as a product form with no
    // styling in it at all.
    const { getByRole } = renderEditor(null);
    expect(getByRole("button", { name: "Tile style" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("button", { name: "Price tag" })).toHaveAttribute("aria-expanded", "false");
  });

  it("says so when a typed name is dropped by closing the card unsaved", () => {
    // Selecting another tile or the canvas unmounts this card, and the draft
    // with it: the old name used to ship without a word.
    const view = renderEditor(null);
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Walnut lamp" } });
    view.rerender(<></>);
    expect(document.body).toHaveTextContent('Your new name or price for "Oak lamp" was not saved.');
  });

  it("closes quietly when nothing was changed", () => {
    const view = renderEditor(null);
    view.rerender(<></>);
    expect(document.body).not.toHaveTextContent("was not saved");
  });
});
