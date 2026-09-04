import { beforeEach, describe, expect, it, vi } from "vitest";
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
 *  answers from `rows` by table. */
type Row = Record<string, unknown> | null;
const state: { rows: Record<string, Row>; filters: Record<string, [string, unknown][]> } = {
  rows: {},
  filters: {},
};
function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      (state.filters[table] ??= []).push([column, value]);
      return chain;
    },
    maybeSingle: async () => ({ data: state.rows[table] ?? null, error: null }),
  };
  return chain;
}
const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
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
  track_stock: true,
  stock_quantity: 3,
  low_stock_threshold: 5,
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

beforeEach(() => {
  state.rows = { storefronts: storefrontRow(), products: productRow };
  state.filters = {};
  from.mockClear();
  rateLimitKey.mockClear();
  rateLimitKey.mockResolvedValue(true);
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

describe("getPublicProductPage gates", () => {
  it("refuses non-UUID ids before touching anything", async () => {
    expect(await getPublicProductPage("not-a-uuid", PRODUCT_ID)).toBeNull();
    expect(await getPublicProductPage(STOREFRONT_ID, "nope")).toBeNull();
    expect(rateLimitKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("spends the rate limit before the first read and stops when it is out", async () => {
    rateLimitKey.mockResolvedValueOnce(false);
    expect(await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID)).toBeNull();
    expect(from).not.toHaveBeenCalled();
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
    const result = await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID);
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

  it("marks the page sold out from the tile's flag", async () => {
    state.rows.storefronts = storefrontRow({
      blocks: [{ type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 2, h: 2, soldOut: true }],
    });
    const result = await getPublicProductPage(STOREFRONT_ID, PRODUCT_ID);
    expect(result?.page.product.soldOut).toBe(true);
  });
});
