import Link from "next/link";
import { Plus } from "lucide-react";
import { iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";
import {
  buildAttentionItems,
  type ProfileAttentionData,
  type StorefrontAttentionInfo,
} from "@/lib/dashboard/attention";
import { formatMoney } from "@/lib/dashboard/format";
import { MetricTile } from "./MetricTile";
import { MobileRevenueHero } from "./MobileRevenueHero";
import { NeedsAttention } from "./NeedsAttention";
import { OnboardingSlot } from "./OnboardingSlot";
import { RecentOrders } from "./RecentOrders";

const RECENT_ORDERS_ID = "recent-orders";

/** Composition only: lays the modules out; all data arrives as props. */
export function DashboardHome({
  orders,
  products,
  storefronts,
  profile,
  stripeConnected,
}: {
  orders: DashboardOrdersData;
  products: ProductsSummary;
  storefronts: StorefrontAttentionInfo;
  /** Null when the profile read failed softly; profile attention rows are hidden. */
  profile: ProfileAttentionData | null;
  stripeConnected: boolean;
}) {
  const { last30d } = orders;

  return (
    <div className="relative overflow-hidden">
      <BackgroundArrow side="right" />

      <div className="relative mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* On mobile the title + Add action live in the top bar (Sidebar) and
            revenue becomes the hero below, so this header is desktop-only. */}
        <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
          <div>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              Overview
            </h1>
          </div>
          <Link href="/products/new" className={primaryButtonClass}>
            <Plus
              className={`size-4 ${iconPopClass}`}
              strokeWidth={2}
              aria-hidden="true"
            />
            Add product
          </Link>
        </div>

        <MobileRevenueHero value={formatMoney(last30d.revenue)} />

        {/* On mobile everything below the hero rides a white sheet with a
            rounded top that overlaps the glow (same radius family as the
            Modal bottom sheet). From md up the wrapper is invisible. */}
        <div className="relative -mx-6 -mt-14 space-y-6 rounded-t-lg bg-background px-6 pt-6 md:mx-0 md:mt-0 md:rounded-none md:bg-transparent md:p-0">
        <OnboardingSlot />

        {/* Headline metrics: last 30 days only — all-time and per-channel/click trends live in Analytics. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Mobile shows revenue as the hero above instead of this cell. */}
          <div className="hidden md:block">
            <MetricTile
              label="Revenue · 30 days"
              value={formatMoney(last30d.revenue)}
              emphasis
            />
          </div>
          <MetricTile
            label="Sales · 30 days"
            value={last30d.sales > 0 ? String(last30d.sales) : null}
            trend={orders.salesTrend}
          />
          <MetricTile
            label="Avg order · 30 days"
            value={formatMoney(last30d.aov)}
            trend={orders.aovTrend}
          />
        </div>

        {/* Status modules. */}
        <div className="space-y-4">
          <NeedsAttention
            items={buildAttentionItems({
              orders,
              products,
              storefronts,
              profile,
              stripeConnected,
            })}
          />
          <RecentOrders orders={orders.recentOrders} id={RECENT_ORDERS_ID} />
        </div>
        </div>
      </div>
    </div>
  );
}
