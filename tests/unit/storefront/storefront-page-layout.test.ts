// @vitest-environment node
/**
 * THE LAYOUT HALF OF A BUYER'S PAYLOAD, through the real loader and a fake
 * database that applies the filters it is sent: bands and their photos come
 * along on purpose, every link arrives resolved, a link that leads nowhere a
 * buyer may go is dropped with what carried it, and a board without any of it
 * is handed exactly the members it always was.
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

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MAIN = "5f000000-0000-4000-8000-000000000001";
const OPEN = "5f000000-0000-4000-8000-000000000002";
const CLOSED = "5f000000-0000-4000-8000-000000000003";
const THEIRS = "5f000000-0000-4000-8000-000000000004";
const LIVE = "b0b00000-0000-4000-8000-000000000001";
const DRAFT = "b0b00000-0000-4000-8000-000000000002";
const BAND = "ba000000-0000-4000-8000-000000000001";
/** Upload keys as the schema shapes them: prefix, uploader, uuid-name. */
const PHOTO_KEY = `images/${OWNER}/c0000000-0000-4000-8000-000000000001-p.jpg`;
const LOGO_KEY = `elements/${OWNER}/c0000000-0000-4000-8000-000000000002-logo.svg`;
/** A button's id, a uuid like every block's. */
const id = (n: number) => `b7000000-0000-4000-8000-00000000000${n}`;

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

const product = (id: string, status: string) => ({
  id,
  owner_id: OWNER,
  title: id === LIVE ? "Live" : "Draft",
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
  moderation_status: "ok",
  track_stock: false,
  stock_quantity: null,
  low_stock_threshold: 5,
  status,
  created_at: "2026-01-01T00:00:00.000Z",
});

const pagesOn = { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: true };
const storefront = (id: string, owner: string, config: Partial<StorefrontConfig>, enabled = true) => ({
  id,
  name: id,
  owner_id: owner,
  moderation_status: "ok",
  config: {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, rows: 12 },
    productPage: enabled ? pagesOn : { ...pagesOn, enabled: false },
    ...config,
  },
});

const button = (id: string, link: object, y = 2) => ({ type: "button", id, label: id, link, x: 0, y, w: 2, h: 1 });

function seed(main: Partial<StorefrontConfig>) {
  fake = createFakeAdmin({
    storefronts: [
      storefront(MAIN, OWNER, main),
      storefront(OPEN, OWNER, {}),
      storefront(CLOSED, OWNER, {}, false),
      storefront(THEIRS, STRANGER, {}),
    ],
    profiles: [PROFILE],
    products: [product(LIVE, "active"), product(DRAFT, "draft")],
    discounts: [],
    product_price_history: [],
    orders: [],
  });
}

async function load() {
  const result = await getPublicStorefrontPage(MAIN);
  if (!result || result === PAGE_BUSY) throw new Error(`no page: ${String(result)}`);
  return result.page;
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-11T09:00:00.000Z") }));
afterEach(() => vi.useRealTimers());

describe("a buyer's payload, layout half", () => {
  it("is exactly what it was for a board with none of it", async () => {
    seed({ blocks: [{ type: "product", productId: LIVE, x: 0, y: 0, w: 2, h: 2 }] });
    const page = await load();
    for (const member of ["bands", "bandImageUrls", "links", "logoUrl"]) expect(member in page).toBe(false);
    expect(fake.state.reads.filter((table) => table === "storefronts")).toHaveLength(1);
  });

  it("carries the bands, and signs a band photo by its band", async () => {
    const bands = [
      { id: BAND, y: 0, h: 2, background: { kind: "image", key: PHOTO_KEY, x: 50, y: 50, scale: 100, dim: "dark" } },
    ];
    seed({ blocks: [{ type: "product", productId: LIVE, x: 0, y: 0, w: 2, h: 2 }], bands } as Partial<StorefrontConfig>);
    const page = await load();
    expect(page.bands).toEqual(bands);
    expect(page.bandImageUrls).toEqual({ [BAND]: `https://cdn.test/${PHOTO_KEY}` });
  });

  it("resolves every link, and drops a button or menu entry that leads nowhere a buyer may go", async () => {
    seed({
      bands: [{ id: BAND, y: 0, h: 1, background: { kind: "solid", color: "#000000" } }],
      blocks: [
        { type: "product", productId: LIVE, x: 0, y: 0, w: 2, h: 2 },
        { type: "product", productId: DRAFT, x: 2, y: 0, w: 2, h: 2 },
        button(id(1), { kind: "product", productId: LIVE }),
        button(id(2), { kind: "product", productId: DRAFT }, 3),
        button(id(3), { kind: "storefront", storefrontId: OPEN }, 4),
        button(id(4), { kind: "storefront", storefrontId: CLOSED }, 5),
        button(id(5), { kind: "storefront", storefrontId: THEIRS }, 6),
        button(id(6), { kind: "band", bandId: BAND }, 7),
        button(id(7), { kind: "url", url: "https://example.com/a" }, 8),
      ],
      header: {
        show: true,
        name: "Studio",
        bio: "",
        logo: { key: LOGO_KEY },
        links: [
          { label: "Draft", link: { kind: "product", productId: DRAFT } },
          { label: "Band", link: { kind: "band", bandId: BAND } },
        ],
      },
    } as Partial<StorefrontConfig>);
    const page = await load();
    const buttons = page.blocks.flatMap((block) => (block.type === "button" ? [block.id] : []));
    expect(buttons).toEqual([id(1), id(3), id(6), id(7)]);
    expect(page.links).toMatchObject({
      [`b_${id(1)}`]: { kind: "product", href: `/s/${MAIN}/p/${LIVE}` },
      [`b_${id(3)}`]: { kind: "storefront" },
      [`b_${id(6)}`]: { kind: "band", href: `#band-${BAND}` },
      [`b_${id(7)}`]: { kind: "url", href: "https://example.com/a" },
      "header-0": { kind: "band", href: `#band-${BAND}` },
    });
    expect(Object.keys(page.links ?? {})).toHaveLength(5);
    expect(page.links?.[`b_${id(3)}`].href.endsWith(`/s/${OPEN}`)).toBe(true);
    expect(page.header?.links).toEqual([{ label: "Band", link: { kind: "band", bandId: BAND } }]);
    expect(page.logoUrl).toBe(`https://cdn.test/${LOGO_KEY}`);
  });
});
