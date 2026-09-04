import { describe, expect, it } from "vitest";
import {
  parseStoredStorefrontConfig,
  policiesSchema,
  productPageSchema,
  sellerSchema,
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
      expect(parsed.data.policies).toBeUndefined();
      expect(parsed.data.seller).toBeUndefined();
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

  it("gates the seller's email and country, and refuses empty strings", () => {
    expect(sellerSchema.safeParse({ email: "" }).success).toBe(false);
    expect(sellerSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(sellerSchema.safeParse({ email: "shop@example.com", country: "IE" }).success).toBe(true);
    expect(sellerSchema.safeParse({ country: "US" }).success).toBe(false);
    expect(sellerSchema.safeParse({ country: "" }).success).toBe(true);
    expect(sellerSchema.safeParse({ website: "https://x.com" }).success).toBe(false);
  });

  it("caps policy text and refuses control characters", () => {
    expect(policiesSchema.safeParse({ shipping: "x".repeat(2001) }).success).toBe(false);
    expect(policiesSchema.safeParse({ returns: "line one\nline two" }).success).toBe(true);
    expect(policiesSchema.safeParse({ returns: "badbell" }).success).toBe(false);
  });

  it("carries the members through the upgrade retry only when they validate", () => {
    const config = parseStoredStorefrontConfig({
      theme: { background: "#ffffff" }, // legacy string background forces the retry
      blocks: [],
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      policies: { shipping: "Ships in 3 days." },
      seller: { email: "" }, // malformed: degrades to absent, never loses the config
    });
    expect(config).not.toBeNull();
    expect(config?.productPage).toEqual(DEFAULT_PRODUCT_PAGE_CONFIG);
    expect(config?.policies).toEqual({ shipping: "Ships in 3 days." });
    expect(config?.seller).toBeUndefined();
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
