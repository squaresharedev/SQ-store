import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import type { ReviewDialog } from "@/lib/reviews/reminders";

// The review ask on the buyer's order page (components/checkout/ReviewAsk and
// ReviewPanel): never before the buyer has the goods (the reminder offer
// instead), one question first, the rest once a star is chosen, the real route
// for a buyer and nothing at all from the editor's preview.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom does not implement window.matchMedia; the thank-you's confetti
// (`placed`) reads it. Same stub as background-editor.test.tsx.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
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
    // Shipped: the buyer has it, so the page asks.
    fulfilment: "shipped",
    shippedAt: "2026-10-27T10:00:00Z",
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

const view = (
  overrides: Partial<BuyerOrder> = {},
  mode: "public" | "preview" = "public",
  productPage?: ProductPageConfig,
  { placed = false, dialog = null }: { placed?: boolean; dialog?: ReviewDialog | null } = {},
) =>
  render(
    <OrderStatusView page={pageData(overrides, productPage)} mode={mode} placed={placed} reviewDialog={dialog} />,
  );

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

describe("asking after the buyer has it, not straight after paying", () => {
  const off = { status: "off", dueAt: null } as const;
  const later = () => document.querySelector<HTMLElement>('[data-order-review="later"]');
  const okReminder = (status: "on" | "off", dueAt: string | null = null) =>
    vi.fn(async () => Response.json({ ok: true, status, dueAt }, { status: 200 }));

  it("asks for no stars before a parcel ships, and offers one reminder email instead", () => {
    view({ fulfilment: "unfulfilled", shippedAt: null, reviewReminder: off }, "public", undefined, { placed: true });
    expect(screen.queryByRole("radio")).toBeNull();
    const card = within(later()!);
    expect(card.getByRole("heading", { name: "Review it once it has arrived" })).toBeTruthy();
    expect(
      card.getByText(
        "Clay House can email you once, about a week after it ships, with a link to review it here. You can stop it at any time.",
      ),
    ).toBeTruthy();
    expect(card.getByRole("button", { name: "Email me a reminder" })).toBeTruthy();
  });

  it("says nothing at all before the goods arrive when no reminder can be offered", () => {
    view({ fulfilment: "unfulfilled", shippedAt: null });
    expect(card()).toBeNull();
  });

  it("asks nothing on a download's thank-you, and the stars on any visit after", () => {
    const download = { isDigital: true, fulfilment: "not_required", shippedAt: null, reviewReminder: off } as const;
    view(download, "public", undefined, { placed: true });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(within(later()!).getByRole("heading", { name: "Review it once you have tried it" })).toBeTruthy();
    cleanup();
    view(download);
    expect(card()!.dataset.orderReview).toBe("ask");
  });

  it("records the buyer's yes with their order link, says when, and takes it back as easily", async () => {
    const user = userEvent.setup();
    const fetchMock = okReminder("on");
    vi.stubGlobal("fetch", fetchMock);
    view({ fulfilment: "unfulfilled", shippedAt: null, reviewReminder: off });
    await user.click(screen.getByRole("button", { name: "Email me a reminder" }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/orders/review-reminder");
    expect(JSON.parse(init.body as string)).toEqual({ orderRef: "order-ref", want: true });
    expect(later()!.dataset.orderReviewReminder).toBe("on");
    expect(screen.getByText("Clay House will email you a reminder about a week after it ships.")).toBeTruthy();

    fetchMock.mockImplementation(okReminder("off"));
    await user.click(screen.getByRole("button", { name: "Don't email me" }));
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      orderRef: "order-ref",
      want: false,
    });
    expect(later()!.dataset.orderReviewReminder).toBe("off");
  });

  it("names the date once the parcel has gone", () => {
    view({ fulfilment: "unfulfilled", shippedAt: null, reviewReminder: { status: "on", dueAt: "2026-11-09T10:00:00Z" } });
    expect(screen.getByText("Clay House will email you a reminder around November 9.")).toBeTruthy();
  });

  it("offers the reminder under the stars too, for a parcel shipped but not yet arrived", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", okReminder("on", "2026-11-03T10:00:00Z"));
    view({ reviewReminder: off });
    expect(card()!.dataset.orderReview).toBe("ask");
    expect(screen.getByText("Not arrived yet?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Email me a reminder" }));
    expect(screen.getByText(/around November 3/)).toBeTruthy();
  });

  it("says why when a reminder can no longer be set up", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "closed" }, { status: 409 })));
    view({ fulfilment: "unfulfilled", shippedAt: null, reviewReminder: off });
    await user.click(screen.getByRole("button", { name: "Email me a reminder" }));
    expect(screen.getByRole("alert").textContent).toBe("A reminder can no longer be set up for this order.");
  });

  it("lets the seller try the reminder in the preview, and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    view({ ref: "", fulfilment: "unfulfilled", shippedAt: null, reviewReminder: off }, "preview", undefined, { placed: true });
    await user.click(screen.getByRole("button", { name: "Email me a reminder" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("This is a preview, so no email will be sent.")).toBeTruthy();
  });
});

describe("the reminder email's links", () => {
  it("opens the review in a dialog, and closing it leaves the thanks on the page", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, status: "pending" }, { status: 201 })));
    view({}, "public", undefined, { dialog: "write" });
    const dialog = within(await screen.findByRole("dialog", { name: "How would you rate it?" }));
    // The page's own card waits behind it rather than doubling up.
    expect(document.querySelectorAll('[data-order-review="ask"]')).toHaveLength(1);
    await user.click(dialog.getByRole("radio", { name: "5 stars" }));
    await user.type(dialog.getByLabelText("Your review"), "Lovely.");
    await user.click(dialog.getByRole("button", { name: "Post review" }));
    expect(dialog.getByRole("heading", { name: "Thanks for your review" })).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(card()!.dataset.orderReview).toBe("done");
  });

  it("opens no review dialog for an order already reviewed", () => {
    view({ review: "done", reviewRating: 4 }, "public", undefined, { dialog: "write" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(card()!.dataset.orderReview).toBe("done");
  });

  it("stops the reminder from its own dialog, even where the page shows no review", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => Response.json({ ok: true, status: "sent" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    view({ review: "closed" }, "public", undefined, { dialog: "stop" });
    const dialog = within(await screen.findByRole("dialog", { name: "Stop the reminder?" }));
    await user.click(dialog.getByRole("button", { name: "Stop the reminder" }));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      orderRef: "order-ref",
      want: false,
    });
    expect(await screen.findByRole("dialog", { name: "Reminder stopped" })).toBeTruthy();
  });
});
