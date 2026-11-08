import { describe, expect, it } from "vitest";

/**
 * Tests for app/robots.ts (the /robots.txt metadata route).
 *
 * Verifies that the three allowed prefixes are present, the disallow rule
 * covers everything else, and the Sitemap directive carries the absolute URL.
 */

const { default: robots } = await import("@/app/robots");
const { PUBLIC_PAGES_PREFIX } = await import("@/lib/storefront/product-page-url");
const { PRODUCT_OG_IMAGE_PREFIX } = await import("@/lib/products/paths");
const { SITEMAP_PATH } = await import("@/lib/seo/paths");
const { appUrl } = await import("@/lib/app-url");

describe("robots()", () => {
  const result = robots();

  it("applies to every user agent", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules.every((r) => r.userAgent === "*")).toBe(true);
  });

  it("allows the hosted storefront and product pages prefix", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const allowed = rules.flatMap((r) => (Array.isArray(r.allow) ? r.allow : [r.allow]));
    expect(allowed).toContain(PUBLIC_PAGES_PREFIX);
  });

  it("allows the product og-image prefix so share cards can load their image", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const allowed = rules.flatMap((r) => (Array.isArray(r.allow) ? r.allow : [r.allow]));
    expect(allowed).toContain(PRODUCT_OG_IMAGE_PREFIX);
  });

  it("allows the sitemap path so crawlers can read it despite the disallow rule", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const allowed = rules.flatMap((r) => (Array.isArray(r.allow) ? r.allow : [r.allow]));
    expect(allowed).toContain(SITEMAP_PATH);
  });

  it("disallows everything else (/)", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallowed = rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : [r.disallow]));
    expect(disallowed).toContain("/");
  });

  it("includes the sitemap URL as an absolute URL", () => {
    expect(result.sitemap).toBe(appUrl(SITEMAP_PATH));
  });
});
