// SERVER ONLY. Every page the sitemap lists (app/sitemap.ts): exactly the
// hosted storefront and product pages that render AND that their seller lets
// search engines index.
//
// THE PAGES' OWN GATE. The page loaders cannot be called from here (each one
// spends a visitor's rate limit and reads one storefront at a time), so this
// asks their predicates of a batch instead: openStorefront for the storefront
// half (lib/storefront/public-gate.ts), sellerMaySell for the seller, and the
// product page's product half (active, the storefront owner's, not taken
// down). A listed page that 404s sends crawlers to dead ends; a listed page
// the seller keeps out of search would ignore their switch.
//
// THREE READ ROUNDS, however large the catalogue: the indexable storefronts
// (paged, as PostgREST answers at most 1000 rows at a time), their sellers'
// identities, and their tiles' products (both in runs of ids, so a request's
// address stays well inside what a proxy will carry).
//
// LEFT OUT ON PURPOSE:
//   - tiles the board hides (a sold-out product on a board that hides sold-out
//     items): their pages still open, but the seller chose not to show them;
//   - products with a page only as another tile's add-on: the product pages
//     that offer them link to them, and finding them here would take a scan of
//     every listed product's add-ons.

import { isContentVisible } from "@/lib/moderation/removal";
import { TRADER_GATE_SELECT, sellerMaySell, type TraderGateRow } from "@/lib/settings/seller-identity";
import { productPageUrl, storefrontPageUrl } from "@/lib/storefront/product-page-url";
import { openStorefront } from "@/lib/storefront/public-gate";
import type { createAdminClient } from "@/lib/supabase/admin";
import { buyerVisibleBlocks } from "@/types/storefront";

/** One page the sitemap lists. `lastModified` is when its row last changed. */
export type SitemapPage = { url: string; lastModified?: string };

/** Storefronts asked for per read: PostgREST's default cap on one answer. A
 *  project can set that cap lower, so the walk advances by what each answer
 *  held and stops only at an empty one, never at a short one. */
const STOREFRONTS_PER_READ = 1000;

/** Owner or product ids asked for in one read, as TILE_PRODUCTS_PER_READ in
 *  lib/storefront/storefront-page.ts. */
const IDS_PER_READ = 100;

/** The sitemap protocol's limit for one file. Past it the list is cut and a
 *  warning logged: split it with generateSitemaps the day that happens. */
export const SITEMAP_MAX_URLS = 50_000;

type StorefrontRow = {
  id: string;
  owner_id: string;
  config: unknown;
  moderation_status: string | null;
  updated_at: string;
};

type ProductRow = {
  id: string;
  owner_id: string;
  moderation_status: string | null;
  updated_at: string;
};

/** A storefront that passed its half of the gate, with the products its board
 *  shows, in board order and each once. */
type OpenListing = { id: string; ownerId: string; updatedAt: string; productIds: string[] };

/** Ids in runs of IDS_PER_READ, each run one request. */
function inRuns(ids: readonly string[]): string[][] {
  const runs: string[][] = [];
  for (let start = 0; start < ids.length; start += IDS_PER_READ) {
    runs.push(ids.slice(start, start + IDS_PER_READ));
  }
  return runs;
}

/**
 * Every page that renders and may be indexed: storefronts by id, each followed
 * by its products in the order its board shows them. Null when a read failed,
 * so the caller can answer "not right now" instead of an empty list.
 */
export async function listIndexablePages(
  admin: ReturnType<typeof createAdminClient>,
): Promise<SitemapPage[] | null> {
  // 1. Storefronts whose product pages are on and open to search engines.
  const listings: OpenListing[] = [];
  for (let start = 0; ; ) {
    const { data, error } = await admin
      .from("storefronts")
      .select("id, owner_id, config, moderation_status, updated_at")
      // Narrows the read; openStorefront below decides. A config that never
      // stored the choice stays out of search by default, so skipping it here
      // agrees with the page.
      .filter("config->productPage->>allowIndexing", "eq", "true")
      .order("id")
      .range(start, start + STOREFRONTS_PER_READ - 1);
    if (error) {
      console.error("[sitemap] storefront read failed", error.message);
      return null;
    }
    const rows = (data ?? []) as StorefrontRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const open = openStorefront(row);
      if (!open?.productPage.allowIndexing) continue;
      const productIds = buyerVisibleBlocks(open.config).flatMap((block) =>
        block.type === "product" ? [block.productId] : [],
      );
      listings.push({
        id: row.id,
        ownerId: row.owner_id,
        updatedAt: row.updated_at,
        productIds: [...new Set(productIds)],
      });
    }
    start += rows.length;
  }
  if (listings.length === 0) return [];

  // 2. Their sellers, through the read side of the publish gate. A seller with
  //    no row is a seller who has disclosed nothing.
  const sellers = new Set<string>();
  for (const ids of inRuns([...new Set(listings.map((listing) => listing.ownerId))])) {
    const { data, error } = await admin.from("profiles").select(`id, ${TRADER_GATE_SELECT}`).in("id", ids);
    if (error) {
      console.error("[sitemap] seller identity read failed", error.message);
      return null;
    }
    for (const row of (data ?? []) as (TraderGateRow & { id: string })[]) {
      if (sellerMaySell(row)) sellers.add(row.id);
    }
  }
  const listed = listings.filter((listing) => sellers.has(listing.ownerId));

  // 3. Their tiles' products: active and not taken down. Whose they are is
  //    asked per storefront below, as the product page asks it.
  const products = new Map<string, ProductRow>();
  for (const ids of inRuns([...new Set(listed.flatMap((listing) => listing.productIds))])) {
    const { data, error } = await admin
      .from("products")
      .select("id, owner_id, moderation_status, updated_at")
      .in("id", ids)
      .eq("status", "active");
    if (error) {
      console.error("[sitemap] product read failed", error.message);
      return null;
    }
    for (const row of (data ?? []) as ProductRow[]) {
      if (isContentVisible(row.moderation_status)) products.set(row.id, row);
    }
  }

  const pages: SitemapPage[] = [];
  for (const listing of listed) {
    pages.push({ url: storefrontPageUrl(listing.id), lastModified: listing.updatedAt });
    for (const productId of listing.productIds) {
      const product = products.get(productId);
      if (!product || product.owner_id !== listing.ownerId) continue;
      pages.push({ url: productPageUrl(listing.id, productId), lastModified: product.updated_at });
    }
  }

  if (pages.length > SITEMAP_MAX_URLS) {
    console.warn(
      `[sitemap] ${pages.length - SITEMAP_MAX_URLS} pages left out: one sitemap file holds ${SITEMAP_MAX_URLS}, split it with generateSitemaps`,
    );
    return pages.slice(0, SITEMAP_MAX_URLS);
  }
  return pages;
}
