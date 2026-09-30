import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  type CheckoutPageConfig,
  type StorefrontConfig,
} from "@/types/storefront";

// Pure helpers for the checkout's config. Client-safe (no server imports): the
// editor, the public checkout and the thank-you page all answer "what does an
// absent field mean" here, exactly as lib/storefront/product-page.ts does for
// the product page.

/** The effective checkout options for a config: stored values over the
 *  defaults. Absent member = the defaults verbatim. */
export function resolveCheckoutPage(
  config: Pick<StorefrontConfig, "checkoutPage">,
): CheckoutPageConfig {
  const stored = config.checkoutPage;
  if (!stored) return DEFAULT_CHECKOUT_PAGE_CONFIG;
  return { ...DEFAULT_CHECKOUT_PAGE_CONFIG, ...stored };
}

/** Whether a checkout equals the defaults field for field, so an untouched one
 *  stays absent from the saved jsonb (byte-identical to before it existed).
 *  Keys are compared in a fixed order: the editor adds and deletes optional
 *  keys, which would otherwise make an equal object stringify differently. */
export function isDefaultCheckoutPage(config: CheckoutPageConfig): boolean {
  return canonical(config) === canonical(DEFAULT_CHECKOUT_PAGE_CONFIG);
}

function canonical(config: CheckoutPageConfig): string {
  const record = config as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, record[key]]),
  );
}
