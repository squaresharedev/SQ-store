"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AccountPlanProvider, PlanPricesProvider } from "@/components/billing/plan-context";
import { PlanChip } from "@/components/billing/PlanChip";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { PlansPage } from "@/components/billing/PlansPage";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { BillingSection } from "@/components/settings/BillingSection";
import { OrdersExportButton } from "@/components/orders/OrdersExportButton";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { planHas } from "@/lib/billing/features";
import { PLANS } from "@/lib/billing/plans";
import { FREE_CONTEXT, PRICES_WITH_YEARLY, inAMonth, paidContext, standInBillingActions } from "./fixtures";
import { DevOptionGroup, GallerySection } from "./DevControls";

const IN_A_MONTH = inAMonth();

/** The store states the billing surfaces must handle, each a PricingContext
 *  as the server would send it. */
const SCENARIOS: { value: string; label: string; context: PricingContext }[] = [
  { value: "free", label: "Free owner, no sales yet", context: FREE_CONTEXT },
  {
    value: "free-selling",
    label: "Free owner selling €1,800 a month",
    context: { ...FREE_CONTEXT, directSales30dCents: 180_000, usage: { storefronts: 3, teamSeats: 2, products: 23 } },
  },
  {
    value: "free-waived",
    label: "Free owner, fee waived (closed beta)",
    context: { ...FREE_CONTEXT, feeWaived: true, directSales30dCents: 60_000 },
  },
  {
    value: "free-yearly",
    label: "Free owner, once yearly prices are sold",
    context: { ...FREE_CONTEXT, prices: PRICES_WITH_YEARLY, directSales30dCents: 90_000 },
  },
  {
    value: "free-over",
    label: "Free owner over the storefront limit",
    context: { ...FREE_CONTEXT, usage: { storefronts: 5, teamSeats: 2, products: 8 } },
  },
  {
    value: "starter",
    label: "Starter, monthly",
    context: paidContext("starter", "month", IN_A_MONTH, { directSales30dCents: 260_000 }),
  },
  {
    value: "pro-ending",
    label: "Pro yearly, cancelled at period end",
    context: paidContext("pro", "year", IN_A_MONTH, { cancelAtPeriodEnd: true }),
  },
  {
    value: "past-due",
    label: "Pro, payment failed",
    context: paidContext("pro", "month", IN_A_MONTH, { status: "past_due" }),
  },
  {
    value: "granted",
    label: "Starter given by Square Share, for a month",
    context: { ...FREE_CONTEXT, plan: "starter", grant: { plan: "starter", endsAt: IN_A_MONTH } },
  },
  {
    value: "granted-open",
    label: "Pro given by Square Share, no end date",
    context: { ...FREE_CONTEXT, plan: "pro", grant: { plan: "pro", endsAt: null } },
  },
  { value: "member", label: "Teammate (read only)", context: { ...FREE_CONTEXT, plan: "starter", canManage: false } },
  { value: "unavailable", label: "Billing not set up here", context: { ...FREE_CONTEXT, available: false } },
];

export function PricingGallery({ banners }: { banners: React.ReactNode }) {
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.value);
  const [lastNavigation, setLastNavigation] = useState<string | null>(null);
  const { context } = SCENARIOS.find((candidate) => candidate.value === scenarioKey)!;

  // Stand-ins for the server actions. Nothing changes here: they say what the
  // server was sent, or the URL a real one would open. /dev/cancel walks the
  // cancel flow through its states.
  const actions = useMemo(() => standInBillingActions(setLastNavigation), []);

  return (
    <AccountPlanProvider plan={context.plan}>
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Plans &amp; billing</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Every billing surface in every store state, with stand-in actions. Nothing is bought. To walk
            the cancel flow through its states, use{" "}
            <Link href="/dev/cancel" className="underline underline-offset-4">
              /dev/cancel
            </Link>
            .
          </p>
        </header>
        <DevOptionGroup label="Store state" options={SCENARIOS} value={scenarioKey} onChange={setScenarioKey} />
        {lastNavigation && (
          <p className="font-inter text-xs text-muted-foreground" data-dev-navigation>
            Would open: {lastNavigation}
          </p>
        )}
      </div>

      {/* Keyed on the scenario so every surface starts fresh. */}
      <div key={scenarioKey}>
        <GallerySection title="Settings › Plan & billing">
          <div className="max-w-3xl">
            <BillingSection context={context} returned={null} actions={actions} />
          </div>
        </GallerySection>

        <GallerySection title="Upsell card alone (owner)">
          <div className="max-w-3xl">
            {/* On its own it needs the prices the pages above provide themselves. */}
            <PlanPricesProvider prices={context.prices}>
              <UpgradeCard context={{ ...context, canManage: true }} actions={actions} />
            </PlanPricesProvider>
          </div>
        </GallerySection>

        <GallerySection title="Rail chip, Orders export button">
          <div className="flex flex-wrap items-center gap-6">
            <div className="w-64 border border-border p-3">
              <PlanChip className="flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium" />
            </div>
            <OrdersExportButton enabled={planHas(context.plan, "ordersExport")} />
          </div>
        </GallerySection>

        <GallerySection title="Past-due banner (owner, then teammate)">{banners}</GallerySection>

        <GallerySection title="Product limit reached (shown on /products/new and /products/import)">
          <div className="max-w-3xl">
            <PlanLimitNotice
              limitKey="products"
              plan={context.plan}
              cap={PLANS[context.plan].limits.products ?? 0}
            />
          </div>
        </GallerySection>

        <GallerySection title="/plans">
          <PlansPage context={context} source={null} actions={actions} />
        </GallerySection>
      </div>
    </AccountPlanProvider>
  );
}
