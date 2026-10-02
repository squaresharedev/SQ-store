"use client";

import { useCallback, useMemo, useState } from "react";
import { AccountPlanProvider } from "@/components/billing/plan-context";
import { PlanChip } from "@/components/billing/PlanChip";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { PlansPage } from "@/components/billing/PlansPage";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import type { BillingActions } from "@/components/billing/billing-actions";
import { BillingSection } from "@/components/settings/BillingSection";
import { OrdersExportButton } from "@/components/orders/OrdersExportButton";
import type { PortalState } from "@/lib/billing/actions";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { planHas } from "@/lib/billing/features";
import { PLANS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** The store states the billing surfaces must handle, each a PricingContext
 *  as the server would send it. */
const BASE: PricingContext = {
  plan: "free",
  interval: null,
  status: "none",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  priceCents: null,
  currency: null,
  hasSubscription: false,
  hasBillingAccount: false,
  canManage: true,
  available: true,
  salesSubtotal30dCents: 0,
  usage: { storefronts: 1, teamSeats: 1, products: 4 },
};

const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const PAID: Partial<PricingContext> = {
  status: "active",
  currency: "EUR",
  currentPeriodEnd: IN_A_MONTH,
  hasSubscription: true,
  hasBillingAccount: true,
};

const SCENARIOS: { key: string; label: string; context: PricingContext }[] = [
  { key: "free", label: "Free owner, no sales yet", context: BASE },
  {
    key: "free-selling",
    label: "Free owner selling €1,800 a month",
    context: { ...BASE, salesSubtotal30dCents: 180_000, usage: { storefronts: 3, teamSeats: 2, products: 23 } },
  },
  {
    key: "starter",
    label: "Starter, monthly",
    context: { ...BASE, ...PAID, plan: "starter", interval: "month", priceCents: 1500, salesSubtotal30dCents: 160_000 },
  },
  {
    key: "pro-ending",
    label: "Pro yearly, cancelled at period end",
    context: { ...BASE, ...PAID, plan: "pro", interval: "year", priceCents: 40000, cancelAtPeriodEnd: true },
  },
  {
    key: "past-due",
    label: "Pro, payment failed",
    context: { ...BASE, ...PAID, plan: "pro", interval: "month", status: "past_due", priceCents: 4000 },
  },
  { key: "member", label: "Teammate (read only)", context: { ...BASE, plan: "starter", canManage: false } },
  { key: "unavailable", label: "Billing not set up here", context: { ...BASE, available: false } },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function PricingGallery({ banners }: { banners: React.ReactNode }) {
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.key);
  const [lastNavigation, setLastNavigation] = useState<string | null>(null);
  const { context } = SCENARIOS.find((candidate) => candidate.key === scenarioKey)!;

  // Stand-ins for the server actions: a short wait so pending states show,
  // then what the server would answer. "Navigating" only records the URL.
  const navigate = useCallback((url: string) => setLastNavigation(url), []);
  const actions = useMemo<BillingActions>(
    () => ({
      startCheckout: async ({ plan, interval }) => {
        await wait(600);
        return { ok: true, url: `https://checkout.stripe.com/(dev) ${plan}/${interval}` };
      },
      openPortal: async (_prev: PortalState, formData: FormData): Promise<PortalState> => {
        await wait(600);
        return { url: `https://billing.stripe.com/(dev) ${String(formData.get("flow"))}` };
      },
      navigate,
    }),
    [navigate],
  );

  return (
    <AccountPlanProvider plan={context.plan}>
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Plans &amp; billing</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Every billing surface in every store state, with stand-in actions. Nothing is bought.
          </p>
        </header>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Store state">
          {SCENARIOS.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              aria-pressed={candidate.key === scenarioKey}
              onClick={() => setScenarioKey(candidate.key)}
              className={cn(
                "border px-3 py-1.5 font-inter text-xs",
                candidate.key === scenarioKey ? "border-foreground bg-accent" : "border-border",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
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
            <UpgradeCard context={{ ...context, canManage: true }} actions={actions} />
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

function GallerySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl space-y-3 px-6 py-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
