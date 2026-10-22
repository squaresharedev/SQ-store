import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { Product } from "@/types/product";

/**
 * The product page artboard's CHECKOUT button: it opens the checkout artboards
 * beside the page, so it carries a trailing arrow that nudges right on hover
 * (iconNudgeRightClass), the same cue every "this opens something" control in
 * the app uses.
 */

// The preview load is a server action; the first frame from the catalogue row
// is all this needs.
vi.mock("@/lib/products/preview-actions", () => ({
  getProductPagePreviewData: () => new Promise(() => {}),
}));

const { ProductPageArtboard } = await import("@/components/storefront/ProductPageArtboard");

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
  maxPerOrder: 10,
};

function artboard(onToggleCheckout = vi.fn()) {
  render(
    <ProductPageArtboard
      product={PRODUCT}
      soldOut={false}
      storefrontId="00000000-0000-4000-8000-000000000000"
      storefrontName="Clay House"
      theme={DEFAULT_STOREFRONT_CONFIG.theme}
      header={{ show: true, name: "Clay House", bio: "" }}
      productPage={DEFAULT_PRODUCT_PAGE_CONFIG}
      shippingPolicy={{}}
      seller={{}}
      backgroundImageUrl={null}
      customFontUrl={null}
      pagePhoto={null}
      onClose={vi.fn()}
      widths={{ desktop: 1180, mobile: 390 }}
      initialDevice="desktop"
      onToggleCheckout={onToggleCheckout}
    />,
  );
  return onToggleCheckout;
}

describe("the product page's checkout button", () => {
  it("ends in an arrow that nudges right on hover and focus, and still opens the checkout", async () => {
    const onToggle = artboard();
    const button = screen.getByRole("button", { name: "Open the checkout for Enamel mug" });
    expect(button).toHaveTextContent("Checkout");
    expect(button).toHaveClass("group/btn");
    // The arrow comes AFTER the word: it points where the press takes you.
    const arrow = button.lastElementChild as SVGElement;
    expect(arrow.tagName.toLowerCase()).toBe("svg");
    expect(arrow.getAttribute("class")).toContain("group-hover/btn:translate-x-0.5");
    expect(arrow.getAttribute("class")).toContain("motion-reduce:transition-none");
    await userEvent.setup().click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
