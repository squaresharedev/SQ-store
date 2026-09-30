import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
} from "@/types/storefront";
import type { CheckoutPageData } from "@/types/checkout";
import type { ProductPageProduct } from "@/types/product";

afterEach(cleanup);

const POLICY = {
  ratesCurrency: "EUR" as const,
  dispatch: "Packed within 2 days",
  destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
};

function product(overrides: Partial<ProductPageProduct> = {}): ProductPageProduct {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "Stoneware vase",
    description: "",
    priceCents: 2400,
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
    maxQuantity: 3,
    ...overrides,
  };
}

function page(overrides: Partial<ProductPageProduct> = {}): CheckoutPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, note: "Thrown by hand." },
      shippingPolicy: POLICY,
      seller: { businessName: "Clay House", email: "hi@clay.example", country: "IE" },
      backgroundImageUrl: null,
      customFontUrl: null,
      checkout: true,
    },
    product: product(overrides),
  };
}

const ATTEMPT = "5b1c2d3e-0000-4000-8000-00000000abcd";
const payButton = () => document.querySelector<HTMLButtonElement>("form [data-checkout-pay]")!;

describe("CheckoutView", () => {
  it("names the seller with their country beside the button, and the statutory notes", () => {
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    expect(screen.getByText("Sold by Clay House, Ireland")).toBeInTheDocument();
    expect(document.querySelector("[data-product-statutory]")).not.toBeNull();
    // The seller's own note, and the fixed pay label with the full total.
    expect(screen.getByText("Thrown by hand.")).toBeInTheDocument();
    expect(payButton()).toHaveTextContent("Pay €28.50");
    expect(payButton().disabled).toBe(false);
  });

  it("asks a download buyer for an email and consent only, and says what they are getting", () => {
    render(
      <CheckoutView
        page={page({ isDigital: true, digitalFormat: "PDF" })}
        mode="public"
        attemptId={ATTEMPT}
        provider="test"
      />,
    );
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.getByText("Digital download (PDF), nothing to deliver")).toBeInTheDocument();
    expect(document.querySelector("[data-checkout-consent] input")).not.toBeNull();
  });

  it("moves focus to the first problem when Pay is pressed on an empty form", async () => {
    const user = userEvent.setup();
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await user.click(payButton());
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Check the highlighted fields.")).toBeInTheDocument();
    // Keyboard and screen reader users land ON the field that needs fixing.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    expect(document.activeElement).toHaveAttribute("aria-invalid", "true");
  });

  it("never lets the editor's copy submit, and never draws a real payment there", () => {
    render(<CheckoutView page={page()} mode="preview" unwired />);
    expect(screen.getByText("Checkout opens for buyers when you connect Stripe.")).toBeInTheDocument();
    expect(document.querySelector("[data-checkout-payment='preview']")).not.toBeNull();
    expect(payButton().disabled).toBe(false);
  });
});
