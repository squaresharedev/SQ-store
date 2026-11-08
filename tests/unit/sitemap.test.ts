import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for lib/seo/sitemap.ts (listIndexablePages) and app/sitemap.ts
 * (the metadata route).
 *
 * Uses chain mocks for @/lib/supabase/admin, the same style as
 * tests/unit/og-image-route.test.ts.
 */

// ---- module mocks (must come before any dynamic import) ---------------------

const rateLimitKey = vi.fn(async () => true);
const clientKey = vi.fn(async () => "127.0.0.1");

// --- DB state ----------------------------------------------------------------

type DbResult = { data: Record<string, unknown>[]; error: null | { message: string } };

/** Mutable per-test state. Reset in beforeEach. */
const st: {
  storefrontPages: DbResult[];
  profilesResult: DbResult;
  productsResult: DbResult;
  storefrontPageIndex: number;
} = {
  storefrontPages: [{ data: [], error: null }],
  profilesResult: { data: [], error: null },
  productsResult: { data: [], error: null },
  storefrontPageIndex: 0,
};

function resetSt() {
  st.storefrontPages = [{ data: [], error: null }];
  st.profilesResult = { data: [], error: null };
  st.productsResult = { data: [], error: null };
  st.storefrontPageIndex = 0;
}

function getStorefrontPage(): DbResult {
  const page = st.storefrontPages[st.storefrontPageIndex] ?? { data: [], error: null };
  st.storefrontPageIndex += 1;
  return page;
}

/** A simple chain mock. Terminal: range() for storefronts (paginated),
 *  then() for profiles and products (awaited after the last method). */
function chainFor(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "filter", "order", "in", "eq", "not"]) {
    chain[m] = () => chain;
  }
  chain["range"] = () => Promise.resolve(getStorefrontPage());
  // profiles and products are awaited with await chain (no range/maybeSingle):
  // that calls chain.then().
  chain["then"] = (resolve: (v: DbResult) => void, reject: (e: unknown) => void) => {
    const r = table === "profiles" ? st.profilesResult : st.productsResult;
    return Promise.resolve(r).then(resolve, reject);
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { sitemap: { max: 30, windowSeconds: 3600 } },
  clientKey,
  rateLimitKey: (...args: unknown[]) => rateLimitKey(...(args as [])),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

// emailSendingEnabled returns false in test environments (no SMTP config), so
// emailProofRequired() returns false and email verification is not required.
// This matches the behaviour of tests/unit/og-image-route.test.ts (which uses
// the same COMPLETE_PROFILE fixture without seller_email_verified_at).
vi.mock("@/lib/email/send", () => ({
  emailSendingEnabled: () => false,
  sendEmail: vi.fn(),
}));

// ---- fixtures ---------------------------------------------------------------

const SF_ID_1 = "11111111-1111-4111-8111-111111111111";
const SF_ID_2 = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRODUCT_ID_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** A storefront config stored as JSONB with allowIndexing=true and
 *  one visible product tile. Mirrors how other test files build configs
 *  (they spread DEFAULT_STOREFRONT_CONFIG with modifications).
 *
 *  productPage must include all required fields (imageFit, ctaLabel, sections,
 *  etc.) or parseStoredStorefrontConfig will strip it and resolveProductPage
 *  will fall back to the default, returning allowIndexing=false. */
function makeConfig(
  options: {
    allowIndexing?: boolean;
    enabled?: boolean;
    productIds?: string[];
    hideSoldOut?: boolean;
    soldOutIds?: string[];
  } = {},
): Record<string, unknown> {
  const {
    allowIndexing = true,
    enabled = true,
    productIds = [PRODUCT_ID_1],
    hideSoldOut = false,
    soldOutIds = [],
  } = options;
  return {
    theme: {
      background: { kind: "solid", color: "#ffffff" },
      accent: "#171717",
      font: "sans",
      columns: 6,
      rows: 6,
      cornerRadius: 0,
      titleStyle: "bar",
      titleDisplay: "always",
      priceDisplay: "always",
      priceTagPosition: "below",
      showTitle: true,
      gridGap: 8,
      soldOutBadge: true,
      hideSoldOut,
    },
    blocks: productIds.map((id, i) => ({
      type: "product",
      productId: id,
      x: i,
      y: 0,
      w: 1,
      h: 1,
      ...(soldOutIds.includes(id) ? { soldOut: true } : {}),
    })),
    // Spread the full default so the schema accepts it, then override the
    // two fields that change between test cases.
    productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled, allowIndexing },
  };
}

/** A storefront row that passes every gate (taken from the DB). */
function makeSf(
  id: string = SF_ID_1,
  config: Record<string, unknown> = makeConfig(),
  ownerId: string = OWNER_ID,
): Record<string, unknown> {
  return { id, owner_id: ownerId, config, moderation_status: "ok", updated_at: "2026-10-01T00:00:00Z" };
}

/** A complete seller profile that passes sellerMaySell. */
const COMPLETE_PROFILE = {
  id: OWNER_ID,
  tax_business_name: "Lamp Studio Ltd",
  tax_vat_id: null,
  tax_country: null,
  // Address must have street AND town; a street alone is refused by addressQualityProblem.
  seller_address: "12 Market Street\nDublin",
  seller_email: "hi@lamp-studio.ie",
  seller_phone: null,
  seller_phone_verified_at: null,
  seller_bio: null,
  seller_email_verified_at: null,
};

/** A product row that is active, visible and owned by OWNER_ID. */
function makeProduct(
  id: string = PRODUCT_ID_1,
  ownerId: string = OWNER_ID,
): Record<string, unknown> {
  return { id, owner_id: ownerId, moderation_status: "ok", updated_at: "2026-09-15T00:00:00Z" };
}

// ---- shared fixtures --------------------------------------------------------

const { DEFAULT_PRODUCT_PAGE_CONFIG } = await import("@/types/storefront");

// ---- import the modules under test ------------------------------------------

const { listIndexablePages } = await import("@/lib/seo/sitemap");
const { createAdminClient } = await import("@/lib/supabase/admin");

// ---- tests for listIndexablePages ------------------------------------------

describe("listIndexablePages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSt();
  });

  it("excludes a storefront with allowIndexing=false", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf(SF_ID_1, makeConfig({ allowIndexing: false }))], error: null }];
    // The SQL hint filters these but we want to confirm the JS predicate too;
    // the mock returns the row anyway so the JS path is exercised.
    const pages = await listIndexablePages(admin);
    expect(pages).toEqual([]);
  });

  it("excludes a storefront with product pages off (enabled=false)", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf(SF_ID_1, makeConfig({ enabled: false, allowIndexing: true }))], error: null }];
    const pages = await listIndexablePages(admin);
    expect(pages).toEqual([]);
  });

  it("excludes a storefront that has been taken down (moderation_status != ok)", async () => {
    const admin = createAdminClient();
    const taken = { ...makeSf(SF_ID_1), moderation_status: "removed" };
    st.storefrontPages = [{ data: [taken], error: null }];
    const pages = await listIndexablePages(admin);
    expect(pages).toEqual([]);
  });

  it("excludes a storefront with an unparseable config", async () => {
    const admin = createAdminClient();
    const bad = { id: SF_ID_1, owner_id: OWNER_ID, config: "not-json", moderation_status: "ok", updated_at: "2026-10-01T00:00:00Z" };
    st.storefrontPages = [{ data: [bad], error: null }];
    const pages = await listIndexablePages(admin);
    expect(pages).toEqual([]);
  });

  it("excludes a storefront whose seller identity is incomplete", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    // A profile with no business name does not pass sellerMaySell.
    st.profilesResult = {
      data: [{ ...COMPLETE_PROFILE, tax_business_name: null }],
      error: null,
    };
    st.productsResult = { data: [makeProduct()], error: null };
    const pages = await listIndexablePages(admin);
    expect(pages).toEqual([]);
  });

  it("lists a live tile product for a valid storefront", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [makeProduct()], error: null };
    const pages = await listIndexablePages(admin);
    expect(pages).not.toBeNull();
    const urls = (pages ?? []).map((p) => p.url);
    expect(urls.some((u) => u.includes(`/s/${SF_ID_1}`))).toBe(true);
    expect(urls.some((u) => u.includes(`/s/${SF_ID_1}/p/${PRODUCT_ID_1}`))).toBe(true);
  });

  it("excludes a product that has been taken down", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [{ ...makeProduct(), moderation_status: "removed" }], error: null };
    const pages = await listIndexablePages(admin);
    const urls = (pages ?? []).map((p) => p.url);
    expect(urls.some((u) => u.includes(`/p/${PRODUCT_ID_1}`))).toBe(false);
  });

  it("excludes a product belonging to a different owner", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    // Product row says owner is OWNER_ID_2, but the storefront belongs to OWNER_ID.
    st.productsResult = { data: [{ ...makeProduct(), owner_id: OWNER_ID_2 }], error: null };
    const pages = await listIndexablePages(admin);
    const urls = (pages ?? []).map((p) => p.url);
    expect(urls.some((u) => u.includes(`/p/${PRODUCT_ID_1}`))).toBe(false);
  });

  it("excludes a hidden sold-out tile (hideSoldOut=true + soldOut=true)", async () => {
    const admin = createAdminClient();
    // The storefront has two products: one normal, one marked soldOut by the tile.
    // With hideSoldOut=true the sold-out tile must be absent from the sitemap.
    const config = makeConfig({
      allowIndexing: true,
      productIds: [PRODUCT_ID_1, PRODUCT_ID_2],
      hideSoldOut: true,
      soldOutIds: [PRODUCT_ID_2],
    });
    st.storefrontPages = [{ data: [makeSf(SF_ID_1, config)], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [makeProduct(PRODUCT_ID_1), makeProduct(PRODUCT_ID_2)], error: null };
    const pages = await listIndexablePages(admin);
    const urls = (pages ?? []).map((p) => p.url);
    expect(urls.some((u) => u.includes(`/p/${PRODUCT_ID_1}`))).toBe(true);
    // Hidden sold-out tile is excluded.
    expect(urls.some((u) => u.includes(`/p/${PRODUCT_ID_2}`))).toBe(false);
  });

  it("paginates past one full page of storefronts before stopping", async () => {
    const admin = createAdminClient();
    // First page returns STOREFRONTS_PER_PAGE (1000) rows; second returns fewer.
    // We simulate this with one good storefront on the first page and one on the
    // second, which is fewer than 1000, signalling the end.
    const sf1 = makeSf(SF_ID_1);
    const sf2 = makeSf(SF_ID_2);
    // Build a first page of 1000 entries (the first real, the rest dummies that
    // parse and open fine but stay out because they do not allow indexing).
    const dummies = Array.from({ length: 999 }, (_, i) => ({
      id: `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, "0")}`,
      owner_id: OWNER_ID,
      config: makeConfig({ allowIndexing: false }),
      moderation_status: "ok",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    st.storefrontPages = [
      { data: [sf1, ...dummies], error: null }, // first page: 1000 rows
      { data: [sf2], error: null },              // second page: 1 row (less than 1000 -> stop)
    ];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [makeProduct(PRODUCT_ID_1)], error: null };
    const pages = await listIndexablePages(admin);
    const urls = (pages ?? []).map((p) => p.url);
    // Both real storefronts should appear.
    expect(urls.some((u) => u.includes(SF_ID_1))).toBe(true);
    expect(urls.some((u) => u.includes(SF_ID_2))).toBe(true);
    // Two pages with rows, then the empty answer that ends the walk.
    expect(st.storefrontPageIndex).toBe(3);
  });

  it("keeps paging when the server caps an answer below the page size", async () => {
    const admin = createAdminClient();
    // A project whose row cap is 2: every answer is "short", and only the
    // empty one means the end.
    const capped = (offset: number) =>
      Array.from({ length: 2 }, (_, i) => ({
        id: `eeeeeeee-eeee-4eee-8eee-${String(offset + i).padStart(12, "0")}`,
        owner_id: OWNER_ID,
        config: makeConfig({ allowIndexing: false }),
        moderation_status: "ok",
        updated_at: "2026-10-01T00:00:00Z",
      }));
    st.storefrontPages = [
      { data: capped(0), error: null },
      { data: capped(2), error: null },
      { data: [makeSf(SF_ID_2)], error: null },
    ];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [makeProduct(PRODUCT_ID_1)], error: null };
    const pages = await listIndexablePages(admin);
    expect((pages ?? []).some((page) => page.url.includes(SF_ID_2))).toBe(true);
    expect(st.storefrontPageIndex).toBe(4);
  });

  it("returns null when the storefronts read fails", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [], error: { message: "DB error" } }];
    const pages = await listIndexablePages(admin);
    expect(pages).toBeNull();
  });

  it("returns null when the profiles read fails", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [], error: { message: "DB error" } };
    const pages = await listIndexablePages(admin);
    expect(pages).toBeNull();
  });

  it("returns null when the products read fails", async () => {
    const admin = createAdminClient();
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [], error: { message: "DB error" } };
    const pages = await listIndexablePages(admin);
    expect(pages).toBeNull();
  });

  it(
    "truncates output at SITEMAP_MAX_URLS and warns",
    { timeout: 30_000 },
    async () => {
      const admin = createAdminClient();
      const { SITEMAP_MAX_URLS } = await import("@/lib/seo/sitemap");

      // Build SITEMAP_MAX_URLS + 1 storefronts (each with no product blocks,
      // so each contributes exactly 1 URL). That is one more than the cap,
      // which must trigger truncation and a warning.
      //
      // Spread across pages of 1000 (STOREFRONTS_PER_PAGE). The last page is
      // shorter than 1000, which is the signal to stop paginating.
      const STOREFRONTS_PER_PAGE = 1000;
      const totalSfs = SITEMAP_MAX_URLS + 1; // 50_001
      const sfPages: DbResult[] = [];
      // Build the config once and reuse it to avoid running the Zod schema
      // 50_001 times in the test setup (each parse is ~0.1ms; 50_001 is 5s).
      const sharedConfig = makeConfig({ allowIndexing: true, productIds: [] });
      for (let start = 0; start < totalSfs; start += STOREFRONTS_PER_PAGE) {
        const end = Math.min(start + STOREFRONTS_PER_PAGE, totalSfs);
        sfPages.push({
          data: Array.from({ length: end - start }, (_, i) => ({
            id: `ffffffff-ffff-4fff-8fff-${String(start + i).padStart(12, "0")}`,
            owner_id: OWNER_ID,
            config: sharedConfig,
            moderation_status: "ok",
            updated_at: "2026-10-01T00:00:00Z",
          })),
          error: null,
        });
      }
      st.storefrontPages = sfPages;
      st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
      st.productsResult = { data: [], error: null }; // no products

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pages = await listIndexablePages(admin);
      // Assert BEFORE restoring: mockRestore() clears the call history.
      expect(pages).not.toBeNull();
      expect((pages ?? []).length).toBe(SITEMAP_MAX_URLS);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("pages left out"));
      warnSpy.mockRestore();
    },
  );
});

// ---- tests for the sitemap metadata route -----------------------------------

describe("sitemap route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSt();
    rateLimitKey.mockResolvedValue(true);
    clientKey.mockResolvedValue("127.0.0.1");
  });

  it("throws when the rate limit is exhausted", async () => {
    rateLimitKey.mockResolvedValue(false);
    const { default: sitemapRoute } = await import("@/app/sitemap");
    await expect(sitemapRoute()).rejects.toThrow("[sitemap] rate limit spent");
  });

  it("throws when listIndexablePages returns null (read failed)", async () => {
    // Simulate a DB error on the storefronts page read.
    st.storefrontPages = [{ data: [], error: { message: "boom" } }];
    const { default: sitemapRoute } = await import("@/app/sitemap");
    await expect(sitemapRoute()).rejects.toThrow("[sitemap] read failed");
  });

  it("maps pages to MetadataRoute.Sitemap entries with url and lastModified", async () => {
    st.storefrontPages = [{ data: [makeSf()], error: null }];
    st.profilesResult = { data: [COMPLETE_PROFILE], error: null };
    st.productsResult = { data: [makeProduct()], error: null };
    const { default: sitemapRoute } = await import("@/app/sitemap");
    const entries = await sitemapRoute();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry.url).toBe("string");
      // changeFrequency and priority are intentionally absent (search engines
      // ignore them and they add no value here).
      expect("changeFrequency" in entry).toBe(false);
      expect("priority" in entry).toBe(false);
    }
  });
});
