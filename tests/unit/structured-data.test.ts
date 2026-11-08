import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  jsonLdText,
  storefrontNodeId,
  productStructuredData,
  storefrontStructuredData,
} from "@/lib/seo/structured-data";
import type { ProductPageData } from "@/types/product-page";
import type { StorefrontPageData } from "@/types/storefront-page";
import type { ProductReviews } from "@/types/review";

// Pure module: no server I/O, no React, no Supabase. No mocks needed.

const APP = "https://store.example";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  return () => vi.unstubAllEnvs();
});

// ── Helpers ─────────────────────────────────────────────────────────────

/** A builder's output as a crawler reads it: the serialized text, parsed. */
function read(data: object) {
  return JSON.parse(jsonLdText(data));
}

/** Minimal valid product page fixture for the structured-data builders. */
function makePage(overrides: {
  soldOut?: boolean;
  stockState?: "in_stock" | "low_stock" | "sold_out";
  saleEndsAt?: string | null;
  images?: Array<{ src: string; alt: string }>;
  bio?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
}): ProductPageData {
  const {
    soldOut = false,
    stockState,
    saleEndsAt,
    images = [{ src: "img.jpg", alt: "" }],
    bio,
    description = "A great product.",
    priceCents = 1999,
    currency = "EUR",
  } = overrides;

  return {
    productUrl: `${APP}/s/sf-id/p/prod-id`,
    storefront: {
      id: "sf-id",
      name: "My Shop",
      theme: {} as never,
      productPage: {} as never,
      shippingPolicy: {} as never,
      seller: { businessName: "My Shop Ltd", ...(bio ? { bio } : {}) },
      backgroundImageUrl: null,
      customFontUrl: null,
    },
    product: {
      id: "prod-id",
      title: "Test Product",
      description,
      priceCents,
      currency: currency as "EUR",
      sale: saleEndsAt !== undefined ? { regularPriceCents: 2500, priorPriceCents: null, percentOff: null, offerPercent: 20, endsAt: saleEndsAt } : null,
      purchaseUrl: null,
      shippingProfileId: null,
      images: images as never,
      optionGroups: [],
      details: {} as never,
      documents: [],
      isDigital: false,
      digitalFormat: null,
      stock: stockState && stockState !== "in_stock" ? { state: stockState, ...(stockState === "low_stock" ? { remaining: 2 } : {}) } as never : null,
      soldOut,
      maxQuantity: 10,
    },
  } as ProductPageData;
}

/** Minimal valid storefront page fixture. */
function makeStorefrontPage(opts: {
  headerBio?: string;
  showHeader?: boolean;
  blocks?: Array<{ type: string; productId?: string; x?: number; y?: number }>;
  products?: Array<{ id: string; title: string }>;
}): StorefrontPageData {
  const { headerBio, showHeader = true, blocks = [], products = [] } = opts;
  return {
    id: "sf-id",
    name: "My Shop",
    url: `${APP}/s/sf-id`,
    theme: {} as never,
    header: headerBio !== undefined ? { show: showHeader, name: "My Shop", bio: headerBio } : undefined,
    blocks: blocks as never,
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      price: 10,
      currency: "EUR",
      imageUrl: null,
      href: `${APP}/s/sf-id/p/${p.id}`,
    })),
    tileLook: {} as never,
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: { businessName: "My Shop Ltd" },
    allowIndexing: true,
  } as StorefrontPageData;
}

function reviewsWith(count: number, average: number): ProductReviews {
  return {
    summary: { count, average, breakdown: [0, 0, 0, 0, 0] },
    firstPage: { items: [], next: null } as never,
  };
}

// ── jsonLdText ───────────────────────────────────────────────────────────

describe("jsonLdText", () => {
  it("produces valid JSON for a simple object", () => {
    const result = jsonLdText({ foo: "bar" });
    expect(JSON.parse(result)).toEqual({ foo: "bar" });
  });

  it("escapes < so a closing script tag in a value cannot break out of the element", () => {
    // A title that contains </script> would otherwise end the JSON-LD block
    // and allow the remaining text to be parsed as HTML.
    const result = jsonLdText({ title: "</script><script>alert(1)</script>" });
    expect(result).not.toContain("</script>");
    // The escaped form is valid JSON that decodes back to the original.
    expect(JSON.parse(result).title).toBe("</script><script>alert(1)</script>");
    // The literal six characters < appear in the output.
    expect(result).toContain("\\u003c");
  });
});

// ── storefrontNodeId ─────────────────────────────────────────────────────

describe("storefrontNodeId", () => {
  it("appends the #store fragment to the storefront URL", () => {
    expect(storefrontNodeId("https://store.example/s/abc")).toBe(
      "https://store.example/s/abc#store",
    );
  });
});

// ── productStructuredData ────────────────────────────────────────────────

describe("productStructuredData", () => {
  it("gives InStock when the product is not sold out and has no stock badge", () => {
    const data = productStructuredData(makePage({ soldOut: false }), "My Shop Ltd", null);
    const offer = read(data)["offers"];
    expect(offer.availability).toBe("https://schema.org/InStock");
  });

  it("gives LimitedAvailability for a low-stock product", () => {
    const data = productStructuredData(makePage({ stockState: "low_stock" }), "My Shop Ltd", null);
    const offer = read(data)["offers"];
    expect(offer.availability).toBe("https://schema.org/LimitedAvailability");
  });

  it("gives OutOfStock when soldOut is true", () => {
    const data = productStructuredData(makePage({ soldOut: true }), "My Shop Ltd", null);
    const offer = read(data)["offers"];
    expect(offer.availability).toBe("https://schema.org/OutOfStock");
  });

  it("includes priceValidUntil when a sale has an end date", () => {
    const data = productStructuredData(
      makePage({ saleEndsAt: "2026-12-31T23:59:59Z" }),
      "My Shop Ltd",
      null,
    );
    const offer = read(data)["offers"];
    expect(offer.priceValidUntil).toBe("2026-12-31");
  });

  it("omits priceValidUntil when there is no sale end date", () => {
    const data = productStructuredData(makePage({ saleEndsAt: null }), "My Shop Ltd", null);
    const offer = read(data)["offers"];
    expect(offer.priceValidUntil).toBeUndefined();
  });

  it("omits priceValidUntil when there is no sale at all", () => {
    const data = productStructuredData(makePage({}), "My Shop Ltd", null);
    const offer = read(data)["offers"];
    expect(offer.priceValidUntil).toBeUndefined();
  });

  it("includes aggregateRating when reviews exist with a non-null average", () => {
    const data = productStructuredData(makePage({}), "My Shop Ltd", reviewsWith(42, 4.75));
    expect(read(data)["aggregateRating"]).toMatchObject({
      "@type": "AggregateRating",
      ratingValue: "4.75",
      reviewCount: 42,
    });
  });

  it("omits aggregateRating when reviews are null", () => {
    const data = productStructuredData(makePage({}), "My Shop Ltd", null);
    expect(read(data)["aggregateRating"]).toBeUndefined();
  });

  it("omits aggregateRating when count is zero", () => {
    const data = productStructuredData(makePage({}), "My Shop Ltd", reviewsWith(0, 4.5));
    expect(read(data)["aggregateRating"]).toBeUndefined();
  });

  it("carries the product page URL on both the Product node and the Offer", () => {
    const page = makePage({});
    const data = read(productStructuredData(page, "My Shop Ltd", null));
    expect(data["url"]).toBe(page.productUrl);
    expect(data["offers"]["url"]).toBe(page.productUrl);
    // Both are absolute URLs.
    expect(data["url"]).toMatch(/^https?:\/\//);
  });

  it("carries the storefront URL and @id on the seller node", () => {
    const page = makePage({});
    const data = read(productStructuredData(page, "My Shop Ltd", null));
    const seller = data["offers"]["seller"];
    const expectedSfUrl = `${APP}/s/sf-id`;
    expect(seller["url"]).toBe(expectedSfUrl);
    expect(seller["@id"]).toBe(storefrontNodeId(expectedSfUrl));
    expect(seller["@type"]).toBe("OnlineStore");
    // The seller @id on the product page equals the storefront node @id.
    expect(seller["@id"]).toBe(`${expectedSfUrl}#store`);
  });

  it("seller @id matches what storefrontStructuredData emits for the same storefront", () => {
    const productPage = makePage({});
    const sfPage = makeStorefrontPage({});
    const productData = read(productStructuredData(productPage, "My Shop Ltd", null));
    const sfData = read(storefrontStructuredData(sfPage, "My Shop Ltd"));
    const graph: Array<Record<string, unknown>> = sfData["@graph"];
    const storeNode = graph.find((n) => n["@type"] === "OnlineStore");
    expect(productData["offers"]["seller"]["@id"]).toBe(storeNode?.["@id"]);
  });

  it("uses the appUrl-based OG image path as the Product image", () => {
    const data = read(productStructuredData(makePage({ images: [{ src: "img.jpg", alt: "" }] as never }), "My Shop Ltd", null));
    expect(data["image"]).toBe(`${APP}/api/og/p/prod-id`);
    expect(data["image"]).toMatch(/^https?:\/\//);
  });

  it("omits image when the product has no images", () => {
    const data = read(productStructuredData(makePage({ images: [] }), "My Shop Ltd", null));
    expect(data["image"]).toBeUndefined();
  });

  it("gives the seller node no description, even with a bio (the storefront node owns it)", () => {
    const data = read(productStructuredData(makePage({ bio: "Hand-made in Dublin" }), "My Shop Ltd", null));
    expect(data["offers"]["seller"]["description"]).toBeUndefined();
  });
});

// ── storefrontStructuredData ─────────────────────────────────────────────

describe("storefrontStructuredData", () => {
  it("contains an OnlineStore node and an ItemList node in the @graph", () => {
    const page = makeStorefrontPage({});
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    expect(graph.some((n) => n["@type"] === "OnlineStore")).toBe(true);
    expect(graph.some((n) => n["@type"] === "ItemList")).toBe(true);
  });

  it("sets description on the OnlineStore only when the header bio is shown", () => {
    const withBio = makeStorefrontPage({ headerBio: "Fresh flowers daily", showHeader: true });
    const noBio = makeStorefrontPage({});
    const hiddenBio = makeStorefrontPage({ headerBio: "Hidden bio", showHeader: false });

    const graphWith = read(storefrontStructuredData(withBio, "Shop"))["@graph"] as Array<Record<string, unknown>>;
    const graphNo = read(storefrontStructuredData(noBio, "Shop"))["@graph"] as Array<Record<string, unknown>>;
    const graphHidden = read(storefrontStructuredData(hiddenBio, "Shop"))["@graph"] as Array<Record<string, unknown>>;

    const storeWith = graphWith.find((n) => n["@type"] === "OnlineStore")!;
    const storeNo = graphNo.find((n) => n["@type"] === "OnlineStore")!;
    const storeHidden = graphHidden.find((n) => n["@type"] === "OnlineStore")!;

    expect(storeWith["description"]).toBe("Fresh flowers daily");
    expect(storeNo["description"]).toBeUndefined();
    // show: false means the header is not rendered, so description is omitted.
    expect(storeHidden["description"]).toBeUndefined();
  });

  it("builds the ItemList in the order the blocks appear, not database order", () => {
    // The blocks list says B then A; the products array says A then B.
    // The list items must follow the blocks.
    const page = makeStorefrontPage({
      blocks: [
        { type: "product", productId: "prod-b" },
        { type: "product", productId: "prod-a" },
      ],
      products: [
        { id: "prod-a", title: "Product A" },
        { id: "prod-b", title: "Product B" },
      ],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items[0]["name"]).toBe("Product B");
    expect(items[1]["name"]).toBe("Product A");
    expect(items[0]["position"]).toBe(1);
    expect(items[1]["position"]).toBe(2);
  });

  it("lists the board in reading order, not the order blocks were added", () => {
    // Added first but drawn lower: the tile drawn top-right is read first.
    const page = makeStorefrontPage({
      blocks: [
        { type: "product", productId: "prod-low", x: 0, y: 2 },
        { type: "product", productId: "prod-top-right", x: 2, y: 0 },
        { type: "product", productId: "prod-top-left", x: 0, y: 0 },
      ],
      products: [
        { id: "prod-low", title: "Low" },
        { id: "prod-top-right", title: "Top right" },
        { id: "prod-top-left", title: "Top left" },
      ],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items.map((item) => item["name"])).toEqual(["Top left", "Top right", "Low"]);
    expect(items.map((item) => item["position"])).toEqual([1, 2, 3]);
  });

  it("skips a product block whose product is not in page.products", () => {
    const page = makeStorefrontPage({
      blocks: [
        { type: "product", productId: "prod-known" },
        { type: "product", productId: "prod-missing" },
      ],
      products: [{ id: "prod-known", title: "Known" }],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]["name"]).toBe("Known");
  });

  it("deduplicates a product that appears on two blocks", () => {
    const page = makeStorefrontPage({
      blocks: [
        { type: "product", productId: "prod-dup" },
        { type: "text" },
        { type: "product", productId: "prod-dup" },
      ],
      products: [{ id: "prod-dup", title: "Duplicate" }],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
  });

  it("skips non-product blocks (text, image, shape)", () => {
    const page = makeStorefrontPage({
      blocks: [
        { type: "text" },
        { type: "image" },
        { type: "product", productId: "prod-a" },
        { type: "shape" },
      ],
      products: [{ id: "prod-a", title: "Product A" }],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
  });

  it("produces absolute product page URLs in the ItemList", () => {
    const page = makeStorefrontPage({
      blocks: [{ type: "product", productId: "prod-a" }],
      products: [{ id: "prod-a", title: "Product A" }],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    const items = list["itemListElement"] as Array<Record<string, unknown>>;
    expect(items[0]["url"]).toMatch(/^https?:\/\//);
    expect(items[0]["url"]).toContain("/s/sf-id/p/prod-a");
  });

  it("sets numberOfItems to the count of listed items", () => {
    const page = makeStorefrontPage({
      blocks: [
        { type: "product", productId: "prod-a" },
        { type: "product", productId: "prod-b" },
      ],
      products: [
        { id: "prod-a", title: "A" },
        { id: "prod-b", title: "B" },
      ],
    });
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const list = graph.find((n) => n["@type"] === "ItemList") as Record<string, unknown>;
    expect(list["numberOfItems"]).toBe(2);
  });

  it("sets the OnlineStore @id to storefrontNodeId of the storefront URL", () => {
    const page = makeStorefrontPage({});
    const data = read(storefrontStructuredData(page, "My Shop"));
    const graph: Array<Record<string, unknown>> = data["@graph"];
    const store = graph.find((n) => n["@type"] === "OnlineStore") as Record<string, unknown>;
    expect(store["@id"]).toBe(`${APP}/s/sf-id#store`);
    expect(store["url"]).toBe(`${APP}/s/sf-id`);
  });
});
