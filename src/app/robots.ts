import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url";
import { PRODUCT_OG_IMAGE_PREFIX } from "@/lib/products/paths";
import { PUBLIC_PAGES_PREFIX } from "@/lib/storefront/product-page-url";
import { SITEMAP_PATH } from "@/lib/seo/paths";

/**
 * /robots.txt: what crawlers may walk. Everything is closed (the dashboard, the
 * API, auth flows add nothing to an index) except:
 *   PUBLIC_PAGES_PREFIX (/s/)
 *     The hosted storefront and product pages: the only buyer-facing surface.
 *   PRODUCT_OG_IMAGE_PREFIX (/api/og/p/)
 *     The share-card images. A product page's og:image and structured data
 *     point here, and a crawler that honours robots.txt would otherwise never
 *     fetch the picture, leaving it out of search results and social cards.
 *   SITEMAP_PATH (/sitemap.xml)
 *     The list of those pages, open so a crawler that honours the closed "/"
 *     may still read it.
 *
 * In production the Cloudflare zone prepends its own managed block above this
 * one (it turns away AI training crawlers such as GPTBot and ClaudeBot), so
 * the live file is longer than what this returns.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [PUBLIC_PAGES_PREFIX, PRODUCT_OG_IMAGE_PREFIX, SITEMAP_PATH],
      disallow: "/",
    },
    sitemap: appUrl(SITEMAP_PATH),
  };
}
