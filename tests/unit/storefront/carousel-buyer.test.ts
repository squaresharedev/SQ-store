// @vitest-environment node
/**
 * A CAROUSEL ON A BUYER'S SURFACES, through the real loaders and a fake
 * database that applies the filters it is sent: the storefront page hands a
 * carousel only the products a buyer may see (and drops one left with none),
 * a card's product carries a stock STATE and never a count, and a product
 * only a carousel shows has its own page and can be bought, while one that is
 * not on the board at all cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUSY } from "@/lib/public/busy";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG, type StorefrontConfig } from "@/types/storefront";
import { createFakeAdmin } from "../../setup/fake-admin";

vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.9" })) }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: new Proxy({}, { get: () => ({ max: 600, windowSeconds: 3600 }) }),
  clientKey: vi.fn(async () => "203.0.113.9"),
  rateLimitKey: vi.fn(async () => true),
}));
vi.mock("@/lib/checkout/availability", () => ({ checkoutAvailableFor: vi.fn(async () => true) }));

let fake = createFakeAdmin();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));

const { getPublicStorefrontPage } = await import("@/lib/storefront/storefront-page");
const { gatePurchasable, gatePurchasableLines } = await import("@/lib/products/purchasable");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MAIN = "5f000000-0000-4000-8000-000000000001";
const LIVE = "b0b00000-0000-4000-8000-000000000001";
const DRAFT = "b0b00000-0000-4000-8000-000000000002";
const TAKEN_DOWN = "b0b00000-0000-4000-8000-000000000003";
const THEIRS = "b0b00000-0000-4000-8000-000000000004";
const ELSEWHERE = "b0b00000-0000-4000-8000-000000000005";
const CAROUSEL = "c0000000-0000-4000-8000-000000000001";
const LONELY = "c0000000-0000-4000-8000-000000000002";
const BUTTON = "b7000000-0000-4000-8000-000000000001";

const PROFILE = {
  id: OWNER,
  tax_business_name: "Studio e.U.",
  tax_vat_id: "ATU12345678",
  tax_country: "AT",
  seller_address: "12 Market Street\nVienna\nAustria",
  seller_email: "hello@studio.at",
  seller_phone: "+43 1 234567",
  shipping_policy: null,
};

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  owner_id: OWNER,
  title: id,
  description: null,
  price_cents: 1200,
  currency: "EUR",
  image_key: null,
  gallery: [],
  option_groups: [],
  details: {},
  documents: [],
  purchase_url: null,
  shipping_profile_id: null,
  max_per_order: 5,
  add_on_ids: [],
  moderation_status: "ok",
  track_stock: true,
  stock_quantity: 2,
  low_stock_threshold: 5,
  status: "active",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

function seed(config: Partial<StorefrontConfig>) {
  fake = createFakeAdmin({
    storefronts: [
      {
        id: MAIN,
        name: "Main",
        owner_id: OWNER,
        moderation_status: "ok",
        config: {
          ...DEFAULT_STOREFRONT_CONFIG,
          // The theme's cards say "Low stock", so a card's product carries a
          // stock state: a state, never the count behind it.
          theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, rows: 12, showLowStock: true },
          productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: true },
          ...config,
        },
      },
    ],
    profiles: [PROFILE],
    products: [
      product(LIVE),
      product(DRAFT, { status: "draft" }),
      product(TAKEN_DOWN, { moderation_status: "removed" }),
      product(THEIRS, { owner_id: STRANGER }),
      product(ELSEWHERE),
    ],
    discounts: [],
    product_price_history: [],
    orders: [],
  });
}

const carousel = (id: string, productIds: string[], y = 0) => ({ type: "carousel", id, productIds, x: 0, y, w: 6, h: 2 });

async function load() {
  const result = await getPublicStorefrontPage(MAIN);
  if (!result || result === PAGE_BUSY) throw new Error(`no page: ${String(result)}`);
  return result.page;
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-11T09:00:00.000Z") }));
afterEach(() => vi.useRealTimers());

describe("a carousel on a buyer's storefront page", () => {
  it("hands the buyer only the products a buyer may see, in the carousel's order", async () => {
    seed({ blocks: [carousel(CAROUSEL, [DRAFT, LIVE, TAKEN_DOWN, THEIRS])] } as Partial<StorefrontConfig>);
    const page = await load();
    expect(page.blocks).toEqual([carousel(CAROUSEL, [LIVE])]);
    expect(page.products.map((tile) => tile.id)).toEqual([LIVE]);
  });

  it("draws nothing for a carousel left with no product a buyer may see", async () => {
    seed({
      blocks: [carousel(CAROUSEL, [LIVE]), carousel(LONELY, [DRAFT, THEIRS], 2)],
    } as Partial<StorefrontConfig>);
    const page = await load();
    expect(page.blocks.map((block) => (block.type === "carousel" ? block.id : block.type))).toEqual([CAROUSEL]);
  });

  it("gives a card a stock state, never a stock count", async () => {
    seed({ blocks: [carousel(CAROUSEL, [LIVE])] } as Partial<StorefrontConfig>);
    const page = await load();
    expect(page.products[0].stockState).toBe("low_stock");
    const payload = JSON.stringify(page);
    for (const field of ["stock_quantity", "stockQuantity", "low_stock_threshold", "track_stock"]) {
      expect(payload).not.toContain(field);
    }
  });

  it("drops a button that led to a carousel's product a buyer may not see", async () => {
    seed({
      blocks: [
        carousel(CAROUSEL, [LIVE, DRAFT]),
        { type: "button", id: BUTTON, label: "Go", link: { kind: "product", productId: DRAFT }, x: 0, y: 3, w: 2, h: 1 },
      ],
    } as Partial<StorefrontConfig>);
    const page = await load();
    expect(page.blocks.some((block) => block.type === "button")).toBe(false);
  });
});

describe("a product only a carousel shows", () => {
  const budget = { action: "product_page", budget: { max: 600, windowSeconds: 3600 } };

  it("has a page there and can be bought, with no tile's sold-out mark", async () => {
    seed({ blocks: [carousel(CAROUSEL, [LIVE])] } as Partial<StorefrontConfig>);
    const gate = await gatePurchasable(MAIN, LIVE, budget);
    expect(gate).not.toBeNull();
    expect(gate).not.toBe(PAGE_BUSY);
    expect(gate && gate !== PAGE_BUSY && gate.block).toBeNull();
  });

  it("is still refused when it is a draft, taken down or someone else's", async () => {
    seed({ blocks: [carousel(CAROUSEL, [DRAFT, TAKEN_DOWN, THEIRS])] } as Partial<StorefrontConfig>);
    for (const id of [DRAFT, TAKEN_DOWN, THEIRS]) expect(await gatePurchasable(MAIN, id, budget)).toBeNull();
  });

  it("is not for sale once it is off the board, and a product never on it never was", async () => {
    seed({ blocks: [carousel(CAROUSEL, [LIVE])] } as Partial<StorefrontConfig>);
    expect(await gatePurchasable(MAIN, ELSEWHERE, budget)).toBeNull();
    const lines = await gatePurchasableLines(MAIN, [LIVE, ELSEWHERE], budget);
    if (!lines || lines === PAGE_BUSY) throw new Error("no lines");
    expect([...lines.items.keys()]).toEqual([LIVE]);
  });
});
