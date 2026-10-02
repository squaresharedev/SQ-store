// Where plans and billing live, and how a link says where it came from. Pure
// strings: safe on the server and in the browser.

/** The plans page: every plan, what it costs and what it adds. */
export const PLANS_PATH = "/plans";

/** Settings › Plan & billing: the store's own plan, usage and invoices. */
export const BILLING_SETTINGS_PATH = "/settings/billing";

/** Stripe's billing webhook. Registered in the Stripe dashboard at this path. */
export const BILLING_WEBHOOK_PATH = "/api/billing/webhook";

/** The query parameter a link to the plans page names its entry point in. */
export const PLANS_SOURCE_PARAM = "from";

/** The query parameter Stripe Checkout returns with (`{CHECKOUT_SESSION_ID}`). */
export const CHECKOUT_SESSION_PARAM = "session_id";

/**
 * Every place the plans page can be reached from. A fixed list so the funnel
 * (lib/billing/funnel.ts, mirrored by a SQL CHECK) can say which entry points
 * convert, and so a URL cannot write arbitrary text into it.
 */
export const PRICING_SOURCES = [
  "sidebar",
  "profile_menu",
  "settings",
  "storefront_limit",
  "team_limit",
  "product_limit",
  "order_nudge",
  "analytics_nudge",
  "email",
  "notification",
  "checkout_cancel",
  "orders_export",
] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

/** The entry point a plan limit sends a seller from, per capped thing. */
export const LIMIT_SOURCE = {
  storefronts: "storefront_limit",
  teamSeats: "team_limit",
  products: "product_limit",
} as const satisfies Record<string, PricingSource>;

/** Narrow an untrusted value (a URL parameter) to a known source. */
export function parsePricingSource(value: unknown): PricingSource | null {
  return typeof value === "string" && (PRICING_SOURCES as readonly string[]).includes(value)
    ? (value as PricingSource)
    : null;
}

/** A link to the plans page that says where it was followed from. */
export function plansHref(source: PricingSource): string {
  return `${PLANS_PATH}?${PLANS_SOURCE_PARAM}=${source}`;
}
