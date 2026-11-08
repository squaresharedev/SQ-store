// SERVER ONLY. The storefront half of the gate in front of every public page
// of a seller, asked in one place: the hosted storefront page and the embed
// frame (lib/storefront/storefront-page.ts), the hosted product page and its
// checkout (lib/products/purchasable.ts), and the sitemap that lists them
// (lib/seo/sitemap.ts). A refusal added here is asked by all of them, which is
// the point: a sitemap that listed a page the page itself refuses would send
// crawlers to 404s, and one that missed a refusal would advertise a takedown.
//
// It asks nothing of the seller. Their trader identity is a read of its own
// (sellerMaySell in lib/settings/seller-identity.ts), made alongside the other
// owner-scoped reads each caller already does.

import { isContentVisible } from "@/lib/moderation/removal";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import type { ProductPageConfig, StorefrontConfig } from "@/types/storefront";

/** A storefront row, as far as the gate reads it. */
export type StorefrontGateRow = { config: unknown; moderation_status: string | null };

/** A storefront that passed: its parsed config and its product page options. */
export type OpenStorefront = { config: StorefrontConfig; productPage: ProductPageConfig };

/**
 * The storefront, when buyers may be shown it: not taken down, a config that
 * parses, and product pages switched on (that switch is the seller's "this
 * storefront has pages buyers can open", so a storefront has a page exactly
 * when its products do). Null for every refusal.
 */
export function openStorefront(row: StorefrontGateRow): OpenStorefront | null {
  if (!isContentVisible(row.moderation_status)) return null;
  const config = parseStoredStorefrontConfig(row.config);
  if (!config) return null;
  const productPage = resolveProductPage(config);
  if (!productPage.enabled) return null;
  return { config, productPage };
}
