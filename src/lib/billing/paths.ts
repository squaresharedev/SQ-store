// Where billing lives, and how a link opens the pricing modal. Pure strings:
// safe on the server and in the browser.

/** Settings › Plan & billing. */
export const BILLING_SETTINGS_PATH = "/settings/billing";

/** Stripe's billing webhook. Registered in the Stripe dashboard at this path. */
export const BILLING_WEBHOOK_PATH = "/api/billing/webhook";

/**
 * The query parameter that opens the pricing modal on arrival, carrying the
 * source it was opened from (`?plans=email`). For links that come from
 * OUTSIDE the page (an email, a notification, Stripe's cancel_url); anything
 * on the page opens the modal directly (usePricingModal().open) instead of
 * navigating, so a form with unsaved edits is never asked to discard them.
 */
export const PLANS_PARAM = "plans";

/** The query parameter Stripe Checkout returns with (`{CHECKOUT_SESSION_ID}`). */
export const CHECKOUT_SESSION_PARAM = "session_id";

/**
 * Every place the pricing modal can be opened from. A fixed list so the
 * funnel (lib/billing/funnel.ts, mirrored by a SQL CHECK) can say which entry
 * points convert, and so a URL cannot write arbitrary text into it.
 */
export const PRICING_SOURCES = [
  "sidebar",
  "profile_menu",
  "settings",
  "storefront_limit",
  "team_limit",
  "order_nudge",
  "analytics_nudge",
  "email",
  "notification",
  "checkout_cancel",
] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

/** Narrow an untrusted value (a URL parameter) to a known source. */
export function parsePricingSource(value: unknown): PricingSource | null {
  return typeof value === "string" && (PRICING_SOURCES as readonly string[]).includes(value)
    ? (value as PricingSource)
    : null;
}

/** A link that lands on Settings › Plan & billing with the modal open. */
export function pricingHref(source: PricingSource): string {
  return `${BILLING_SETTINGS_PATH}?${PLANS_PARAM}=${source}`;
}
