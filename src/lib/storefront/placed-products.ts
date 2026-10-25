import type { StorefrontConfig } from "@/types/storefront";

/**
 * The ids of the products placed on these storefronts' boards, once each. What
 * a page that only DRAWS boards (the storefront list's previews) needs of the
 * catalogue, so it can hand the browser those products and not every one the
 * store sells. The editor does not use this: its picker can place any product.
 */
export function placedProductIds(storefronts: readonly { config: Pick<StorefrontConfig, "blocks"> }[]): Set<string> {
  const ids = new Set<string>();
  for (const { config } of storefronts) {
    for (const block of config.blocks) {
      if (block.type === "product") ids.add(block.productId);
    }
  }
  return ids;
}
