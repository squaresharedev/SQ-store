import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { listIndexablePages } from "@/lib/seo/sitemap";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /sitemap.xml: every hosted storefront and product page that search engines
 * may index (lib/seo/sitemap.ts decides which), so a crawler can find a shop
 * that nothing on the web links to yet.
 *
 * DYNAMIC ON PURPOSE. Without force-dynamic Next prerenders a sitemap once, at
 * build time. Nothing would refresh it either: this deployment has no
 * incremental cache (open-next.config.ts), so the list is read per request,
 * behind its own rate limit.
 *
 * FAILURES THROW. A metadata route cannot choose its status, and a thrown
 * error is a 500, which a crawler reads as "come back later". Returning an
 * empty list instead would tell it the platform has no pages at all.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Spent before the first read, like the pages' own budgets. rateLimitKey
  // fails closed.
  const visitor = await clientKey(await headers());
  if (!(await rateLimitKey(visitor, "sitemap", RATE_LIMITS.sitemap))) {
    throw new Error("[sitemap] rate limit spent");
  }

  const pages = await listIndexablePages(createAdminClient());
  if (!pages) throw new Error("[sitemap] read failed");

  return pages.map((page) => ({
    url: page.url,
    ...(page.lastModified ? { lastModified: page.lastModified } : {}),
  }));
}
