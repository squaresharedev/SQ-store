import Link from "next/link";
import { Plus } from "lucide-react";
import { primaryButtonClass } from "@/components/ui/control-styles";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";
import { formatMoney } from "@/lib/dashboard/format";
import { MetricTile } from "./MetricTile";
import { NeedsAttention, type AttentionItem } from "./NeedsAttention";
import { OnboardingSlot } from "./OnboardingSlot";
import { QuickActions } from "./QuickActions";
import { RecentOrders } from "./RecentOrders";
import { StorefrontStatus } from "./StorefrontStatus";
import { TopProducts } from "./TopProducts";

const RECENT_ORDERS_ID = "recent-orders";

function buildAttentionItems(
  orders: DashboardOrdersData,
  products: ProductsSummary,
  storefrontSaved: boolean,
  storefrontBlockCount: number,
): AttentionItem[] {
  const items: AttentionItem[] = [
    // Always present until Stripe Connect exists (payments stage).
    {
      key: "stripe",
      label: "Connect Stripe to get paid",
      description: "Payouts stay blocked until your account is connected.",
      href: "/settings",
      actionLabel: "Go to settings",
    },
  ];
  if (!storefrontSaved || storefrontBlockCount === 0) {
    items.push({
      key: "storefront",
      label: storefrontSaved ? "Your storefront is empty" : "Save your storefront",
      description: storefrontSaved
        ? "Add products to your grid so buyers have something to see."
        : "Arrange your grid and save it to go live.",
      href: "/storefront",
      actionLabel: "Open designer",
    });
  }
  if (products.missingImage.length > 0) {
    const [first] = products.missingImage;
    items.push({
      key: "images",
      label: `${products.missingImage.length} product${products.missingImage.length === 1 ? "" : "s"} missing an image`,
      description:
        products.missingImage.length === 1
          ? `"${first.title}" has no display image yet.`
          : "Products without images look empty on your storefront.",
      href: "/products",
      actionLabel: "Fix products",
    });
  }
  const flagged = orders.refundedCount + orders.disputedCount;
  if (flagged > 0) {
    items.push({
      key: "flagged-orders",
      label: `${flagged} order${flagged === 1 ? "" : "s"} to review`,
      description: `${orders.disputedCount} disputed, ${orders.refundedCount} refunded.`,
      href: `#${RECENT_ORDERS_ID}`,
      actionLabel: "Review orders",
    });
  }
  return items;
}

/** Composition only: lays the modules out; all data arrives as props. */
export function DashboardHome({
  orders,
  products,
  storefrontSaved,
  storefrontBlockCount,
}: {
  orders: DashboardOrdersData;
  products: ProductsSummary;
  storefrontSaved: boolean;
  storefrontBlockCount: number;
}) {
  const { last30d, allTime, channelSplit } = orders;
  const allTimeRevenue = formatMoney(allTime.revenue);
  const hasChannelData = channelSplit.embed.sales + channelSplit.marketplace.sales > 0;

  return (
    <div className="relative overflow-hidden">
      <BackgroundArrow side="right" />

      <div className="relative mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              Overview
            </h1>
            <p className="mt-1 font-inter text-sm text-muted-foreground">
              What is happening in your store.
            </p>
          </div>
          <Link href="/products/new" className={primaryButtonClass}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add product
          </Link>
        </div>

        <OnboardingSlot />

        {/* Headline metrics: last 30 days big, all-time as the hint line. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricTile
            label="Revenue · 30 days"
            value={formatMoney(last30d.revenue)}
            hint={allTimeRevenue ? `All time: ${allTimeRevenue}` : undefined}
            decoration="glow"
            decorationTone="accent"
          />
          <MetricTile
            label="Sales · 30 days"
            value={last30d.sales > 0 ? String(last30d.sales) : null}
            hint={allTime.sales > 0 ? `All time: ${allTime.sales}` : undefined}
          />
          <MetricTile
            label="Avg order · 30 days"
            value={formatMoney(last30d.aov)}
            hint={
              formatMoney(allTime.aov)
                ? `All time: ${formatMoney(allTime.aov)}`
                : undefined
            }
          />
          <MetricTile label="Channel split · all time" zeroText="No sales yet">
            {hasChannelData ? (
              <dl className="space-y-1">
                {(["embed", "marketplace"] as const).map((channel) => (
                  <div
                    key={channel}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <dt className="font-inter text-sm text-muted-foreground">
                      {channel === "embed" ? "Your site (embed)" : "Marketplace"}
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {formatMoney(channelSplit[channel].revenue) ?? "0"} ·{" "}
                      {channelSplit[channel].sales} sale
                      {channelSplit[channel].sales === 1 ? "" : "s"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : undefined}
          </MetricTile>
          <MetricTile label="Storefront views" pending />
          <MetricTile label="Product clicks" pending />
        </div>

        {/* Status modules. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <NeedsAttention
              items={buildAttentionItems(
                orders,
                products,
                storefrontSaved,
                storefrontBlockCount,
              )}
            />
            <RecentOrders orders={orders.recentOrders} id={RECENT_ORDERS_ID} />
          </div>
          <div className="space-y-4">
            <StorefrontStatus
              saved={storefrontSaved}
              blockCount={storefrontBlockCount}
            />
            <TopProducts products={orders.topProducts} />
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
