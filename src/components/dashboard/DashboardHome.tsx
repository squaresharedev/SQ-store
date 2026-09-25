import Link from "next/link";
import { Plus } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
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
import { OnboardingSlot, type OnboardingData } from "./OnboardingSlot";
import { RecentOrders } from "./RecentOrders";

const RECENT_ORDERS_ID = "recent-orders";

/** Composition only: lays the modules out; all data arrives as props. */
export function DashboardHome({
  orders,
  products,
  storefronts,
  profile,
  stripeConnected,
  onboarding,
  twoFactorEnabled = true,
}: {
  orders: DashboardOrdersData;
  products: ProductsSummary;
  storefronts: StorefrontAttentionInfo;
  /** Null when the profile read failed softly; profile attention rows are hidden. */
  profile: ProfileAttentionData | null;
  stripeConnected: boolean;
  /** The setup checklist and welcome flow's data; null renders neither. */
  onboarding: OnboardingData | null;
  /** Whether the signed-in person has 2FA on; off adds the nudge row. */
  twoFactorEnabled?: boolean;
}) {
  const t = useTranslations("Dashboard.overview");
  const locale = useLocale();
  const { last30d } = orders;
  const setupVisible = Boolean(onboarding?.setup && !onboarding.setup.complete);

  return (
    <div className="relative overflow-hidden">
      <BackgroundArrow side="right" />

      <div className="relative mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* On mobile the title + Add action live in the top bar (Sidebar) and
            revenue becomes the hero below, so this header is desktop-only. */}
        <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
          <div>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              {t("title")}
            </h1>
          </div>
          <Link href="/products/new" className={primaryButtonClass}>
            <Plus
              className={`size-4 ${iconPopClass}`}
              strokeWidth={2}
              aria-hidden="true"
            />
            {t("addProduct")}
          </Link>
        </div>

        <MobileRevenueHero value={formatMoney(last30d.revenue, locale)} />

        {/* On mobile everything below the hero rides a white sheet with a
            rounded top that overlaps the glow (same radius family as the
            Modal bottom sheet). From md up the wrapper is invisible. */}
        <div className="relative -mx-6 -mt-14 space-y-6 rounded-t-lg bg-background px-6 pt-6 md:mx-0 md:mt-0 md:rounded-none md:bg-transparent md:p-0">
        <OnboardingSlot onboarding={onboarding} />

        {/* Headline metrics: last 30 days only — all-time and per-channel/click trends live in Analytics. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Mobile shows revenue as the hero above instead of this cell. */}
          <div className="hidden md:block">
            <MetricTile
              label={t("revenue30d")}
              value={formatMoney(last30d.revenue, locale)}
              emphasis
            />
          </div>
          <MetricTile
            label={t("sales30d")}
            value={last30d.sales > 0 ? String(last30d.sales) : null}
            trend={orders.salesTrend}
          />
          <MetricTile
            label={t("avgOrder30d")}
            value={formatMoney(last30d.aov, locale)}
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
              setupVisible,
              twoFactorEnabled,
            })}
          />
          <RecentOrders orders={orders.recentOrders} id={RECENT_ORDERS_ID} />
        </div>
        </div>
      </div>
    </div>
  );
}
