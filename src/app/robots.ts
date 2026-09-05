import type { MetadataRoute } from "next";

/**
 * /robots.txt — tell crawlers that the only publicly indexable surface is the
 * hosted storefront and product pages under /s/. Everything else (the
 * dashboard, API routes, auth flows) is application infrastructure that adds
 * no value to a search index and should not be walked.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/s/",
      disallow: "/",
    },
  };
}
