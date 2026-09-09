/**
 * The buyer's quantity control, on the page.
 *
 * What is being pinned here is not the arithmetic (product-quantity.test.ts
 * covers that) but the two behaviours a buyer actually meets: the control is a
 * CLOSED list bounded by the server's ceiling, and it disappears entirely when
 * there is nothing to choose. Plus the one thing the number is allowed to
 * affect — the enquiry the seller receives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductPageData } from "@/types/product-page";
import type { ProductPageProduct } from "@/types/product";

afterEach(cleanup);

function product(overrides: Partial<ProductPageProduct> = {}): ProductPageProduct {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "Oak lamp",
    description: "Warm light.",
    priceCents: 1250,
    currency: "EUR",
    purchaseUrl: null,
    shippingProfileId: null,
    images: [],
    optionGroups: [],
    details: {},
    documents: [],
    isDigital: false,
    digitalFormat: null,
    stock: null,
    soldOut: false,
    maxQuantity: 4,
    ...overrides,
  };
}

function data(overrides: Partial<ProductPageProduct> = {}): ProductPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      shippingPolicy: { shippingText: "", returnsText: "" },
      seller: { email: "hello@studio.test" },
      backgroundImageUrl: null,
      customFontUrl: null,
    },
    product: product(overrides),
    productUrl: "https://app.test/s/e/p/d",
  };
}

/** The quantity control's trigger, or null. There are two CTAs on the page
 *  (buy box and sticky bar) but only ever one picker. */
function picker(): HTMLElement | null {
  return screen.queryByRole("combobox", { name: "Quantity" });
}

/** Open the list and return its options. */
async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(picker()!);
  return screen.getAllByRole("option");
}

describe("QuantityPicker", () => {
  it("offers exactly the server's ceiling, and no value beyond it", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data({ maxQuantity: 4 })} mode="public" />);
    const control = picker();
    expect(control).not.toBeNull();
    // A CLOSED list: the only quantities that exist are the ones the server
    // put here. There is no text input to type a fourth-and-a-half into.
    expect(control!.tagName).toBe("BUTTON");
    expect(control!.querySelector("input")).toBeNull();
    expect(control).toHaveTextContent("1");

    const options = await openList(user);
    expect(options.map((option) => option.textContent)).toEqual(["1", "2", "3", "4"]);
  });

  it("commits a choice, and the list closes behind it", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data({ maxQuantity: 4 })} mode="public" />);
    const options = await openList(user);
    await user.click(options[2]!); // "3"
    expect(picker()).toHaveTextContent("3");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("is operable from the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data({ maxQuantity: 4 })} mode="public" />);
    picker()!.focus();
    await user.keyboard("{ArrowDown}"); // opens
    await user.keyboard("{ArrowDown}{ArrowDown}"); // 1 -> 2 -> 3
    await user.keyboard("{Enter}");
    expect(picker()).toHaveTextContent("3");
    // And it stops at the end of the list rather than wrapping round.
    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(picker()).toHaveTextContent("4");
  });

  it("is not rendered at all when the product sells one at a time", () => {
    render(<ProductPageView page={data({ maxQuantity: 1 })} mode="public" />);
    expect(picker()).toBeNull();
  });

  it("is not rendered when the product is sold out", () => {
    render(<ProductPageView page={data({ maxQuantity: 4, soldOut: true })} mode="public" />);
    expect(picker()).toBeNull();
  });

  it("opens on the quantity the server resolved from the URL", () => {
    render(
      <ProductPageView page={data({ maxQuantity: 6 })} mode="public" initialQuantity={3} />,
    );
    expect(picker()).toHaveTextContent("3");
  });

  it("clamps an initial quantity the product no longer allows", () => {
    // A link shared when the ceiling was higher, or one somebody edited. The
    // page opens legal rather than broken.
    render(
      <ProductPageView page={data({ maxQuantity: 2 })} mode="public" initialQuantity={99} />,
    );
    expect(picker()).toHaveTextContent("2");
  });

  it("shows the line total only once there is arithmetic worth showing", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data({ maxQuantity: 4, priceCents: 1250 })} mode="public" />);
    // At one unit the total IS the price already printed above it.
    expect(screen.queryByText(/×/)).toBeNull();
    await user.click((await openList(user))[2]!); // "3"
    expect(screen.getByText(/3 ×/)).toBeInTheDocument();
    expect(screen.getByText("€37.50")).toBeInTheDocument();
  });

  it("carries the chosen quantity into the seller's enquiry", async () => {
    const user = userEvent.setup();
    render(<ProductPageView page={data({ maxQuantity: 5 })} mode="public" />);
    await user.click((await openList(user))[3]!); // "4"
    // Both CTAs (buy box and sticky bar) read the same shared choice.
    for (const link of screen.getAllByRole("link", { name: /Ask about this product/i })) {
      expect(link.getAttribute("href")).toContain(encodeURIComponent("Quantity: 4"));
    }
  });

  it("says nothing about quantity in an enquiry for a single item", () => {
    render(<ProductPageView page={data({ maxQuantity: 5 })} mode="public" />);
    for (const link of screen.getAllByRole("link", { name: /Ask about this product/i })) {
      expect(link.getAttribute("href") ?? "").not.toContain("Quantity");
    }
  });
});
