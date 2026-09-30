"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PricingModalProvider } from "@/components/billing/PricingModalProvider";
import { usePricingModal } from "@/components/billing/pricing-modal-context";
import { PlanChip } from "@/components/billing/PlanChip";
import { BillingSettings } from "@/components/billing/BillingSettings";
import type { PricingModalActions } from "@/components/billing/PricingModal";
import type { PortalState, PricingContext, PricingContextResult } from "@/lib/billing/actions";
import { serverError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** The store states the modal must handle, each a PricingContext as the
 *  server would send it. */
const BASE: PricingContext = {
  plan: "free",
  interval: null,
  status: "none",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  priceCents: null,
  hasSubscription: false,
  canManage: true,
  available: true,
  salesSubtotal30dCents: 0,
  usage: { storefronts: 1, teamSeats: 1 },
};

const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const SCENARIOS: { key: string; label: string; context: PricingContext | "error" }[] = [
  { key: "free", label: "Free owner, no sales yet", context: BASE },
  {
    key: "free-selling",
    label: "Free owner selling €1,800 a month",
    context: { ...BASE, salesSubtotal30dCents: 180_000, usage: { storefronts: 3, teamSeats: 2 } },
  },
  {
    key: "starter",
    label: "Starter, monthly",
    context: {
      ...BASE,
      plan: "starter",
      interval: "month",
      status: "active",
      priceCents: 1500,
      currentPeriodEnd: IN_A_MONTH,
      hasSubscription: true,
      salesSubtotal30dCents: 90_000,
    },
  },
  {
    key: "pro-ending",
    label: "Pro, cancelled at period end",
    context: {
      ...BASE,
      plan: "pro",
      interval: "year",
      status: "active",
      priceCents: 40000,
      currentPeriodEnd: IN_A_MONTH,
      cancelAtPeriodEnd: true,
      hasSubscription: true,
    },
  },
  {
    key: "past-due",
    label: "Pro, payment failed",
    context: {
      ...BASE,
      plan: "pro",
      interval: "month",
      status: "past_due",
      priceCents: 4000,
      currentPeriodEnd: IN_A_MONTH,
      hasSubscription: true,
    },
  },
  { key: "member", label: "Teammate (read only)", context: { ...BASE, plan: "starter", canManage: false } },
  { key: "unavailable", label: "Billing not set up here", context: { ...BASE, available: false } },
  { key: "error", label: "Plans failed to load", context: "error" },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function PricingGallery({ banners }: { banners: React.ReactNode }) {
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.key);
  const [lastNavigation, setLastNavigation] = useState<string | null>(null);
  const scenario = SCENARIOS.find((candidate) => candidate.key === scenarioKey)!;
  const context = scenario.context === "error" ? BASE : scenario.context;

  // Stand-ins for the server actions: a short wait so pending states show,
  // then what the server would answer. "Navigating" only records the URL.
  const navigate = useCallback((url: string) => setLastNavigation(url), []);
  const actions = useMemo<PricingModalActions>(
    () => ({
      loadContext: async (): Promise<PricingContextResult> => {
        await wait(400);
        return scenario.context === "error"
          ? { ok: false, error: serverError("loadPlans") }
          : { ok: true, context: scenario.context };
      },
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
    [scenario, navigate],
  );

  return (
    <PricingModalProvider
      // Keyed on the scenario so the provider (and an open modal) starts fresh.
      key={scenario.key}
      plan={context.plan}
      stepUp={{ enrolled: false, freshUntil: null, factors: [] }}
      actions={actions}
    >
      <main className="mx-auto max-w-5xl space-y-10 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Plans &amp; billing</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Every state of the pricing modal, with stand-in actions. Nothing is bought.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Store state</h2>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                aria-pressed={candidate.key === scenario.key}
                onClick={() => setScenarioKey(candidate.key)}
                className={cn(
                  "border px-3 py-1.5 font-inter text-xs",
                  candidate.key === scenario.key ? "border-foreground bg-accent" : "border-border",
                )}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <OpenButton />
          {lastNavigation && (
            <p className="font-inter text-xs text-muted-foreground" data-dev-navigation>
              Would open: {lastNavigation}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Rail chip</h2>
          <div className="w-64 border border-border p-3">
            <PlanChip className="flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Past-due banner (owner, then teammate)</h2>
          {banners}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Settings › Plan &amp; billing</h2>
          <div className="max-w-2xl">
            <BillingSettings
              plan={context.plan}
              interval={context.interval}
              status={context.status}
              priceCents={context.priceCents}
              currency="EUR"
              currentPeriodEnd={context.currentPeriodEnd}
              cancelAtPeriodEnd={context.cancelAtPeriodEnd}
              hasBillingAccount={context.plan !== "free"}
              usage={context.usage}
              canManage={context.canManage}
              available={context.available}
              returned={null}
              portalAction={actions.openPortal}
              navigate={navigate}
            />
          </div>
        </section>
      </main>
    </PricingModalProvider>
  );
}

function OpenButton() {
  const pricing = usePricingModal();
  return <Button onClick={() => pricing?.open({ source: "settings" })}>Open plans</Button>;
}
