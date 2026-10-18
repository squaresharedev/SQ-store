import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUSY } from "@/lib/public/busy";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

// The public product read is the one place that decides what a buyer may see
// of a product. These tests pin the gate order and the exclusion list.

vi.mock("@/lib/r2", () => ({
  presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.9" })),
}));

const rateLimitKey = vi.fn(async () => true);
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productPage: { max: 600, windowSeconds: 3600 } },
  clientKey: vi.fn(async () => "203.0.113.9"),
  rateLimitKey: (...args: unknown[]) => rateLimitKey(...(args as [])),
}));

/** A tiny chainable stand-in for the admin client: records every filter and
 *  answers from `rows` by table, or with `errors[table]` when a read is
 *  meant to fail. */
type Row = Record<string, unknown> | null;
const state: {
  rows: Record<string, Row>;
  errors: Record<string, { message: string } | null>;
  filters: Record<string, [string, unknown][]>;
} = {
  rows: {},
  errors: {},
  filters: {},
};
function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      (state.filters[table] ??= []).push([column, value]);
      return chain;
    },
    maybeSingle: async () =>
      state.errors[table]
        ? { data: null, error: state.errors[table] }
        : { data: state.rows[table] ?? null, error: null },
  };
  return chain;
}
const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}));

// The discount reads have their own tests (discount-public); here they only
// decide what the page is told about a sale.
const readActiveSales = vi.fn(async (): Promise<unknown[] | null> => []);
const loadProductSale = vi.fn(async (_admin: unknown, input: { regularPriceCents: number }) => ({
  priceCents: input.regularPriceCents,
  sale: null as unknown,
}));
vi.mock("@/lib/discounts/public", () => ({
  readActiveSales: (...args: unknown[]) => readActiveSales(...(args as [])),
  loadProductSale: (...args: [unknown, { regularPriceCents: number }]) => loadProductSale(...args),
  // The real one: it is pure, and the page's countdown to a sale's end is part
  // of what these tests hold the loader to.
  msUntilSaleEnds: (
    pricing: Iterable<{ sale: { endsAt: string | null } | null }>,
    now: Date,
  ): number | null => {
    const ends = [...pricing].flatMap(({ sale }) => (sale?.endsAt ? [Date.parse(sale.endsAt)] : []));
    return ends.length === 0 ? null : Math.max(0, Math.min(...ends) - now.getTime());
  },
  findCodeFor: vi.fn(async () => null),
}));

const { buildProductPageProduct, getPublicProductPage } = await import("@/lib/products/public");

const STOREFRONT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPTION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GROUP_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const productRow = {
  id: PRODUCT_ID,
  title: "Oak lamp",
  description: "Warm light.\n\nHand finished.",
  price_cents: 12900,
  currency: "EUR",
  image_key: `images/${OWNER_ID}/${OWNER_ID.slice(0, 8)}-cccc-4ccc-8ccc-000000000001-cover.jpg`,
  digital_file_key: `files/${OWNER_ID}/${OWNER_ID.slice(0, 8)}-cccc-4ccc-8ccc-000000000002-manual.pdf`,
  gallery: [
    { key: `images/${OWNER_ID}/${OWNER_ID.slice(0, 8)}-cccc-4ccc-8ccc-000000000003-side.jpg`, alt: "Side", optionId: OPTION_ID },
    { key: `images/${OWNER_ID}/${OWNER_ID.slice(0, 8)}-cccc-4ccc-8ccc-000000000004-x.jpg`, alt: "", optionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
  ],
  option_groups: [
    {
      id: GROUP_ID,
      name: "Colour",
      display: "swatch",
      options: [{ id: OPTION_ID, name: "Natural", swatch: "#c8a165", available: true }],
    },
  ],
  details: { materials: "Oak" },
  documents: [
    {
      key: `files/${OWNER_ID}/${OWNER_ID.slice(0, 8)}-cccc-4ccc-8ccc-000000000005-cert.pdf`,
      label: "CE Certificate",
    },
  ],
  purchase_url: "https://shop.example.com/lamp",
  shipping_profile_id: null,
  created_at: "2026-01-01T00:00:00Z",
  track_stock: true,
  stock_quantity: 3,
  low_stock_threshold: 5,
  max_per_order: 4,
  // The gate's column. Visible by default here so the existing cases keep
  // testing what they were written to test; the removal cases override it.
  moderation_status: "ok",
  owner_id: OWNER_ID,
};

function storefrontRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: STOREFRONT_ID,
    name: "Studio",
    owner_id: OWNER_ID,
    config: {
      ...DEFAULT_STOREFRONT_CONFIG,
      blocks: [{ type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 2, h: 2, soldOut: false }],
      ...overrides,
    },
  };
}

/** A seller who has disclosed everything the publish gate asks for. Without
 *  all three the page is refused outright, so it is part of the baseline
 *  fixture rather than something individual tests opt into. */
const profileRow = {
  tax_business_name: "Studio Builderboy e.U.",
  tax_vat_id: "ATU12345678",
  tax_country: "AT",
  seller_address: "12 Market Street\nVienna\nAustria",
  seller_email: "hello@studio-builderboy.at",
  seller_phone: "+43 1 234567",
  shipping_policy: null,
};

beforeEach(() => {
  state.rows = {
    storefronts: storefrontRow(),
    products: productRow,
    profiles: profileRow,
  };
  state.errors = {};
  state.filters = {};
  from.mockClear();
  rateLimitKey.mockClear();
  rateLimitKey.mockResolvedValue(true);
  readActiveSales.mockClear();
  loadProductSale.mockClear();
});

describe("buildProductPageProduct", () => {
  it("never carries the digital file, an owner field, a raw key or a raw stock number", async () => {
    const product = await buildProductPageProduct(productRow, {});
    const json = JSON.stringify(product);
    // (Photo and document URLs are signed GETs whose path is the object key,
    // so the key's TEXT appears inside them by design — a document is
    // deliberately public. What must never appear is a bare key field, the
    // DOWNLOAD's own key, or the private columns.)
    for (const forbidden of [
      "digital_file_key",
      '"key"',
      "stock_quantity",
      "low_stock_threshold",
      "owner_id",
      "manual.pdf",
      productRow.digital_file_key,
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(product.images.every((image) => image.url.startsWith("https://"))).toBe(true);
    // Only the badge, and the count only because it is low.
    expect(product.stock).toEqual({ state: "low_stock", remaining: 3 });
  });

  it("signs public documents (the compliance certificate, not the paywalled download)", async () => {
    const product = await buildProductPageProduct(productRow, {});
    expect(product.documents).toEqual([
      {
        url: `https://cdn.test/${productRow.documents[0]!.key}`,
        label: "CE Certificate",
        format: "PDF",
      },
    ]);
  });

  it("puts the cover first, signs every photo and unties a photo whose option is gone", async () => {
    const product = await buildProductPageProduct(productRow, {});
    expect(product.images).toHaveLength(3);
    expect(product.images[0]).toEqual({ url: `https://cdn.test/${productRow.image_key}`, alt: "Oak lamp" });
    expect(product.images[1]?.optionId).toBe(OPTION_ID);
    expect(product.images[2]?.optionId).toBeUndefined();
    expect(product.images[2]?.alt).toBe("Oak lamp"); // empty alt falls back to the title
  });

  it("derives the download facts as a format only, and re-gates the purchase link", async () => {
    const product = await buildProductPageProduct(productRow, {});
    expect(product.isDigital).toBe(true);
    expect(product.digitalFormat).toBe("PDF");
    expect(product.purchaseUrl).toBe("https://shop.example.com/lamp");

    const tampered = await buildProductPageProduct(
      { ...productRow, purchase_url: "javascript:alert(1)", digital_file_key: null },
      { soldOutFlag: true },
    );
    expect(tampered.purchaseUrl).toBeNull();
    expect(tampered.isDigital).toBe(false);
    expect(tampered.soldOut).toBe(true);
  });
});

/** The page a test expects to exist, narrowed past both "no" and "not right now". */
async function loadedPage() {
  const result = await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID);
  if (!result || result === PAGE_BUSY) throw new Error(`expected a page, got ${String(result)}`);
  return result;
}

describe("getPublicProductPage gates", () => {
  it("refuses non-UUID ids before touching anything", async () => {
    expect(await getPublicProductPage("not-a-uuid", PRODUCT_ID)).toBeNull();
    expect(await getPublicProductPage(STOREFRONT_ID, "nope")).toBeNull();
    expect(rateLimitKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("spends the rate limit before the first read and stops when it is out", async () => {
    rateLimitKey.mockResolvedValueOnce(false);
    // "Not right now", never "not found": a throttled buyer is looking at a
    // product that exists, and the answer is the same for one that does not.
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBe(PAGE_BUSY);
    expect(from).not.toHaveBeenCalled();
  });

  it("answers 'not right now' rather than 'not found' when a read fails", async () => {
    state.errors.storefronts = { message: "connection reset" };
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBe(PAGE_BUSY);
    state.errors.storefronts = null;
    state.errors.products = { message: "connection reset" };
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBe(PAGE_BUSY);
  });

  it("answers null for a missing storefront, a switched-off page and a product not on the board", async () => {
    state.rows.storefronts = null;
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();

    state.rows.storefronts = storefrontRow({
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: false },
    });
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();

    state.rows.storefronts = storefrontRow({ blocks: [] });
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();
    // None of those reached the products table.
    expect(state.filters.products).toBeUndefined();
  });

  it("reads the product scoped to the owner and to active status, and keeps the owner off the page", async () => {
    const result = await loadedPage();
    expect(result).not.toBeNull();
    expect(state.filters.products).toEqual(
      expect.arrayContaining([
        ["id", PRODUCT_ID],
        ["owner_id", OWNER_ID],
        ["status", "active"],
      ]),
    );
    expect(result?.ownerId).toBe(OWNER_ID);
    const pageJson = JSON.stringify(result?.page);
    expect(pageJson).not.toContain('"ownerId"');
    expect(pageJson).not.toContain('"owner_id"');
    expect(pageJson).not.toContain('"embed"');
    expect(result?.page.productUrl).toContain(`/s/${STOREFRONT_ID}/p/${PRODUCT_ID}`);
    expect(result?.page.storefront.productPage).toEqual(DEFAULT_PRODUCT_PAGE_CONFIG);
  });

  it("prices the page from the store's running sale, and never hands the browser a discount id", async () => {
    const SALE_ID = "99999999-9999-4999-8999-999999999999";
    readActiveSales.mockResolvedValueOnce([
      { id: SALE_ID, value: { type: "percent", percentOff: 20 }, startsAt: "2026-01-01T00:00:00Z", endsAt: null },
    ]);
    loadProductSale.mockResolvedValueOnce({
      priceCents: 10320,
      sale: { regularPriceCents: 12900, priorPriceCents: 12900, percentOff: 20, offerPercent: 20, endsAt: null },
    });
    const result = await loadedPage();

    // The sale read is the gate's, scoped to this storefront's owner and this product.
    expect(readActiveSales).toHaveBeenCalledWith(expect.anything(), OWNER_ID, PRODUCT_ID, expect.any(Date));
    expect(loadProductSale).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerId: OWNER_ID, productId: PRODUCT_ID, regularPriceCents: 12900 }),
    );
    expect(result?.page.product.priceCents).toBe(10320);
    expect(result?.page.product.sale).toEqual({
      regularPriceCents: 12900,
      priorPriceCents: 12900,
      percentOff: 20,
      offerPercent: 20,
      endsAt: null,
    });
    expect(JSON.stringify(result?.page)).not.toContain(SALE_ID);
    // One rate-limit token for the whole page, sale included.
    expect(rateLimitKey).toHaveBeenCalledTimes(1);
    // No end, so nothing for the page to read again for.
    expect(result?.saleEndsInMs).toBeNull();
  });

  it("is 'not right now' when the store's sales cannot be read: the regular price is not a safe guess", async () => {
    // readActiveSales answers null for 'could not be read' (it has its own
    // tests). A page drawn at the listed price then would show, and the quote
    // behind it charge, more than the seller is advertising.
    readActiveSales.mockResolvedValueOnce(null);
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBe(PAGE_BUSY);
    expect(loadProductSale).not.toHaveBeenCalled();
  });

  it("still refuses plainly a product that is not for sale, whatever the sales read did", async () => {
    readActiveSales.mockResolvedValueOnce(null);
    state.rows.products = null;
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();
  });

  it("tells the page how long its sale price has left, so an open tab reads it again", async () => {
    const endsAt = new Date(Date.now() + 90_000).toISOString();
    readActiveSales.mockResolvedValueOnce([
      { id: "99999999-9999-4999-8999-999999999999", value: { type: "percent", percentOff: 20 }, startsAt: "2026-01-01T00:00:00Z", endsAt },
    ]);
    loadProductSale.mockResolvedValueOnce({
      priceCents: 10320,
      sale: { regularPriceCents: 12900, priorPriceCents: null, percentOff: null, offerPercent: 20, endsAt },
    });
    const result = await loadedPage();
    expect(result.saleEndsInMs).toBeGreaterThan(80_000);
    expect(result.saleEndsInMs).toBeLessThanOrEqual(90_000);
  });

  it("marks the page sold out from the tile's flag", async () => {
    state.rows.storefronts = storefrontRow({
      blocks: [{ type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 2, h: 2, soldOut: true }],
    });
    const result = await loadedPage();
    expect(result?.page.product.soldOut).toBe(true);
  });

  // THE PUBLISH GATE, on the read side. An `active` product on an enabled
  // page still does not sell if the seller has not said who they are: each of
  // the three required fields refuses the page on its own, and the answer is
  // the same null every other refusal here gives, so an incomplete seller's
  // catalogue is not enumerable.
  it.each([
    ["trader name", "tax_business_name"],
    ["address", "seller_address"],
    ["contact email", "seller_email"],
  ])("refuses the page when the seller has no %s", async (_label, column) => {
    state.rows.profiles = { ...profileRow, [column]: null };
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();
  });

  it("refuses the page when the seller identity cannot be read at all", async () => {
    // A profile row that is missing entirely (deleted account, replication
    // lag) is the same problem as one that was never filled in.
    state.rows.profiles = null;
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();
  });

  it("still serves the page when only the optional trader fields are blank", async () => {
    // Phone, VAT ID and country are shown when set and required by nothing:
    // a seller without a business line must still be able to sell.
    state.rows.profiles = {
      ...profileRow,
      seller_phone: null,
      tax_vat_id: null,
      tax_country: null,
    };
    const result = await loadedPage();
    expect(result).not.toBeNull();
    expect(result?.page.storefront.seller.phone).toBeUndefined();
  });
});
