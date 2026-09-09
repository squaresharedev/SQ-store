import { describe, expect, it, vi } from "vitest";
import {
  parseStoredStorefrontConfig,
  productPageSchema,
  storefrontConfigSchema,
} from "@/lib/validation/storefront";
import {
  MANDATORY_PRODUCT_PAGE_SECTION_IDS,
  compactText,
  isDefaultProductPage,
  isEuSeller,
  normalizeSections,
  resolveProductPage,
} from "@/lib/storefront/product-page";
import { resolveCta } from "@/components/product-page/product-page-maps";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX,
  PRODUCT_PAGE_CTA_RADIUS_MAX,
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

  it("takes a page background colour, or none at all", () => {
    // Absent is the shipped state: the page follows the storefront's own
    // background, whatever kind that is.
    expect(DEFAULT_PRODUCT_PAGE_CONFIG).not.toHaveProperty("backgroundColor");
    expect(
      productPageSchema.safeParse({
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        backgroundColor: "#0b3d2e",
      }).success,
    ).toBe(true);
    // A COLOUR only: the storefront's structured three-kind background has no
    // place on a page that is read rather than looked at, so nothing that
    // could carry a gradient, a URL or an object key gets through.
    for (const bad of [
      "#fff",
      "white",
      "linear-gradient(90deg, #fff, #000)",
      "url(https://x/y.jpg)",
      { kind: "solid", color: "#ffffff" },
    ]) {
      expect(
        productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, backgroundColor: bad })
          .success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("bounds every part of the buy button, and lets all four stay absent", () => {
    // Absent is the shipped state: the button follows the storefront, and the
    // defaults must keep parsing without any of these keys.
    expect(productPageSchema.safeParse(DEFAULT_PRODUCT_PAGE_CONFIG).success).toBe(true);

    const styled = {
      ...DEFAULT_PRODUCT_PAGE_CONFIG,
      ctaColor: "#1d4ed8",
      ctaRadius: PRODUCT_PAGE_CTA_RADIUS_MAX,
      ctaBorderWidth: PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX,
      ctaBorderColor: "#ffffff",
    };
    expect(productPageSchema.safeParse(styled).success).toBe(true);

    // Colours are strict `#rrggbb` like every other colour in the config: no
    // shorthand, no named colours, and nothing that could carry CSS.
    for (const bad of ["#fff", "red", "rgb(0,0,0)", "#12345g", "url(x)"]) {
      expect(productPageSchema.safeParse({ ...styled, ctaColor: bad }).success, bad).toBe(false);
      expect(
        productPageSchema.safeParse({ ...styled, ctaBorderColor: bad }).success,
        bad,
      ).toBe(false);
    }

    // Numbers are bounded whole pixels: they go straight into a style
    // attribute, so a float or an out-of-range value is not a rounding
    // problem, it is the input being unbounded.
    for (const bad of [-1, PRODUCT_PAGE_CTA_RADIUS_MAX + 1, 4.5]) {
      expect(productPageSchema.safeParse({ ...styled, ctaRadius: bad }).success, `${bad}`).toBe(
        false,
      );
    }
    for (const bad of [-1, PRODUCT_PAGE_CTA_BORDER_WIDTH_MAX + 1, 1.5]) {
      expect(
        productPageSchema.safeParse({ ...styled, ctaBorderWidth: bad }).success,
        `${bad}`,
      ).toBe(false);
    }
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
    // Everything the stored list never named comes back hidden — except
    // `safety`, mandatory alongside `seller` (see the dedicated test below).
    expect(
      sections
        .filter((s) => s.id !== "seller" && s.id !== "description" && s.id !== "safety")
        .every((s) => s.show === false),
    ).toBe(true);
    expect(sections.find((s) => s.id === "safety")?.show).toBe(true);
  });

  // Safety and compliance and Seller are legal disclosures (GPSR, and the
  // trader identity distance-selling law requires), not a design choice a
  // storefront offers — so unlike every other section, they cannot come back
  // hidden, whatever a stored config says. This is the single choke point
  // every reader of a product page goes through, so it is the one place that
  // has to hold for the guarantee to be real.
  it("never hides safety or seller, whatever the stored config says", () => {
    expect(MANDATORY_PRODUCT_PAGE_SECTION_IDS).toEqual(
      expect.arrayContaining(["safety", "seller"]),
    );

    // Explicitly turned off.
    const explicitlyOff = normalizeSections([
      { id: "safety", show: false },
      { id: "seller", show: false },
    ]);
    expect(explicitlyOff.find((s) => s.id === "safety")?.show).toBe(true);
    expect(explicitlyOff.find((s) => s.id === "seller")?.show).toBe(true);

    // Never named at all, which every OTHER section comes back hidden for.
    const neverNamed = normalizeSections([{ id: "description", show: true }]);
    expect(neverNamed.find((s) => s.id === "safety")?.show).toBe(true);
    expect(neverNamed.find((s) => s.id === "seller")?.show).toBe(true);

    // No stored sections at all.
    expect(normalizeSections(undefined).find((s) => s.id === "safety")?.show).toBe(true);
    expect(normalizeSections(undefined).find((s) => s.id === "seller")?.show).toBe(true);
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

describe("resolveCta", () => {
  const theme = { accent: "#1d4ed8", cornerRadius: 8 };

  it("follows the storefront while the page says nothing", () => {
    expect(resolveCta(DEFAULT_PRODUCT_PAGE_CONFIG, theme)).toEqual({
      fill: "#1d4ed8",
      // Derived from the fill, never stored: a dark accent takes light words.
      text: "#ffffff",
      radius: 8,
      borderWidth: 0,
      // Resolved even with no border to draw, so the panel's inherit dot has
      // a colour to show before the seller turns one on.
      borderColor: "#ffffff",
    });
  });

  it("takes each stored value over the storefront's, one at a time", () => {
    const styled = resolveCta(
      {
        ctaColor: "#fef08a",
        ctaRadius: 0,
        ctaBorderWidth: 2,
        ctaBorderColor: "#171717",
      },
      theme,
    );
    // A pale fill flips the label's ink on its own; that is not a seller
    // decision and there is no field for it.
    expect(styled).toEqual({
      fill: "#fef08a",
      text: "#171717",
      radius: 0,
      borderWidth: 2,
      borderColor: "#171717",
    });

    // A chosen 0 is a real answer ("sharp"), not the absence of one: it must
    // not fall back to the storefront's roundness.
    expect(resolveCta({ ctaRadius: 0 }, theme).radius).toBe(0);
  });

  it("clamps an inherited roundness a button has no shape for, but keeps a chosen one", () => {
    // Tile roundness runs to 100 (a circle). A button inherits through
    // controlRadius, which tops out at 16.
    expect(resolveCta({}, { accent: "#171717", cornerRadius: 100 }).radius).toBe(16);
    // A number the seller chose is theirs, up to the slider's own ceiling —
    // that is what makes a pill reachable at all.
    expect(
      resolveCta({ ctaRadius: PRODUCT_PAGE_CTA_RADIUS_MAX }, theme).radius,
    ).toBe(PRODUCT_PAGE_CTA_RADIUS_MAX);
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
