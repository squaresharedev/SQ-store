// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUSY } from "@/lib/public/busy";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

// The read behind the storefront embed's frame: the one place that decides
// whether a seller's board may be drawn on someone's website, and what of it
// leaves the server. These tests pin the gate, its order, and the exclusions.

vi.mock("@/lib/r2", () => ({
  presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.9" })),
}));

const rateLimitKey = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { embedFetch: { max: 600, windowSeconds: 3600 } },
  clientKey: vi.fn(async () => "203.0.113.9"),
  rateLimitKey: (...args: unknown[]) => rateLimitKey(...args),
}));

/** A chainable stand-in for the admin client: records every filter and answers
 *  from `rows` by table. A list read is awaited directly; a single one ends in
 *  maybeSingle. */
const state: {
  rows: Record<string, unknown>;
  /** Tables whose reads fail. */
  errors: Record<string, { message: string } | undefined>;
  filters: Record<string, [string, unknown][]>;
} = { rows: {}, errors: {}, filters: {} };
function builder(table: string) {
  const answer = () =>
    state.errors[table] ? { data: null, error: state.errors[table] } : { data: state.rows[table] ?? null, error: null };
  const note = (column: string, value: unknown) => {
    (state.filters[table] ??= []).push([column, value]);
    return chain;
  };
  const chain = {
    select: () => chain,
    eq: note,
    in: note,
    // What the discount reads add to a list read. Recorded like the rest; this
    // stand-in answers by table, and the filtering has its own tests
    // (discount-public, discount-price-agreement).
    is: note,
    lt: note,
    lte: note,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}
const from = vi.fn((table: string) => builder(table));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}));

const { getEmbedFrame } = await import("@/lib/storefront/embed-frame-loader");

const EMBED_KEY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STOREFRONT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SITE = "shop.example.com";

function storefrontRow(config: Record<string, unknown> = {}) {
  return {
    id: STOREFRONT_ID,
    name: "Studio",
    owner_id: OWNER_ID,
    moderation_status: "ok",
    config: {
      ...DEFAULT_STOREFRONT_CONFIG,
      blocks: [{ type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 2, h: 2, soldOut: false }],
      embed: { enabled: true, domains: [SITE] },
      ...config,
    },
  };
}

const productRow = {
  id: PRODUCT_ID,
  title: "Oak lamp",
  price_cents: 12900,
  currency: "EUR",
  image_key: `images/${OWNER_ID}/cover.jpg`,
  moderation_status: "ok",
};

/** A seller who has disclosed everything the publish gate asks for. */
const profileRow = {
  tax_business_name: "Studio Builderboy e.U.",
  tax_vat_id: "ATU12345678",
  tax_country: "AT",
  seller_address: "12 Market Street\nVienna\nAustria",
  seller_email: "hello@studio-builderboy.at",
  seller_phone: "+43 1 234567",
  shipping_policy: null,
};

const tablesRead = () => from.mock.calls.map(([table]) => table);

beforeEach(() => {
  state.rows = { storefronts: storefrontRow(), products: [productRow], profiles: profileRow };
  state.errors = {};
  state.filters = {};
  from.mockClear();
  rateLimitKey.mockClear();
  rateLimitKey.mockResolvedValue(true);
  vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "https://embed.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getEmbedFrame - what a listed site is given", () => {
  it("the board, with each tile leading to its hosted product page, marked as from the embed", async () => {
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    expect(result.page.products).toEqual([
      {
        id: PRODUCT_ID,
        title: "Oak lamp",
        price: 129,
        currency: "EUR",
        imageUrl: `https://cdn.test/${productRow.image_key}`,
        href: `https://app.test/s/${STOREFRONT_ID}/p/${PRODUCT_ID}?via=embed`,
      },
    ]);
  });

  it("finds the storefront by its embed key, never by its id", async () => {
    await getEmbedFrame(EMBED_KEY, SITE);
    expect(state.filters.storefronts).toEqual([["embed_key", EMBED_KEY]]);
  });

  it("never sends the owner, the embed settings, the key, or anything about stock", async () => {
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    // The page is handed to a client component, so all of it reaches a browser.
    const json = JSON.stringify(result.page);
    for (const forbidden of [OWNER_ID.slice(0, 8) + "-cccc", "owner_id", EMBED_KEY, '"embed"', '"domains"', "stock", "seller_email"]) {
      // The photo's signed URL carries its object key, which names the owner's
      // folder by design; nothing else may.
      expect(json.replace(productRow.image_key, ""), forbidden).not.toContain(forbidden);
    }
  });

  it("treats the site with and without www. as one", async () => {
    expect(await getEmbedFrame(EMBED_KEY, `www.${SITE}`)).not.toBeNull();
  });

  it("is served under a site builder's own frame for the site", async () => {
    // The sites arrive as the address spells them: nearest page first.
    expect(await getEmbedFrame(EMBED_KEY, `shop-example-com.filesusr.com/${SITE}`)).not.toBeNull();
    expect(await getEmbedFrame(EMBED_KEY, `1a2b-atari-embeds.googleusercontent.com/www.gstatic.com/${SITE}`)).not.toBeNull();
  });
});

describe("getEmbedFrame - a store with a sale on", () => {
  const SALE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const sale = {
    id: SALE_ID,
    kind: "automatic",
    code: null,
    share_channel: null,
    value_type: "percent",
    percent_off: 10,
    amount_off_cents: null,
    currency: null,
    applies_to: "all",
    product_ids: [],
    starts_at: "2026-01-01T00:00:00Z",
    ends_at: null,
    usage_limit: null,
    enabled: true,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("prices the tile at the sale price, with what the sale takes off for its chip, and nothing more", async () => {
    state.rows.discounts = [sale];
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    // 10% off 129.00, with the regular price to strike through beside it and
    // the sale's own 10% for the chip. Its id and terms stay on the server.
    expect(result.page.products).toEqual([
      {
        id: PRODUCT_ID,
        title: "Oak lamp",
        price: 116.1,
        regularPrice: 129,
        offerPercent: 10,
        currency: "EUR",
        imageUrl: `https://cdn.test/${productRow.image_key}`,
        href: `https://app.test/s/${STOREFRONT_ID}/p/${PRODUCT_ID}?via=embed`,
      },
    ]);
    expect(JSON.stringify(result.page)).not.toContain(SALE_ID);
    // Read for this seller, as a sale, and only among the ones not deleted.
    expect(state.filters.discounts).toEqual(
      expect.arrayContaining([
        ["owner_id", OWNER_ID],
        ["kind", "automatic"],
        ["archived_at", null],
      ]),
    );
  });

  it("gives the chip the same figure whatever the records of the 30 days before say", async () => {
    state.rows.discounts = [sale];
    state.rows.product_price_history = [
      { product_id: PRODUCT_ID, price_cents: 12900, currency: "EUR", valid_from: "2025-06-01T00:00:00Z" },
    ];
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    expect(result.page.products[0]).toMatchObject({ price: 116.1, regularPrice: 129, offerPercent: 10 });
    expect(result.page.products[0]).not.toHaveProperty("percentOff");
  });

  it("draws nothing rather than a board at prices it could not check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.errors.discounts = { message: "connection reset" };
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBe(PAGE_BUSY);
  });

  it("does not ask about sales for a board with no products on it", async () => {
    state.rows.storefronts = storefrontRow({ blocks: [] });
    await getEmbedFrame(EMBED_KEY, SITE);
    expect(tablesRead()).not.toContain("discounts");
  });
});

describe("getEmbedFrame - every refusal is the same nothing", () => {
  it("a site that is not on the list, alone or beside one that is", async () => {
    expect(await getEmbedFrame(EMBED_KEY, `${SITE}/evil.example.com`)).toBeNull();
    expect(await getEmbedFrame(EMBED_KEY, `www-evil-com.filesusr.com/${SITE}`)).toBeNull();
  });

  it("a site that is not on the list, before anything is read about the seller", async () => {
    expect(await getEmbedFrame(EMBED_KEY, "evil.example.com")).toBeNull();
    expect(tablesRead()).toEqual(["storefronts"]);
  });

  it("embedding switched off, or never set up", async () => {
    state.rows.storefronts = storefrontRow({ embed: { enabled: false, domains: [SITE] } });
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
    state.rows.storefronts = storefrontRow({ embed: undefined });
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
  });

  it("an empty list", async () => {
    state.rows.storefronts = storefrontRow({ embed: { enabled: true, domains: [] } });
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
  });

  it("a key that matches no storefront (a rotated one looks the same)", async () => {
    state.rows.storefronts = null;
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
  });

  it("a storefront staff have taken down", async () => {
    state.rows.storefronts = { ...storefrontRow(), moderation_status: "removed" };
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
    expect(tablesRead()).toEqual(["storefronts"]);
  });

  it("product pages switched off: tiles that lead nowhere are not a shop", async () => {
    state.rows.storefronts = storefrontRow({
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: false },
    });
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
  });

  it("a seller whose trader details are incomplete", async () => {
    state.rows.profiles = { ...profileRow, seller_address: null };
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
  });

  it("anything that is not a key or not a bare host, without spending a read", async () => {
    for (const [key, site] of [
      ["not-a-key", SITE],
      [EMBED_KEY, "EXAMPLE.com"],
      [EMBED_KEY, "https:"],
      [EMBED_KEY, "evil.com;script-src"],
      // A port is a development convenience; the header rule has none outside it.
      [EMBED_KEY, `${SITE}:8443`],
      // No header rule covers an empty segment or more sites than this.
      [EMBED_KEY, `${SITE}//${SITE}`],
      [EMBED_KEY, ["a", "b", "c", "d", SITE].join("/")],
      [EMBED_KEY, ""],
    ]) {
      expect(await getEmbedFrame(key, site), `${key} ${site}`).toBeNull();
    }
    expect(rateLimitKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("everything, while the embed has no host of its own", async () => {
    vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "");
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("getEmbedFrame - the visitor's budget", () => {
  it("is the embed's own, and is spent before the first read", async () => {
    rateLimitKey.mockResolvedValue(false);
    expect(await getEmbedFrame(EMBED_KEY, SITE)).toBe(PAGE_BUSY);
    expect(rateLimitKey).toHaveBeenCalledWith("203.0.113.9", "embed_fetch", { max: 600, windowSeconds: 3600 });
    expect(from).not.toHaveBeenCalled();
  });
});

describe("getEmbedFrame - products a buyer may not see", () => {
  it("drops the tile of a product staff have taken down", async () => {
    state.rows.products = [{ ...productRow, moderation_status: "removed" }];
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    expect(result.page.products).toEqual([]);
    expect(result.page.blocks).toEqual([]);
  });

  it("drops a sold-out tile the seller chose to hide, on the server", async () => {
    state.rows.storefronts = storefrontRow({
      theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, hideSoldOut: true },
      blocks: [{ type: "product", productId: PRODUCT_ID, x: 0, y: 0, w: 2, h: 2, soldOut: true }],
    });
    const result = await getEmbedFrame(EMBED_KEY, SITE);
    if (!result || result === PAGE_BUSY) throw new Error("expected a frame");
    expect(result.page.blocks).toEqual([]);
    expect(result.page.products).toEqual([]);
  });

  it("asks only for live products of this seller", async () => {
    await getEmbedFrame(EMBED_KEY, SITE);
    expect(state.filters.products).toEqual(
      expect.arrayContaining([
        ["owner_id", OWNER_ID],
        ["status", "active"],
      ]),
    );
  });
});
