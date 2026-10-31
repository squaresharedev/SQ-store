import { z } from "zod";
import { READ, defineTool } from "@/lib/agent/tool";
import { getAnalyticsSnapshot } from "@/lib/analytics/queries";
import { getDashboardOrders } from "@/lib/dashboard/queries";

/** The analytics page's default window. */
const DEFAULT_WINDOW_DAYS = 30;

function daysBack(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const analyticsTools = [
  defineTool({
    name: "get_analytics",
    title: "Get analytics",
    description:
      "The whole analytics page as one object: revenue, sales, fees, buyers, channels, top products, weekdays, visits and the buyer funnel, for a period and the one before it. All money is integer cents. " +
      "In signals, a source marked as awaiting or not available is NOT MEASURED, which is not the same as zero: never tell a seller a figure is zero when it was never measured.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({
      from: z.iso.date().optional().describe("First day. Leave out with `to` for the last 30 days."),
      to: z.iso.date().optional().describe("Last day."),
      allTime: z.boolean().optional().describe("The whole history. Overrides from and to."),
    }),
    handler: async ({ from, to, allTime }) => {
      if (allTime) return getAnalyticsSnapshot({ from: null, to: null }, "all");
      if (from || to) return getAnalyticsSnapshot({ from: from ?? null, to: to ?? null }, "custom");
      return getAnalyticsSnapshot({ from: daysBack(DEFAULT_WINDOW_DAYS), to: null }, "30d");
    },
  }),

  defineTool({
    name: "get_dashboard_summary",
    title: "Get dashboard summary",
    description: "The overview in brief: the last 30 days against all time, trends, the latest orders, refunded and disputed counts. Revenue is per currency. `available: false` means the figures could not be read, not that they are zero.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => {
      const data = await getDashboardOrders();
      return {
        available: data.available,
        last30d: data.last30d,
        allTime: data.allTime,
        salesTrend: data.salesTrend.tone,
        aovTrend: data.aovTrend.tone,
        refundedCount: data.refundedCount,
        disputedCount: data.disputedCount,
        recentOrders: data.recentOrders.map((order) => ({
          id: order.id,
          productTitle: order.product_title,
          channel: order.channel,
          status: order.status,
          amountCents: order.amount_cents,
          currency: order.currency,
          createdAt: order.created_at,
        })),
      };
    },
  }),
];
