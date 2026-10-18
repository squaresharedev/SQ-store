// SERVER ONLY. The one write path for storefront funnel events: a data point in
// Workers Analytics Engine (the FUNNEL_EVENTS binding in wrangler.jsonc).
//
// SERVER-PRODUCED ONLY. Each event is written by the code that knows it
// happened (the checkout that opened a payment page, the webhook Stripe
// called), never reported by a browser. There is no route a page can post to,
// so nothing has to run on a seller's site or be kept on a visitor's device.
//
// BEST EFFORT, ALWAYS. A counter is never allowed to fail the thing it counts:
// every failure here is logged and swallowed. writeDataPoint itself does not
// block and is not awaited.
//
// WHERE THERE IS NO BINDING (next dev, the test stack: Analytics Engine has no
// local stand-in) nothing is written and nothing is said. That is the normal
// state outside a deployed Worker, not a fault.

import {
  funnelPointSchema,
  type FunnelPointInput,
} from "@/lib/analytics/funnel/events";

/** The binding's name in wrangler.jsonc. */
export const FUNNEL_BINDING = "FUNNEL_EVENTS";

/**
 * The dataset behind it, as the rollup's SQL names it. The same string as
 * `dataset` under analytics_engine_datasets in wrangler.jsonc.
 */
export const FUNNEL_DATASET = "storefront_funnel";

/**
 * How a point is laid out in the dataset. The rollup reads these columns by
 * position (rollup.ts), so the order is a contract: add at the end, never
 * reorder. The seller is the INDEX, which is what Analytics Engine samples by:
 * one busy store can never thin out another's numbers.
 */
export const FUNNEL_BLOBS = ["event", "storeId", "productId", "referrerHost", "placementId"] as const;

type AnalyticsEngineDataset = {
  writeDataPoint: (point: { indexes: string[]; blobs: string[]; doubles: number[] }) => void;
};

async function funnelDataset(): Promise<AnalyticsEngineDataset | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const dataset = (env as Record<string, unknown>)[FUNNEL_BINDING] as AnalyticsEngineDataset | undefined;
    return typeof dataset?.writeDataPoint === "function" ? dataset : null;
  } catch {
    // No Worker around this code at all (a unit test, a script).
    return null;
  }
}

/**
 * Record one funnel event. Never throws, never rejects.
 *
 * "written" / "skipped" (no binding here) / "invalid" / "failed", for a caller
 * or a test that wants to know; most callers ignore it.
 */
export async function recordFunnelPoint(
  input: FunnelPointInput,
): Promise<"written" | "skipped" | "invalid" | "failed"> {
  const parsed = funnelPointSchema.safeParse(input);
  if (!parsed.success) {
    console.warn("[funnel] refused a malformed data point:", parsed.error.issues[0]?.path.join("."));
    return "invalid";
  }
  const point = parsed.data;
  try {
    const dataset = await funnelDataset();
    if (!dataset) return "skipped";
    dataset.writeDataPoint({
      indexes: [point.sellerId],
      blobs: FUNNEL_BLOBS.map((field) => point[field]),
      // Its weight. One point is one event.
      doubles: [1],
    });
    return "written";
  } catch (error) {
    console.warn(`[funnel] ${point.event} not recorded:`, error instanceof Error ? error.message : error);
    return "failed";
  }
}
