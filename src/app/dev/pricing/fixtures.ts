import type { BillingActions } from "@/components/billing/billing-actions";
import type { PortalState } from "@/lib/billing/actions";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { PLANS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";

// What the billing dev galleries (/dev/pricing, /dev/cancel) share: store
// states as the server would send them, and stand-in server actions.

/** A Free store's PricingContext: the base every scenario starts from. */
export const FREE_CONTEXT: PricingContext = {
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
  return {
    ...FREE_CONTEXT,
    plan,
    interval,
    status: "active",
    priceCents: PLANS[plan].priceCents[interval],
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
