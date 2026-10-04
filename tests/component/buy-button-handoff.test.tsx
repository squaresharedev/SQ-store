// The website button's marker, handed from page to page in the browser: the
// product page's own Buy now carries it into the checkout link, and the
// checkout sends it with the order as the channel. Never when there is none.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OptionProvider } from "@/components/product-page/OptionContext";
import { ProductCta } from "@/components/product-page/ProductCta";
import { QuantityProvider } from "@/components/product-page/QuantityContext";
import { resolveCta } from "@/components/product-page/product-page-maps";
import type { LinkChannel } from "@/lib/storefront/product-page-url";
import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
} from "@/types/storefront";
import type { CheckoutPageData } from "@/types/checkout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

const STOREFRONT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRODUCT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("the product page's Buy now", () => {
  function renderCta(via: LinkChannel | null) {
    render(
      <OptionProvider groups={[]} initialOptionIds={[]} syncUrl={false}>
        <QuantityProvider limit={5} initialQuantity={2} syncUrl={false}>
          <ProductCta
            target={{ kind: "checkout", storefrontId: STOREFRONT, productId: PRODUCT, via }}
            label="Buy now"
            cta={resolveCta(DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG.theme)}
            ink="#111111"
            soldOut={false}
            preview={false}
          />
        </QuantityProvider>
      </OptionProvider>,
    );
    return screen.getByRole("link", { name: /buy now/i });
  }

  it("takes the arrival marker into the checkout, beside the quantity", () => {
    expect(renderCta("button")).toHaveAttribute("href", `/s/${STOREFRONT}/p/${PRODUCT}/checkout?q=2&via=button`);
  });

  it("adds nothing for a buyer who came any other way", () => {
    expect(renderCta(null)).toHaveAttribute("href", `/s/${STOREFRONT}/p/${PRODUCT}/checkout?q=2`);
  });
});

describe("the checkout's order", () => {
  const page: CheckoutPageData = {
    storefront: {
      id: STOREFRONT,
      name: "Studio",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      checkoutPage: DEFAULT_CHECKOUT_PAGE_CONFIG,
      shippingPolicy: {
        ratesCurrency: "EUR",
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
      },
      seller: { businessName: "Clay House", email: "hi@clay.example", country: "IE" },
      backgroundImageUrl: null,
      customFontUrl: null,
      checkout: true,
    },
    product: {
      id: PRODUCT,
      title: "Stoneware vase",
      description: "",
      priceCents: 2400,
      currency: "EUR",
      sale: null,
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
    },
  };

  async function placeOrder(via: LinkChannel | null): Promise<Record<string, unknown>> {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: false, error: "failed" }), { status: 500 });
    });
    render(
      <CheckoutView
        page={page}
        mode="public"
        attemptId="5b1c2d3e-0000-4000-8000-00000000abcd"
        provider="test"
        via={via}
      />,
    );
    // Pasted rather than typed: what is under test is the body, and a keystroke
    // per character is what makes a form test time out on a busy machine.
    for (const [label, value] of [
      ["Email", "aoife@example.test"],
      ["Full name", "Aoife Byrne"],
      ["Address", "12 Harbour Road"],
      ["Town or city", "Dublin"],
    ] as const) {
      await user.click(screen.getByLabelText(label, { exact: true }));
      await user.paste(value);
    }
    await user.click(document.querySelector<HTMLButtonElement>("form [data-checkout-pay]")!);
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    fetchMock.mockRestore();
    return bodies[0]!;
  }

  it("sends the website button as the order's channel", async () => {
    expect(await placeOrder("button")).toMatchObject({ channel: "button" });
  });

  it("sends no channel at all when the buyer came directly", async () => {
    expect(await placeOrder(null)).not.toHaveProperty("channel");
  });
});
