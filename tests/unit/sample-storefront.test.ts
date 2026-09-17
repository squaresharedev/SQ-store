import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SAMPLE_PRODUCTS,
  SAMPLE_SELLER,
  SAMPLE_STOREFRONT_CONFIG,
  SAMPLE_STOREFRONT_NAME,
  SAMPLE_STOREFRONT_PATH,
  sampleObjectKey,
} from "@/lib/storefront/sample";
import { OBJECT_KEY_PATTERN } from "@/lib/validation/product";
import { storefrontConfigSchema, storefrontNameSchema } from "@/lib/validation/storefront";
import { isOnBoard } from "@/lib/geometry/rotated-box";

/**
 * The sample storefront is code, never a row, so nothing validates it on the way
 * in. These make sure it is still something a seller could really build: the
 * schema accepts it untouched, every tile points at one of its own products,
 * every picture exists, and its copy follows the house rules.
 */

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("sample storefront", () => {
  it("is a config the storefront schema accepts without changing a thing", () => {
    const parsed = storefrontConfigSchema.safeParse(SAMPLE_STOREFRONT_CONFIG);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.blocks).toHaveLength(SAMPLE_STOREFRONT_CONFIG.blocks.length);
    expect(parsed.data?.theme).toEqual(SAMPLE_STOREFRONT_CONFIG.theme);
    expect(parsed.data?.header).toEqual(SAMPLE_STOREFRONT_CONFIG.header);
    expect(storefrontNameSchema.safeParse(SAMPLE_STOREFRONT_NAME).success).toBe(true);
  });

  it("keeps every block on its board", () => {
    const { columns, rows } = SAMPLE_STOREFRONT_CONFIG.theme;
    for (const block of SAMPLE_STOREFRONT_CONFIG.blocks) {
      expect(isOnBoard(block, block.rotation ?? 0, columns, rows), JSON.stringify(block)).toBe(true);
    }
  });

  it("places each of its own products exactly once, and nothing else", () => {
    const placed = SAMPLE_STOREFRONT_CONFIG.blocks
      .filter((block) => block.type === "product")
      .map((block) => block.productId)
      .sort();
    expect(placed).toEqual(SAMPLE_PRODUCTS.map((product) => product.id).sort());
    expect(new Set(SAMPLE_PRODUCTS.map((product) => product.id)).size).toBe(SAMPLE_PRODUCTS.length);
  });

  it("draws every product from a static picture that exists", () => {
    for (const product of SAMPLE_PRODUCTS) {
      expect(product.imageUrl, product.title).toMatch(/^\/sample-storefront\/[a-z]+\.svg$/);
      expect(existsSync(join(process.cwd(), "public", product.imageUrl!)), product.title).toBe(true);
      expect(product.status).toBe("active");
    }
  });

  it("lives at a path no storefront id can take", () => {
    expect(SAMPLE_STOREFRONT_PATH).toBe("/storefront/sample");
    expect(existsSync(join(process.cwd(), "src/app/storefront/sample/page.tsx"))).toBe(true);
  });

  it("gives files added inside it keys shaped like real ones, under a nil uploader", () => {
    const file = new File(["x"], "My logo (final).svg", { type: "image/svg+xml" });
    for (const prefix of ["images", "fonts", "elements"] as const) {
      const key = sampleObjectKey(prefix, file);
      expect(key).toMatch(OBJECT_KEY_PATTERN);
      expect(key.startsWith(`${prefix}/00000000-0000-0000-0000-000000000000/`)).toBe(true);
    }
  });

  it("writes its copy without dashes standing in for punctuation", () => {
    const copy = [
      SAMPLE_STOREFRONT_NAME,
      SAMPLE_STOREFRONT_CONFIG.header?.name,
      SAMPLE_STOREFRONT_CONFIG.header?.bio,
      SAMPLE_SELLER.businessName,
      ...SAMPLE_PRODUCTS.flatMap((product) => [product.title, product.description]),
      ...SAMPLE_STOREFRONT_CONFIG.blocks.map((block) => (block.type === "text" ? block.text : "")),
    ].join(" ");
    expect(copy).not.toMatch(DASHES);
  });
});
