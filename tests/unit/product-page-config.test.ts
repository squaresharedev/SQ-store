import { describe, expect, it, vi } from "vitest";
import {
  parseStoredStorefrontConfig,
  productPageSchema,
  storefrontConfigSchema,
} from "@/lib/validation/storefront";
import {
  compactText,
  isDefaultProductPage,
  isEuSeller,
  normalizeSections,
  resolveProductPage,
} from "@/lib/storefront/product-page";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  PRODUCT_PAGE_SECTION_IDS,
  type ProductPageConfig,
} from "@/types/storefront";

// Mocks required for importing from lib/products/public (server-only module).
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productPage: {}, ogImage: {} },
  clientKey: vi.fn(),
  rateLimitKey: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});

const base = { theme: DEFAULT_STOREFRONT_CONFIG.theme, blocks: [] };

describe("product page config schema", () => {
  it("parses the defaults verbatim", () => {
    expect(productPageSchema.safeParse(DEFAULT_PRODUCT_PAGE_CONFIG).success).toBe(true);
  });

  it("is optional on the config, so stored configs keep parsing", () => {
    const parsed = storefrontConfigSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.productPage).toBeUndefined();
    }
  });

  it("strips every retired top-level member instead of rejecting the whole config", () => {
    // Trader identity AND the shipping/returns terms moved to the account
    // (lib/settings/seller-identity.ts, lib/settings/shipping-policy.ts), so
    // `seller`, `policies` and `shippingProfiles` are all retired. A config
    // still carrying them (a stale client, or a row saved before the move)
    // must still parse, with every OTHER member intact — the same promise
    // RETIRED_PRODUCT_PAGE_FIELDS makes one level down.
    const parsed = storefrontConfigSchema.safeParse({
      ...base,
      policies: { shipping: "Ships in 3 days." },
      shippingProfiles: [{ id: "x", name: "Bulky", body: "By pallet." }],
      seller: { businessName: "Old Co", email: "old@example.com" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("seller");
      expect(parsed.data).not.toHaveProperty("policies");
      expect(parsed.data).not.toHaveProperty("shippingProfiles");
      // The rest of the config survives, which is the whole point.
      expect(parsed.data.theme).toBeDefined();
    }
  });

  it("allows a shorter section list (forward/backward compatible), but never a duplicate or an overflow", () => {
    const sections = DEFAULT_PRODUCT_PAGE_CONFIG.sections;
    // A config saved before a section existed simply lacks it — this must
    // keep parsing, or growing PRODUCT_PAGE_SECTION_IDS again would silently
    // discard every stored product page the moment it happened.
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, sections: sections.slice(1) })
        .success,
    ).toBe(true);
    expect(productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, sections: [] }).success).toBe(
      true,
    );
    // More entries than sections exist, or the same section twice: rejected.
    expect(
      productPageSchema.safeParse({
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        sections: [...sections, { id: "seller", show: true }],
      }).success,
    ).toBe(false);
    expect(
      productPageSchema.safeParse({
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        sections: [...sections.slice(0, 5), { id: "description", show: false }],
      }).success,
    ).toBe(false);
  });

  it("strips retired fields instead of rejecting the config that carries them", () => {
    // A config saved while `surface` and `descriptionPlacement` still existed.
    // strictObject would reject the unknown keys, and the seller's whole
    // product page would silently revert to the coded defaults on the next
    // read. It must parse, and come back WITHOUT them.
    const stored = {
      ...DEFAULT_PRODUCT_PAGE_CONFIG,
      surface: "card",
      descriptionPlacement: "details",
    };
    const parsed = productPageSchema.safeParse(stored);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("surface");
      expect(parsed.data).not.toHaveProperty("descriptionPlacement");
      expect(parsed.data).toEqual(DEFAULT_PRODUCT_PAGE_CONFIG);
    }
    // Only the RETIRED names are forgiven; anything else is still refused.
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, surfice: "card" }).success,
    ).toBe(false);
  });

  it("inherits the storefront font unless the page names its own", () => {
    // Absent, not a sentinel value: "follows the storefront" is the ABSENCE of
    // a stored font, so an untouched page carries no font key at all.
    expect(DEFAULT_PRODUCT_PAGE_CONFIG.font).toBeUndefined();
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, font: "serif" }).success,
    ).toBe(true);
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, font: "comic-sans" }).success,
    ).toBe(false);
  });

  it("accepts the new documents section id", () => {
    expect(PRODUCT_PAGE_SECTION_IDS).toContain("documents");
    expect(
      productPageSchema.safeParse({
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        sections: [{ id: "documents", show: true }],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown keys, long labels, bad hex and unknown enums", () => {
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, extra: 1 }).success,
    ).toBe(false);
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "x".repeat(25) })
        .success,
    ).toBe(false);
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, imageFit: "squish" }).success,
    ).toBe(false);
    expect(
      productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "<b>Buy</b>" }).success,
    ).toBe(true); // plain text; rendered as a text node, never markup
  });

  // The seller's email/address/phone/VAT/country are no longer validated
  // here at all — that gate is taxSchema now (lib/validation/settings.ts),
  // covered in tests/unit/validation-settings-team-notifications.test.ts.

  // Policy text is bounded by shippingPolicySchema now (the terms are
  // account-level), so there is nothing for the storefront config schema to
  // check here any more.

  it("carries the members through the upgrade retry only when they validate", () => {
    const config = parseStoredStorefrontConfig({
      theme: { background: "#ffffff" }, // legacy string background forces the retry
      blocks: [],
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      policies: { shipping: "Ships in 3 days." },
      // A retired member, carried along with the legacy background: the
      // strip happens up front (before the blocks check even runs), so it
      // never reaches the retry path this test exercises at all.
      seller: { businessName: "Old Co" },
    });
    expect(config).not.toBeNull();
    expect(config?.productPage).toEqual(DEFAULT_PRODUCT_PAGE_CONFIG);
    expect(config).not.toHaveProperty("seller");
    expect(config).not.toHaveProperty("policies");
  });
});

describe("resolveProductPage", () => {
  it("answers the defaults for an absent member", () => {
    expect(resolveProductPage({})).toEqual(DEFAULT_PRODUCT_PAGE_CONFIG);
  });

  it("normalises sections: fixed order, unknowns dropped, duplicates keep the first", () => {
    const sections = normalizeSections([
      { id: "seller", show: true },
      { id: "seller", show: false }, // duplicate: the FIRST wins
      { id: "bogus" as never, show: true },
      { id: "description", show: true },
    ]);
    expect(sections.map((s) => s.id)).toEqual([...PRODUCT_PAGE_SECTION_IDS]);
    expect(sections.find((s) => s.id === "seller")).toEqual({ id: "seller", show: true });
    expect(sections.find((s) => s.id === "description")).toEqual({
      id: "description",
      show: true,
    });
    // Everything the stored list never named comes back hidden.
    expect(
      sections
        .filter((s) => s.id !== "seller" && s.id !== "description")
        .every((s) => s.show === false),
    ).toBe(true);
  });
});

describe("product page helpers", () => {
  it("ignores a stored order and always returns the fixed one", () => {
    // A config saved while the arrows still existed, with the seller's own
    // arrangement. The order is no longer read: only the show flags survive,
    // each landing back on its own section.
    const scrambled = normalizeSections([
      { id: "seller", show: true },
      { id: "specs", show: false },
      { id: "description", show: false },
    ]);
    expect(scrambled.map((s) => s.id)).toEqual([...PRODUCT_PAGE_SECTION_IDS]);
    expect(scrambled.find((s) => s.id === "seller")?.show).toBe(true);
    expect(scrambled.find((s) => s.id === "specs")?.show).toBe(false);
    expect(scrambled.find((s) => s.id === "description")?.show).toBe(false);
    // A section the stored list never named comes back hidden, not shown.
    expect(scrambled.find((s) => s.id === "documents")?.show).toBe(false);
  });

  it("compactText trims, drops empties and answers undefined for nothing", () => {
    expect(compactText({ a: "  x ", b: "   ", c: undefined })).toEqual({ a: "x" });
    expect(compactText({ a: "", b: "  " })).toBeUndefined();
  });

  it("isDefaultProductPage is true for the defaults and false after one change", () => {
    expect(isDefaultProductPage(DEFAULT_PRODUCT_PAGE_CONFIG)).toBe(true);
    const changed: ProductPageConfig = { ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "Order" };
    expect(isDefaultProductPage(changed)).toBe(false);
  });

  it("isEuSeller reads the country code only", () => {
    expect(isEuSeller({ country: "DE" })).toBe(true);
    expect(isEuSeller({ country: "" })).toBe(false);
    expect(isEuSeller(undefined)).toBe(false);
  });
});

// BUY-05: the store name a buyer sees in metadata must match what the page
// prints as the store's identity. resolveDisplayName establishes the precedence
// that both generateMetadata and SellerBlock agree on.
describe("resolveDisplayName (metadata name precedence)", () => {
  // Build a minimal ProductPageData — only the storefront.seller,
  // storefront.header and storefront.name fields matter for this function.
  function page(parts: {
    name: string;
    seller?: { businessName?: string };
    header?: { show: boolean; name: string };
  }): import("@/types/product-page").ProductPageData {
    return {
      storefront: {
        id: "x",
        name: parts.name,
        seller: parts.seller ?? {},
        ...(parts.header
          ? { header: { ...parts.header, bio: "" } }
          : {}),
        theme: DEFAULT_STOREFRONT_CONFIG.theme,
        productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
        shippingPolicy: {},
        backgroundImageUrl: null,
        customFontUrl: null,
      },
      // product is not read by resolveDisplayName; an empty cast satisfies TS.
      product: {} as import("@/types/product-page").ProductPageData["product"],
      productUrl: "",
    };
  }

  it("prefers the legal business name over everything else", async () => {
    const { resolveDisplayName } = await import("@/lib/products/public");
    expect(
      resolveDisplayName(
        page({
          name: "Studio",
          seller: { businessName: "Root Labs Studio" },
          header: { show: true, name: "The Shop" },
        }),
      ),
    ).toBe("Root Labs Studio");
  });

  it("falls back to the buyer-facing header name when there is no business name", async () => {
    const { resolveDisplayName } = await import("@/lib/products/public");
    expect(
      resolveDisplayName(
        page({
          name: "internal-row-name",
          seller: {},
          header: { show: true, name: "Buyer-Facing Name" },
        }),
      ),
    ).toBe("Buyer-Facing Name");
  });

  it("ignores a header that is not shown, falling through to the row name", async () => {
    const { resolveDisplayName } = await import("@/lib/products/public");
    expect(
      resolveDisplayName(
        page({
          name: "Row Name",
          seller: {},
          header: { show: false, name: "Hidden Header" },
        }),
      ),
    ).toBe("Row Name");
  });

  it("uses the row name when there is no business name and no header at all", async () => {
    const { resolveDisplayName } = await import("@/lib/products/public");
    expect(
      resolveDisplayName(
        page({
          name: "Studio",
          seller: {},
        }),
      ),
    ).toBe("Studio");
  });
});
