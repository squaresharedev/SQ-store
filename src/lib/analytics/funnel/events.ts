// THE STOREFRONT FUNNEL'S VOCABULARY: what one data point is, and nothing more.
//
// A funnel event is one step a buyer took between seeing a seller's storefront
// and paying for something on it. Each is written to Workers Analytics Engine
// by the server code that knows it happened (record.ts), rolled into
// public.storefront_funnel_daily once a day (rollup.ts), and read from there by
// the analytics page. Analytics Engine keeps 90 days; the daily table is the
// record.
//
// NOT THE PLANS FUNNEL. lib/billing/funnel.ts (seller_funnel_events) is about a
// seller upgrading their own plan. This one is about a seller's buyers.
//
// A DATA POINT IS EXACTLY SIX FIELDS: seller, store, product, event, the host
// of the site it happened on, and a placement id. No visitor, no IP, no user
// agent, no address or path, no amount. A field added here is a field every
// buyer's visit starts carrying, so the schema is strict on purpose.
//
// THE EVENT LIST IS MIRRORED IN SQL: the CHECK on storefront_funnel_daily.event
// (supabase/migrations/20261012_storefront_funnel_daily.sql). Edit both
// together, or the rollup refuses the day it meets the new one.
//
// No server imports: the page, the rollup and the tests all read this.

import { z } from "zod";

/** Every step of the funnel, in the order a buyer takes them. */
export const FUNNEL_EVENTS = [
  /** A storefront was shown on a seller's site. */
  "embed_view",
  /** A product was opened from it. */
  "product_open",
  /** A product was put in a cart. Reserved: checkout is one product today. */
  "add_to_cart",
  /** A payment page was opened for an order (a Stripe Checkout Session). */
  "checkout_started",
  /** The payment arrived (Stripe's checkout.session.completed). */
  "order_paid",
  /** The payment page closed unpaid (Stripe's checkout.session.expired). */
  "checkout_expired",
] as const;

export const funnelEventSchema = z.enum(FUNNEL_EVENTS);
export type FunnelEvent = z.infer<typeof funnelEventSchema>;

/** A DNS name can be this long, and no longer. */
export const REFERRER_HOST_MAX = 253;
/** A placement id is a short label a seller's embed carries, never free text. */
export const PLACEMENT_ID_MAX = 64;

/**
 * A bare hostname: lowercase labels and dots. This is what keeps an address,
 * a path, a query or a port out of the data, whatever a caller passes: none
 * of them can be spelled with these characters. Empty means "not known".
 */
const referrerHostSchema = z
  .string()
  .max(REFERRER_HOST_MAX)
  .regex(/^$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/);

const placementIdSchema = z
  .string()
  .max(PLACEMENT_ID_MAX)
  .regex(/^[A-Za-z0-9_-]*$/);

/** One data point. Strict: an unknown key is refused, not dropped. */
export const funnelPointSchema = z.strictObject({
  sellerId: z.uuid(),
  storeId: z.uuid(),
  productId: z.uuid(),
  event: funnelEventSchema,
  referrerHost: referrerHostSchema.default(""),
  placementId: placementIdSchema.default(""),
});

export type FunnelPoint = z.infer<typeof funnelPointSchema>;
export type FunnelPointInput = z.input<typeof funnelPointSchema>;

/**
 * Below this many storefront views in the period, a rate is not shown: three
 * orders from twenty views is not "15 orders per 100 views", it is three
 * orders.
 */
export const FUNNEL_MIN_VIEWS = 50;

/**
 * `part` per `per` of `whole`, or null when there is nothing to divide by.
 * Full precision: rounding is the display's job.
 */
export function funnelRate(part: number, whole: number, per = 100): number | null {
  if (!(whole > 0)) return null;
  return (part / whole) * per;
}
