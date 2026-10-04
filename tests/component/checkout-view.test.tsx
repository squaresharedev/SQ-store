import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
} from "@/types/storefront";
import type { BuyerOrder, CheckoutPageData } from "@/types/checkout";
import type { ProductPageProduct } from "@/types/product";

// The form re-reads the page (router.refresh) when the server says the price
// changed while it was open.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

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

  it("offers a phone for the courier, says why behind the (i), and only minds one that is not a number", async () => {
    const user = userEvent.setup();
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    const phone = screen.getByLabelText("Phone (optional)");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("autocomplete", "shipping tel");
    expect(phone).toHaveAccessibleDescription(/Only for the courier/);

    // Left empty it is no problem at all.
    await user.click(phone);
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "false");

    await user.type(phone, "call me after six");
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a phone number using digits, like +353 85 123 4567.")).toBeInTheDocument();

    await user.clear(phone);
    await user.type(phone, "+353 87 123 4567");
    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "false");
  });

  it("sends the phone with the address when one was given, and no phone key when it was not", async () => {
    const user = userEvent.setup();
    const bodies: { shipTo?: Record<string, string> }[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      // A refusal, so the form stays put and can be submitted a second time.
      return new Response(JSON.stringify({ ok: false, error: "failed" }), { status: 500 });
    });
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await user.type(screen.getByLabelText("Email"), "aoife@example.test");
    await user.type(screen.getByLabelText("Full name"), "Aoife Byrne");
    await user.type(screen.getByLabelText("Address", { exact: true }), "12 Harbour Road");
    await user.type(screen.getByLabelText("Town or city"), "Dublin");

    await user.click(payButton());
    await screen.findByRole("alert");
    expect(bodies[0]?.shipTo).not.toHaveProperty("phone");

    await user.type(screen.getByLabelText("Phone (optional)"), " +353 87 123 4567 ");
    await user.click(payButton());
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.shipTo).toMatchObject({ name: "Aoife Byrne", country: "IE", phone: "+353 87 123 4567" });
    fetchMock.mockRestore();
  });

  it("does not ask a download buyer for a phone", () => {
    render(<CheckoutView page={page({ isDigital: true })} mode="public" attemptId={ATTEMPT} provider="test" />);
    expect(screen.queryByLabelText("Phone (optional)")).toBeNull();
  });

  it("never lets the editor's copy submit, and never draws a real payment there", () => {
    render(<CheckoutView page={page()} mode="preview" />);
    expect(document.querySelector("[data-checkout-payment='preview']")).not.toBeNull();
    expect(payButton().disabled).toBe(false);
  });
});

describe("CheckoutView page photo", () => {
  it("paints the seller's photo behind the page, and nothing without one", () => {
    const withPhoto = page();
    withPhoto.storefront.pagePhoto = { url: "https://cdn.example/bg.webp", overlay: true };
    const { unmount } = render(<CheckoutView page={withPhoto} mode="public" attemptId={ATTEMPT} provider="test" />);
    const photo = document.querySelector<HTMLElement>("[data-page-photo]");
    expect(photo).not.toBeNull();
    expect(photo!.style.backgroundImage).toContain("https://cdn.example/bg.webp");
    unmount();
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    expect(document.querySelector("[data-page-photo]")).toBeNull();
  });
});

describe("page photo overlay", () => {
  it("draws the photo plain when the overlay is off", () => {
    const withPhoto = page();
    withPhoto.storefront.pagePhoto = { url: "https://cdn.example/bg.webp", overlay: false };
    render(<CheckoutView page={withPhoto} mode="public" attemptId={ATTEMPT} provider="test" />);
    expect(document.querySelector<HTMLElement>("[data-page-photo]")!.style.backgroundImage).not.toContain("rgba");
  });
});

describe("OrderStatusView tracking", () => {
  function order(overrides: Partial<BuyerOrder> = {}): BuyerOrder {
    return {
      ref: "ref",
      number: "A1B2C3D4",
      placedAt: "2026-09-25T10:00:00Z",
      productId: null,
      productTitle: "Stoneware vase",
      photo: null,
      quantity: 1,
      selection: [],
      amountCents: 2850,
      currency: "EUR",
      maskedEmail: "a***@example.test",
      firstName: "Aoife",
      destination: { city: "Dublin", country: "IE" },
      isDigital: false,
      digitalFormat: null,
      fulfilment: "shipped",
      shippedAt: "2026-09-27T10:00:00Z",
      trackingNumber: "RR123456789IE",
      trackingLink: null,
      dispatch: null,
      withdrawal: { requestedAt: null, available: false, until: null, days: 14 },
      ...overrides,
    };
  }
  const view = (overrides: Partial<BuyerOrder> = {}) =>
    render(<OrderStatusView page={{ storefront: page().storefront, order: order(overrides) }} mode="public" placed={false} />);
  const shippedStep = () => document.querySelector<HTMLElement>('[data-order-step="shipped"]')!;

  it("links the shipped step to the carrier's own page, without handing it this page's address", () => {
    const url = "https://www.anpost.com/Post-Parcels/Track/History?item=RR123456789IE";
    view({ trackingLink: { carrier: "An Post", url } });
    const link = within(shippedStep()).getByRole("link", { name: "Track with An Post" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    // The order page's URL is the buyer's credential: it must not travel as a referrer.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(shippedStep()).toHaveTextContent("Tracking number RR123456789IE");
  });

  it("shows the bare number, and no link, when the seller named no carrier", () => {
    view();
    expect(shippedStep()).toHaveTextContent("Tracking number RR123456789IE");
    expect(within(shippedStep()).queryByRole("link")).toBeNull();
  });

  it("paints the thank-you page's own photo behind it", () => {
    const storefront = { ...page().storefront, pagePhoto: { url: "https://cdn.example/thanks.webp", overlay: true } };
    render(<OrderStatusView page={{ storefront, order: order() }} mode="public" placed={false} />);
    expect(document.querySelector<HTMLElement>("[data-page-photo]")!.style.backgroundImage).toContain("thanks.webp");
  });

  it("offers nothing to follow before the parcel has gone", () => {
    view({ fulfilment: "unfulfilled", shippedAt: null, trackingNumber: null });
    expect(document.querySelector("[data-order-track]")).toBeNull();
    expect(shippedStep()).toHaveTextContent("You'll get an email when it's sent.");
  });
});

describe("checkout discounts", () => {
  /** A sale: 20% off, announced against a proven 30-day price. */
  const SALE = { regularPriceCents: 2400, priorPriceCents: 2400, percentOff: 20, endsAt: null };
  const terms = (percentOff: number) => ({ code: "SUMMER10", value: { type: "percent", percentOff } });

  /** Answers the code check with `check`, and records every order body. */
  function stubFetch(check: unknown, order: unknown = { ok: false, error: "failed" }) {
    const orders: Record<string, unknown>[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/discount")) return new Response(JSON.stringify(check), { status: 200 });
      orders.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(order), { status: 409 });
    });
    return { orders, restore: () => spy.mockRestore() };
  }

  async function applyCode(user: ReturnType<typeof userEvent.setup>, code: string) {
    await user.click(screen.getByRole("button", { name: "Add a discount code" }));
    await user.type(screen.getByLabelText("Discount code"), code);
    await user.click(screen.getByRole("button", { name: "Apply" }));
  }

  async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Email"), "aoife@example.test");
    await user.type(screen.getByLabelText("Full name"), "Aoife Byrne");
    await user.type(screen.getByLabelText("Address", { exact: true }), "12 Harbour Road");
    await user.type(screen.getByLabelText("Town or city"), "Dublin");
  }

  it("applies a code, takes it off the items, and sends it with the total the buyer saw", async () => {
    const user = userEvent.setup();
    const fetches = stubFetch({ ok: true, terms: terms(10) });
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await applyCode(user, "summer10");

    expect(await screen.findByText("SUMMER10 applied.")).toBeInTheDocument();
    const line = document.querySelector("[data-checkout-line='discount']");
    expect(line).toHaveTextContent("Discount (SUMMER10)");
    expect(line).toHaveTextContent("-€2.40");
    // 24.00 - 2.40 + 4.50 delivery.
    expect(payButton()).toHaveTextContent("Pay €26.10");

    await fillAddress(user);
    await user.click(payButton());
    await vi.waitFor(() => expect(fetches.orders).toHaveLength(1));
    expect(fetches.orders[0]).toMatchObject({ discountCode: "SUMMER10", expectedTotalCents: 2610 });
    fetches.restore();
  });

  it("says plainly when a code cannot be used, and charges as before", async () => {
    const user = userEvent.setup();
    const fetches = stubFetch({ ok: false, error: "discount_invalid" });
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await applyCode(user, "nope10");

    expect(await screen.findByRole("alert")).toHaveTextContent("This code can't be used for this order.");
    expect(screen.getByLabelText("Discount code")).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector("[data-checkout-line='discount']")).toBeNull();
    expect(payButton()).toHaveTextContent("Pay €28.50");
    fetches.restore();
  });

  it("applies the code on Enter instead of placing the order", async () => {
    const user = userEvent.setup();
    const fetches = stubFetch({ ok: true, terms: terms(10) });
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await user.click(screen.getByRole("button", { name: "Add a discount code" }));
    await user.type(screen.getByLabelText("Discount code"), "summer10{Enter}");
    expect(await screen.findByText("SUMMER10 applied.")).toBeInTheDocument();
    expect(fetches.orders).toHaveLength(0);
    fetches.restore();
  });

  it("keeps the sale price when the code does no better, and says so", async () => {
    const user = userEvent.setup();
    const fetches = stubFetch({ ok: true, terms: terms(10) });
    render(<CheckoutView page={page({ priceCents: 1920, sale: SALE })} mode="public" attemptId={ATTEMPT} provider="test" />);
    // The card announces the sale like the product page.
    expect(document.querySelector("[data-checkout-unit-price='1920']")).toHaveTextContent("Was €24.00, now €19.20");
    await applyCode(user, "summer10");

    expect(await screen.findByText("SUMMER10 works, but your sale price is already lower, so we kept it.")).toBeInTheDocument();
    expect(document.querySelector("[data-checkout-line='discount']")).toBeNull();
    expect(payButton()).toHaveTextContent("Pay €23.70");
    fetches.restore();
  });

  it("swaps the sale for a code that does better, from the regular price", async () => {
    const user = userEvent.setup();
    const fetches = stubFetch({ ok: true, terms: terms(30) });
    render(<CheckoutView page={page({ priceCents: 1920, sale: SALE })} mode="public" attemptId={ATTEMPT} provider="test" />);
    await applyCode(user, "summer10");

    expect(await screen.findByText("SUMMER10 applied.")).toBeInTheDocument();
    expect(document.querySelector("[data-checkout-unit-price='2400']")).not.toBeNull();
    expect(document.querySelector("[data-checkout-line='discount']")).toHaveTextContent("-€7.20");
    // 24.00 - 7.20 + 4.50.
    expect(payButton()).toHaveTextContent("Pay €21.30");
    fetches.restore();
  });

  it("re-reads the page when the price changed while it was open", async () => {
    const user = userEvent.setup();
    refresh.mockClear();
    const fetches = stubFetch(null, { ok: false, error: "price_changed" });
    render(<CheckoutView page={page()} mode="public" attemptId={ATTEMPT} provider="test" />);
    await fillAddress(user);
    await user.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("The price changed while this page was open");
    expect(refresh).toHaveBeenCalled();
    fetches.restore();
  });
});
