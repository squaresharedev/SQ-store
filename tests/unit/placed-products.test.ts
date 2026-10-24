// @vitest-environment node
import { describe, expect, it } from "vitest";
import { placedProductIds } from "@/lib/storefront/placed-products";
import type { StorefrontConfig } from "@/types/storefront";

/** Only what the helper reads of a config: its blocks. */
function board(...blocks: unknown[]): { config: Pick<StorefrontConfig, "blocks"> } {
  return { config: { blocks: blocks as StorefrontConfig["blocks"] } };
}

describe("placedProductIds", () => {
  it("collects each placed product once, across storefronts", () => {
    const ids = placedProductIds([
      board({ type: "product", productId: "a" }, { type: "product", productId: "b" }),
      board({ type: "product", productId: "a" }),
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("ignores blocks that are not products", () => {
    const ids = placedProductIds([board({ type: "text" }, { type: "image", key: "k" }, { type: "product", productId: "a" })]);
    expect([...ids]).toEqual(["a"]);
  });

  it("is empty for no storefronts or empty boards", () => {
    expect(placedProductIds([]).size).toBe(0);
    expect(placedProductIds([board()]).size).toBe(0);
  });
});
