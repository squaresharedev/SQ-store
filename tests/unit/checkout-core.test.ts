/**
 * The small pure pieces checkout rests on: which version an order is for,
 * the order link as a credential, when a buyer may withdraw, the seller's
 * checkout design as stored, where "Buy now" goes, and that the development
 * test provider cannot exist outside `next dev`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { photoForSelection, previewSelection, strictSelection } from "@/lib/checkout/selection";
import { orderNumber, orderRef, verifyOrderRef } from "@/lib/orders/order-link";
import { buyerWithdrawal } from "@/lib/orders/withdrawal";
import { checkoutPageSchema, parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { isDefaultCheckoutPage, resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import { resolveCtaTarget } from "@/components/product-page/cta-target";
import { checkoutPath } from "@/lib/storefront/product-page-url";
import { checkoutProviderFor, testPaymentsEnabled } from "@/lib/checkout/availability";
import { DEFAULT_CHECKOUT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductOptionGroup } from "@/types/product";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const OUT = "a0000000-0000-4000-8000-000000000003";
const RED = "b0000000-0000-4000-8000-000000000001";
const GROUPS: ProductOptionGroup[] = [
  {
    id: "g0000000-0000-4000-8000-000000000001",
    name: "Size",
    display: "chip",
    options: [
      { id: A, name: "Small", available: true },
      { id: B, name: "Large", available: true },
      { id: OUT, name: "Giant", available: false },
    ],
  },
  {
    id: "g0000000-0000-4000-8000-000000000002",
    name: "Colour",
    display: "swatch",
    options: [{ id: RED, name: "Red", available: true }],
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("strictSelection", () => {
  it("takes exactly one available option in every group", () => {
    const selection = strictSelection(GROUPS, [B, RED]);
    expect(selection && Object.values(selection).map((option) => option.name)).toEqual(["Large", "Red"]);
  });

  it("never fills a gap, and refuses unavailable, doubled or foreign ids", () => {
    expect(strictSelection(GROUPS, [B])).toBeNull();
    expect(strictSelection(GROUPS, [OUT, RED])).toBeNull();
    expect(strictSelection(GROUPS, [A, B, RED])).toBeNull();
    expect(strictSelection(GROUPS, [A, RED, "c0000000-0000-4000-8000-000000000009"])).toBeNull();
  });

  it("accepts nothing for a product with no options, and nothing else", () => {
    expect(strictSelection([], [])).toEqual({});
    expect(strictSelection([], [A])).toBeNull();
  });

  it("previews the first available version, and its own photo", () => {
    const selection = previewSelection(GROUPS);
    expect(Object.values(selection).map((option) => option.name)).toEqual(["Small", "Red"]);
    const images = [
      { url: "cover", alt: "" },
      { url: "large", alt: "", optionId: B },
      { url: "small", alt: "", optionId: A },
    ];
    expect(photoForSelection(images, selection)?.url).toBe("small");
    expect(photoForSelection(images, {})?.url).toBe("cover");
  });
});

describe("order links", () => {
  const ORDER = "12345678-9abc-4def-8123-456789abcdef";

  it("prove the order they name and nothing else", async () => {
    vi.stubEnv("ORDER_LINK_SECRET", "test-secret");
    const ref = await orderRef(ORDER);
    expect(ref).toMatch(/^12345678-9abc-4def-8123-456789abcdef\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyOrderRef(ref!)).toBe(ORDER);

    const [, mac] = ref!.split(".");
    const other = "22345678-9abc-4def-8123-456789abcdef";
    expect(await verifyOrderRef(`${other}.${mac}`)).toBeNull();
    expect(await verifyOrderRef(`${ORDER}.${"A".repeat(43)}`)).toBeNull();
    expect(await verifyOrderRef(`${ORDER}.${mac}x`)).toBeNull();
    expect(await verifyOrderRef("cs_test_abc")).toBeNull();
  });

  it("stop working when the key changes, and are refused without one", async () => {
    vi.stubEnv("ORDER_LINK_SECRET", "first");
    const ref = await orderRef(ORDER);
    vi.stubEnv("ORDER_LINK_SECRET", "second");
    expect(await verifyOrderRef(ref!)).toBeNull();
    vi.stubEnv("ORDER_LINK_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await orderRef(ORDER)).toBeNull();
  });

  it("never borrow the service-role key in production", async () => {
    vi.stubEnv("ORDER_LINK_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("NODE_ENV", "production");
    expect(await orderRef(ORDER)).toBeNull();
    // Outside production it is a convenience, so the flow runs unconfigured.
    vi.stubEnv("NODE_ENV", "development");
    expect(await orderRef(ORDER)).not.toBeNull();
    // And a dedicated secret is honoured everywhere, production included.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORDER_LINK_SECRET", "dedicated");
    expect(await orderRef(ORDER)).not.toBeNull();
  });

  it("print a short number a buyer can read out", () => {
    expect(orderNumber(ORDER)).toBe("12345678");
  });
});

describe("buyerWithdrawal", () => {
  const base = {
    status: "paid",
    fulfilment_status: "unfulfilled",
    shipped_at: null,
    created_at: "2026-09-01T10:00:00Z",
    supply_consent_at: null,
    withdrawal_requested_at: null,
  };
  const now = new Date("2026-09-10T10:00:00Z");

  it("is open, with no end date yet, while the parcel has not gone", () => {
    expect(buyerWithdrawal(base, {}, now)).toEqual({ requestedAt: null, available: true, until: null, days: 14 });
  });

  it("runs the longer of 14 days and the seller's window, plus delivery, from shipping", () => {
    const shipped = { ...base, fulfilment_status: "shipped", shipped_at: "2026-09-02T10:00:00Z" };
    const result = buyerWithdrawal(shipped, { returnsWindowDays: 30 }, now);
    expect(result.days).toBe(30);
    expect(result.until).toBe("2026-10-16T10:00:00.000Z");
    expect(buyerWithdrawal(shipped, {}, new Date("2026-10-01T10:00:00Z")).available).toBe(false);
  });

  it("is not offered after consent to immediate supply, or on an order no longer simply paid", () => {
    const download = { ...base, fulfilment_status: "not_required" };
    expect(buyerWithdrawal(download, {}, now).available).toBe(true);
    expect(buyerWithdrawal({ ...download, supply_consent_at: base.created_at }, {}, now).available).toBe(false);
    expect(buyerWithdrawal({ ...base, status: "refunded" }, {}, now).available).toBe(false);
  });

  it("says when the buyer already withdrew, and does not offer it twice", () => {
    const done = buyerWithdrawal({ ...base, withdrawal_requested_at: "2026-09-05T10:00:00Z" }, {}, now);
    expect(done).toMatchObject({ requestedAt: "2026-09-05T10:00:00Z", available: false });
  });
});

describe("the checkout design as stored", () => {
  it("accepts the design's closed shapes and plain words", () => {
    const parsed = checkoutPageSchema.safeParse({
      layout: "compact",
      backgroundColor: "#faf6ef",
      headline: "Nearly yours",
      note: "Thrown by hand.\nFired twice.",
      giftMessage: true,
      thanksMessage: "Thank you!",
      celebrate: "rays",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses links, email addresses and bank details in the seller's words", () => {
    for (const note of [
      "Pay at clayhouse.shop instead",
      "Visit https://example.org",
      "Transfer to IE29 AIBK 9311 5212 3456 78",
      "Mail me at me@example.com",
      "www.example.net",
      "find me at evil.health",
      "store.gg has it cheaper",
    ]) {
      expect(hasContactOrPaymentDetails(note)).toBe(true);
      expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, note }).success).toBe(false);
    }
    expect(hasContactOrPaymentDetails("Thanks.See you soon, from Galway!")).toBe(false);
  });

  it("refuses markup-shaped values it has no enum for, and an empty text", () => {
    expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "grid" }).success).toBe(false);
    expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, headline: "" }).success).toBe(false);
    expect(checkoutPageSchema.safeParse({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, extra: 1 }).success).toBe(false);
  });

  it("resolves an absent member to the defaults, and stays absent while untouched", () => {
    expect(resolveCheckoutPage({})).toEqual(DEFAULT_CHECKOUT_PAGE_CONFIG);
    expect(isDefaultCheckoutPage({ ...DEFAULT_CHECKOUT_PAGE_CONFIG })).toBe(true);
    expect(isDefaultCheckoutPage({ ...DEFAULT_CHECKOUT_PAGE_CONFIG, note: "Hi" })).toBe(false);
  });

  it("survives a stored config whose other parts need the upgrade retry", () => {
    const stored = parseStoredStorefrontConfig({
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, background: "#ffffff" },
      blocks: [],
      checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact" },
    });
    expect(stored?.checkoutPage?.layout).toBe("compact");
  });
});

describe("where Buy now goes", () => {
  const ids = { storefrontId: "s", productId: "p" };

  it("follows the seller's own link first, then checkout, then an enquiry", () => {
    expect(resolveCtaTarget("https://shop.example.com/x", "a@b.co", "Vase", "Q", ids).kind).toBe("link");
    expect(resolveCtaTarget(null, "a@b.co", "Vase", "Q", ids).kind).toBe("checkout");
    expect(resolveCtaTarget(null, "a@b.co", "Vase", "Q", null).kind).toBe("mail");
    expect(resolveCtaTarget(null, undefined, "Vase", "Q", null).kind).toBe("none");
  });

  it("carries the chosen version and quantity to the checkout", () => {
    expect(checkoutPath("s", "p", { optionIds: [A, RED], quantity: 3 })).toBe(
      `/s/s/p/p/checkout?o=${A}%2C${RED}&q=3`,
    );
    expect(checkoutPath("s", "p", { optionIds: [], quantity: 1 })).toBe("/s/s/p/p/checkout");
  });
});

describe("the development test provider", () => {
  it("exists only under next dev, and only when switched on", () => {
    vi.stubEnv("CHECKOUT_TEST_PAYMENTS", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(testPaymentsEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(testPaymentsEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(testPaymentsEnabled()).toBe(true);
    vi.stubEnv("CHECKOUT_TEST_PAYMENTS", "");
    expect(testPaymentsEnabled()).toBe(false);
  });

  it("leaves a deployed build with no provider at all, whatever else is configured", () => {
    // Mail and the bot check both on: checkout still does not open, because
    // the only provider that exists here is the test one, and it is dev-only.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHECKOUT_TEST_PAYMENTS", "1");
    vi.stubEnv("TRANSACTIONAL_EMAIL_ENABLED", "true");
    expect(checkoutProviderFor("any-owner")).toBeNull();
  });
});
