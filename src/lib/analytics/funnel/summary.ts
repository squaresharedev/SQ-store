// THE FUNNEL AS THE ANALYTICS PAGE SHOWS IT: five counts, and the two rates
// worked out from them. Pure, so the page, the snapshot and the tests agree.
//
// WHERE EACH COUNT COMES FROM. The page already measures the top of the
// funnel and the sale, so those are read from where they live rather than
// counted a second time:
//
//   embedViews        storefront_view signals filed under the embed
//   productOpens      product_click signals filed under the embed
//   embedOrders       paid orders filed under the embed (orders.channel)
//   checkoutsStarted  storefront_funnel_daily, event checkout_started
//   checkoutsExpired  storefront_funnel_daily, event checkout_expired
//
// The first three are about the EMBED. The two checkout counts are every
// checkout of the store's, whatever brought the buyer: a data point carries no
// channel (see events.ts). So abandonment is the store's, and orders per 100
// views is the embed's, and each tile says which.

import { FUNNEL_MIN_VIEWS, funnelRate } from "@/lib/analytics/funnel/events";
import type { AnalyticsData, FunnelData, SignalsData } from "@/lib/analytics/types";

/** The two daily-table counts for a range, or null when they could not be read. */
export type FunnelCheckoutCounts = { started: number; expired: number };

const EMBED = "embed";

/** Put the funnel together from the page's three reads. */
export function buildFunnel(
  sales: AnalyticsData,
  signals: SignalsData,
  checkouts: FunnelCheckoutCounts | null,
): FunnelData {
  const embedCount = (kind: "storefront_view" | "product_click") =>
    signals.byKind[kind].channels.find((slice) => slice.channel === EMBED)?.count ?? 0;
  return {
    checkoutsAvailable: checkouts !== null,
    embedViews: embedCount("storefront_view"),
    productOpens: embedCount("product_click"),
    embedOrders: sales.channels.find((slice) => slice.channel === EMBED)?.sales ?? 0,
    checkoutsStarted: checkouts?.started ?? 0,
    checkoutsExpired: checkouts?.expired ?? 0,
  };
}

/** Whether the range holds enough views for a rate to mean anything. */
export function funnelHasEnoughData(funnel: FunnelData): boolean {
  return funnel.embedViews >= FUNNEL_MIN_VIEWS;
}

/** Whether there is anything of the funnel to show a seller at all. */
export function funnelHasActivity(funnel: FunnelData): boolean {
  return (
    funnel.embedViews > 0 ||
    funnel.productOpens > 0 ||
    funnel.checkoutsStarted > 0 ||
    funnel.checkoutsExpired > 0
  );
}

/**
 * Paid orders per 100 storefront views. Null below FUNNEL_MIN_VIEWS: the
 * counts are shown instead, and no rate is.
 */
export function ordersPer100Views(funnel: FunnelData): number | null {
  if (!funnelHasEnoughData(funnel)) return null;
  return funnelRate(funnel.embedOrders, funnel.embedViews);
}

/**
 * Checkouts left unpaid, as a percentage of checkouts started. Null below
 * FUNNEL_MIN_VIEWS, when no checkout was started, or when the counts could
 * not be read.
 */
export function checkoutAbandonment(funnel: FunnelData): number | null {
  if (!funnel.checkoutsAvailable || !funnelHasEnoughData(funnel)) return null;
  return funnelRate(funnel.checkoutsExpired, funnel.checkoutsStarted);
}
