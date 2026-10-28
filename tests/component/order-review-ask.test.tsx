import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { OrderStatusView } from "@/components/checkout/OrderStatusView";
import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type ProductPageConfig,
} from "@/types/storefront";
import type { BuyerOrder, OrderPageData } from "@/types/checkout";

// The review ask on the buyer's order page (components/checkout/ReviewPanel):
// one question first, the rest once a star is chosen, the real route for a
// buyer and nothing at all from the editor's preview.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function order(overrides: Partial<BuyerOrder> = {}): BuyerOrder {
  return {
    ref: "order-ref",
    number: "A1B2C3D4",
    placedAt: "2026-10-25T10:00:00Z",
    productId: PRODUCT_ID,
    productTitle: "Stoneware vase",
    photo: null,
    quantity: 1,
    selection: [],
    amountCents: 2400,
    currency: "EUR",
    maskedEmail: "a***@example.test",
    firstName: "Aoife",
    destination: { city: "Dublin", country: "IE" },
    isDigital: false,
    digitalFormat: null,
    fulfilment: "unfulfilled",
    shippedAt: null,
    trackingNumber: null,
    trackingLink: null,
    dispatch: null,
    withdrawal: { requestedAt: null, available: true, until: null, days: 14 },
    payment: "paid",
    refundedAt: null,
    confirmationSent: true,
    review: "open",
    ...overrides,
  };
}

function pageData(overrides: Partial<BuyerOrder> = {}, productPage: ProductPageConfig = DEFAULT_PRODUCT_PAGE_CONFIG): OrderPageData {
  return {
    storefront: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Studio",
      theme: DEFAULT_STOREFRONT_CONFIG.theme,
      productPage,
      checkoutPage: DEFAULT_CHECKOUT_PAGE_CONFIG,
      shippingPolicy: { ratesCurrency: "EUR", destinations: [] },
      seller: { businessName: "Clay House", email: "hi@clay.example", country: "IE" },
      backgroundImageUrl: null,
      customFontUrl: null,
    },
    order: order(overrides),
  };
}

const view = (overrides: Partial<BuyerOrder> = {}, mode: "public" | "preview" = "public", productPage?: ProductPageConfig) =>
  render(<OrderStatusView page={pageData(overrides, productPage)} mode={mode} placed={false} />);

const card = () => document.querySelector<HTMLElement>("[data-order-review]");

describe("the review ask on the order page", () => {
  it("asks one question first: five stars, and no form until one is chosen", () => {
    view();
    const ask = within(card()!);
    expect(card()!.dataset.orderReview).toBe("ask");
    expect(ask.getByRole("heading", { name: "How would you rate it?" })).toBeTruthy();
    expect(ask.getAllByRole("radio")).toHaveLength(5);
    expect(ask.queryByRole("textbox")).toBeNull();
    // Above the right to withdraw.
    const withdrawal = document.querySelector("[data-order-withdrawal]")!;
    expect(card()!.compareDocumentPosition(withdrawal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not ask when the product page does not show reviews, or the order cannot be reviewed", () => {
    view({}, "public", { ...DEFAULT_PRODUCT_PAGE_CONFIG, sections: [{ id: "reviews", show: false }] });
    expect(card()).toBeNull();
    cleanup();
    view({ review: "closed" });
    expect(card()).toBeNull();
    cleanup();
    view({ review: undefined });
    expect(card()).toBeNull();
  });

  it("posts the review with the order's link and thanks the buyer with the stars they gave", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => Response.json({ ok: true, status: "pending" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    view();
    const ask = within(card()!);
    await user.click(ask.getByRole("radio", { name: "4 stars" }));
    expect(ask.getByText("Very good")).toBeTruthy();
    // The name to show starts as the first name on the order.
    expect((ask.getByLabelText("Name to show") as HTMLInputElement).value).toBe("Aoife");
    const post = ask.getByRole("button", { name: "Post review" }) as HTMLButtonElement;
    expect(post.disabled).toBe(true);

    // Every field is there at once, the title included.
    await user.type(ask.getByLabelText("Title (optional)"), "Lovely glaze");
    await user.type(ask.getByLabelText("Your review"), "Even nicer in person.");
    await user.click(post);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/products/${PRODUCT_ID}/reviews`);
    expect(JSON.parse(init.body as string)).toEqual({
      orderRef: "order-ref",
      rating: 4,
      title: "Lovely glaze",
      body: "Even nicer in person.",
      authorName: "Aoife",
    });
    expect(card()!.dataset.orderReview).toBe("sent");
    expect(screen.getByRole("heading", { name: "Thanks for your review" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Rated 4 stars out of 5" })).toBeTruthy();
    expect(screen.queryByText(/nothing was posted/)).toBeNull();
  });

  it("says why when the route refuses, and keeps what was written", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "not_eligible" }, { status: 409 })));
    view();
    const ask = within(card()!);
    await user.click(ask.getByRole("radio", { name: "2 stars" }));
    await user.type(ask.getByLabelText("Your review"), "Chipped.");
    await user.click(ask.getByRole("button", { name: "Post review" }));
    expect(ask.getByRole("alert").textContent).toBe("This order can no longer be reviewed.");
    expect((ask.getByLabelText("Your review") as HTMLTextAreaElement).value).toBe("Chipped.");
  });

  it("lets the seller try it in the editor's preview, and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    view({ ref: "" }, "preview");
    const ask = within(card()!);
    await user.click(ask.getByRole("radio", { name: "5 stars" }));
    await user.type(ask.getByLabelText("Your review"), "Trying it out.");
    await user.click(ask.getByRole("button", { name: "Post review" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(card()!.dataset.orderReview).toBe("sent");
    expect(screen.getByText("This is a preview, so nothing was posted.")).toBeTruthy();
  });

  it("shows the stars given, not the form, once the order has its review", () => {
    view({ review: "done", reviewRating: 3 });
    expect(card()!.dataset.orderReview).toBe("done");
    expect(screen.getByRole("img", { name: "Rated 3 stars out of 5" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
