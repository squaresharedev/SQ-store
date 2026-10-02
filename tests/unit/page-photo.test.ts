/**
 * The page photo: what the schema accepts as a stored photo, which keys a
 * stored config holds, and what a write releases. Ownership of a NEW key is
 * checked against storage (see the page-photo e2e spec), not here.
 */
import { describe, expect, it, vi } from "vitest";
import { checkoutPageSchema, productPageSchema } from "@/lib/validation/storefront";
import { storedPagePhotoKeys } from "@/lib/storefront/uploads";
import { pagePhotoStyle } from "@/components/product-page/product-page-maps";
import { DEFAULT_CHECKOUT_PAGE_CONFIG, DEFAULT_PRODUCT_PAGE_CONFIG } from "@/types/storefront";

vi.mock("@/lib/r2", () => ({}));

const KEY = "images/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa-page.webp";

describe("pagePhotoSchema", () => {
  for (const [name, schema, base] of [
    ["product page", productPageSchema, DEFAULT_PRODUCT_PAGE_CONFIG],
    ["checkout page", checkoutPageSchema, DEFAULT_CHECKOUT_PAGE_CONFIG],
  ] as const) {
    it(`takes an image object key on the ${name}`, () => {
      expect(schema.safeParse({ ...base, backgroundImage: { key: KEY } }).success).toBe(true);
    });

    it(`refuses a URL, a non-image key and extra fields on the ${name}`, () => {
      for (const backgroundImage of [
        { key: "https://evil.example/x.png" },
        { key: "documents/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000cc-a.pdf" },
        { key: KEY, url: "https://evil.example/x.png" },
        { key: "images/../../secret" },
      ]) {
        expect(schema.safeParse({ ...base, backgroundImage }).success, JSON.stringify(backgroundImage)).toBe(false);
      }
    });
  }
});

describe("storedPagePhotoKeys", () => {
  it("collects the product page's and the checkout's keys, and survives junk", () => {
    const other = "images/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-0000000000bb-other.webp";
    expect(
      storedPagePhotoKeys({ productPage: { backgroundImage: { key: KEY } }, checkoutPage: { backgroundImage: { key: other } } }),
    ).toEqual(new Set([KEY, other]));
    expect(storedPagePhotoKeys(null)).toEqual(new Set());
    expect(storedPagePhotoKeys({ productPage: { backgroundImage: { key: 7 } }, checkoutPage: 3 })).toEqual(new Set());
  });
});

describe("pagePhotoStyle", () => {
  it("lays a veil of the page colour over the photo, covering the page", () => {
    const style = pagePhotoStyle({ url: "https://cdn.example/a.webp", tint: "#102030" });
    expect(style.backgroundImage).toContain("rgba(16,32,48,");
    expect(style.backgroundImage).toContain("https://cdn.example/a.webp");
    expect(style.backgroundSize).toBe("cover");
  });
});
