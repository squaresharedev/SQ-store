import Link from "@/components/ui/AppLink";
import { Plus } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { iconPopClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";
import {
  buildAttentionItems,
  type ProfileAttentionData,
  type StorefrontAttentionInfo,
} from "@/lib/dashboard/attention";
import { formatMoney } from "@/lib/dashboard/format";
import { NEW_PRODUCT_PATH } from "@/lib/products/paths";
import type { RestockForecast } from "@/lib/predictions";
import type { OrderView } from "@/types/order-view";
import type { OrderGlance } from "@/lib/orders/queries";
import { TourLink } from "@/components/onboarding/TourLink";
import { InstallOffer } from "@/components/pwa/InstallOffer";
import { MetricTile } from "./MetricTile";
import { MobileRevenueHero } from "./MobileRevenueHero";
import { NeedsAttention } from "./NeedsAttention";
import { OnboardingSlot, type OnboardingData } from "./OnboardingSlot";
import { RecentOrders } from "./RecentOrders";

const RECENT_ORDERS_ID = "recent-orders";

/** Composition only: lays the modules out; all data arrives as props. */
export function DashboardHome({
  termsInForce,
  orders,
  products,
  storefronts,
  profile,
  stripeConnected,
  onboarding,
  twoFactorEnabled = true,
  recentOrderDetails = [],
  recentOrderGlances,
  toShipCount = 0,
  withdrawalsToSettle = 0,
  restocks = [],
  canFulfil = false,
  canAddProducts = false,
  checkoutOpen = false,
}: {
  /** The Terms version in force, or null if that could not be read. */
  termsInForce: string | null;
  orders: DashboardOrdersData;
  /** Full detail for the Recent orders rows, so each opens in place. */
  recentOrderDetails?: OrderView[];
  /** Photo and unit count per Recent orders row, keyed by order id. */
  recentOrderGlances?: Record<string, OrderGlance>;
  /** Paid orders waiting to be shipped; above zero adds the row that says so. */
  toShipCount?: number;
  /** Recent withdrawals still waiting for their refund; above zero adds a row. */
  withdrawalsToSettle?: number;
  /** Counted products about to sell out at their pace; any adds a row. */
  restocks?: readonly RestockForecast[];
  /** Whether the viewer may mark orders shipped from an opened order. */
  canFulfil?: boolean;
  /** Whether the viewer may add products; a viewer-role teammate gets no Add button. */
  canAddProducts?: boolean;
  /** Whether a buyer can pay through Square Share checkout right now. */
  checkoutOpen?: boolean;
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
  // Three zeros say nothing to a seller still setting up: the numbers appear
  // with the first sale, and setup has the page until then.
  const showMetrics = !setupVisible || last30d.sales > 0;

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
          {/* Secondary while setup is on screen: its next step is the one
              primary action on the page. */}
          {canAddProducts && (
            <Link href={NEW_PRODUCT_PATH} className={setupVisible ? secondaryButtonClass : primaryButtonClass}>
              <Plus
                className={`size-4 ${iconPopClass}`}
                strokeWidth={2}
                aria-hidden="true"
              />
              {t("addProduct")}
            </Link>
          )}
        </div>

        {showMetrics && <MobileRevenueHero value={formatMoney(last30d.revenue, locale)} />}

        {/* On mobile everything below the hero rides a white sheet with a
            rounded top that overlaps the glow (same radius family as the
            Modal bottom sheet). From md up the wrapper is invisible. */}
        <div
          className={cn(
            "relative -mx-6 space-y-6 rounded-t-lg bg-background px-6 pt-6 md:mx-0 md:mt-0 md:rounded-none md:bg-transparent md:p-0",
            showMetrics && "-mt-14",
          )}
        >
        <OnboardingSlot onboarding={onboarding} />
        <InstallOffer />

        {/* Headline metrics: last 30 days only. All-time and per-channel/click trends live in Analytics. */}
        {showMetrics && (
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
        )}

        {/* Status modules. */}
        <div className="space-y-4">
          <NeedsAttention
            setupVisible={setupVisible}
            items={buildAttentionItems({
              orders,
              products,
              storefronts,
              profile,
              termsInForce,
              stripeConnected,
              setupVisible,
              twoFactorEnabled,
              toShipCount,
              withdrawalsToSettle,
              restocks,
              checkoutOpen,
            })}
          />
          <RecentOrders
            orders={orders.recentOrders}
            details={recentOrderDetails}
            glances={recentOrderGlances}
            id={RECENT_ORDERS_ID}
            canFulfil={canFulfil}
            checkoutOpen={checkoutOpen}
          />
        </div>

        {/* The checklist offers the tour while setup is on screen; after
            that, this is the way back to it on the page a seller lands on. */}
        {!setupVisible && <TourLink />}
        </div>
      </div>
    </div>
  );
}
