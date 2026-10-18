import type { StorefrontPageData } from "@/types/storefront-page";

/**
 * The name a buyer knows the shop by: the trader's, else the header's own,
 * else the storefront's. The same order as the product page's
 * (lib/products/public.ts resolveDisplayName), so the tab title and the page
 * agree on whose shop this is.
 *
 * Its own client-safe module: the page's view (a client component) and its
 * server loader both ask, and the loader's module must never be pulled into a
 * browser bundle.
 */
export function storefrontDisplayName(page: Pick<StorefrontPageData, "seller" | "header" | "name">): string {
  if (page.seller.businessName) return page.seller.businessName;
  if (page.header?.show && page.header.name) return page.header.name;
  return page.name;
}
