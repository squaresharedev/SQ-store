import type { BillingActions } from "@/components/billing/billing-actions";
import type { PortalState } from "@/lib/billing/actions";
import { intervalPriceCents, type PlanPrices } from "@/lib/billing/fees";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { findPlanPrice } from "@/lib/pricing";

// What the billing dev galleries (/dev/pricing, /dev/cancel) share: store
// states as the server would send them, and stand-in server actions.
//
// The prices are the SEED (lib/billing/pricing-seed.ts), not the database: a
// gallery has no store and no session to read one with.

/**
 * The seeded prices plus a yearly row for each paid plan, at ten months'
 * price ("2 months free"): what the pages look like once yearly billing is
 * sold. Yearly is not seeded, so this is the only place it is drawn.
 */
export const PRICES_WITH_YEARLY: PlanPrices = [
  ...PLAN_PRICE_SEED,
  ...PAID_PLAN_IDS.flatMap((plan) => {
    const monthly = findPlanPrice(PLAN_PRICE_SEED, plan);
    return monthly
      ? [
          {
            ...monthly,
            interval: "year" as const,
            priceCents: monthly.priceCents * 10,
            stripeLookupKey: `${plan}_year_eur_v1`,
          },
        ]
      : [];
  }),
];

/** A Free store's PricingContext: the base every scenario starts from. */
export const FREE_CONTEXT: PricingContext = {
  prices: PLAN_PRICE_SEED,
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
  directSales30dCents: 0,
  feeWaived: false,
  usage: { storefronts: 1, teamSeats: 1, products: 4 },
};

/** When a subscription started today would renew. */
export function inAMonth(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

/** A live subscription to `plan`, paid until `periodEnd`. */
export function paidContext(
  plan: PaidPlanId,
  interval: BillingInterval,
  periodEnd: string,
  overrides: Partial<PricingContext> = {},
): PricingContext {
  // A yearly subscription only exists where yearly prices do.
  const prices = interval === "year" ? PRICES_WITH_YEARLY : PLAN_PRICE_SEED;
  return {
    ...FREE_CONTEXT,
    prices,
    plan,
    interval,
    status: "active",
    priceCents: intervalPriceCents(prices, plan, interval),
    currency: "EUR",
    currentPeriodEnd: periodEnd,
    hasSubscription: true,
    hasBillingAccount: true,
    ...overrides,
  };
}

/** Long enough for a pending state to show. */
export const STAND_IN_DELAY_MS = 600;

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stand-ins for every billing server action: a short wait, then what the
 * server would answer. Nothing leaves the page: each call is reported to
 * `record` (the URL a real one would open, or what it was sent).
 */
export function standInBillingActions(
  record: (line: string) => void,
  overrides: Partial<BillingActions> = {},
): BillingActions {
  return {
    startCheckout: async ({ plan, interval }) => {
      await wait(STAND_IN_DELAY_MS);
      return { ok: true, url: `https://checkout.stripe.com/(dev) ${plan}/${interval}` };
    },
    openPortal: async (_prev: PortalState, formData: FormData): Promise<PortalState> => {
      await wait(STAND_IN_DELAY_MS);
      return { url: `https://billing.stripe.com/(dev) ${String(formData.get("flow"))}` };
    },
    cancelPlan: async (feedback) => {
      record(`cancelPlan ${JSON.stringify(feedback)}`);
      await wait(STAND_IN_DELAY_MS);
      return { ok: true, endsAt: inAMonth() };
    },
    resumePlan: async () => {
      record("resumePlan");
      await wait(STAND_IN_DELAY_MS);
      return { ok: true };
    },
    navigate: record,
    ...overrides,
  };
}
