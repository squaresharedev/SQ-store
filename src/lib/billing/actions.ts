"use server";

// Plans & billing server actions: what the pricing modal and Settings › Plan &
// billing call.
//
// SECURITY MODEL, the same order as every other action here:
//   session -> ACTIVE account -> permission -> input -> (step-up) -> budget ->
//   provider.
//   - Reading the plan (loadPricingContext) is for anyone with store.read on
//     the active store: teammates see the plan their store is on.
//   - Changing it is `billing.manage`, the OWNER's alone, and only for the
//     store they own (the active account must be their own). An editor
//     looking at someone else's store can never start a checkout that bills
//     their own account, or anyone else's.
//   - The browser only ever names a PLAN and an INTERVAL, validated against
//     the catalog. Never a price, an amount, a Stripe id or a URL: the server
//     resolves the price (and checks it charges what the catalog says) and
//     builds every URL from NEXT_PUBLIC_APP_URL.
//   - The Customer Portal shows the owner's card, address and invoices, so
//     opening it takes a fresh two-factor code on an account that has 2FA.
//   - Checkout and portal URLs are bearer links to a seller's billing: they go
//     back to the owner's own browser and are never logged.

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { STEP_UP_FIELDS, requireStepUpState } from "@/lib/auth/mfa";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { appUrl } from "@/lib/app-url";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { msg } from "@/i18n/types";
import {
  actionError,
  failed,
  failure,
  invalidInput,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
  type ActionFailure,
  type ActionState,
} from "@/lib/errors";
import { unknownField } from "@/lib/validation/form-fields";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { billingProvider } from "@/lib/billing/availability";
import { ensureBillingCustomer } from "@/lib/billing/customer";
import { isLiveSubscription, type SubscriptionStatus } from "@/lib/billing/entitlement";
import { recordFunnelEvent } from "@/lib/billing/funnel";
import { countPlanUsage } from "@/lib/billing/limits";
import {
  BILLING_SETTINGS_PATH,
  CHECKOUT_SESSION_PARAM,
  PRICING_SOURCES,
  parsePricingSource,
  pricingHref,
  type PricingSource,
} from "@/lib/billing/paths";
import {
  BILLING_INTERVALS,
  PAID_PLAN_IDS,
  type BillingInterval,
  type PlanId,
  type PlanLimitKey,
} from "@/lib/billing/plans";
import { BillingConfigError, type PortalFlow } from "@/lib/billing/provider";
import { getBillingProvider } from "@/lib/billing/providers";

/** What the pricing modal needs to know, and nothing it must not. No Stripe
 *  ids, no customer details: this goes to the browser. */
export type PricingContext = {
  /** The plan in force now. */
  plan: PlanId;
  interval: BillingInterval | null;
  status: SubscriptionStatus | "none";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  /** What this account pays per interval, when it pays (grandfathered prices). */
  priceCents: number | null;
  /** A live subscription exists: plan changes go through the Customer Portal
   *  (switch or cancel), not a second checkout. */
  hasSubscription: boolean;
  /** The viewer is the store's owner, the only person who can change its plan. */
  canManage: boolean;
  /** Plans can be bought in this deployment (a billing provider is set up). */
  available: boolean;
  /** The last 30 days of item sales, for the calculator; null if unreadable. */
  salesSubtotal30dCents: number | null;
  /** What the store has of each capped thing now; null if uncounted. */
  usage: Record<PlanLimitKey, number | null>;
};

export type PricingContextResult = { ok: true; context: PricingContext } | ActionFailure;

/**
 * Everything the pricing modal shows about the ACTIVE store. Records a
 * `pricing_viewed` funnel event (at most once per entry point per ten
 * minutes) when opened from a known entry point.
 */
export async function loadPricingContext(source?: unknown): Promise<PricingContextResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "store.read")) return failure(permissionDenied(account.role, "manageBilling"));
  if (!(await rateLimit("billing_read", RATE_LIMITS.billingRead))) {
    return failure(rateLimited("changePlan"));
  }

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return failure(serverError("loadPlans"));

  const supabase = await createClient();
  const [sales, storefronts, teamSeats] = await Promise.all([
    // Under the caller's own RLS (an invoker function): it can only ever
    // count orders this person may already read.
    supabase.rpc("billing_sales_summary", { p_seller_id: account.accountId }),
    countPlanUsage(account.accountId, "storefronts"),
    countPlanUsage(account.accountId, "teamSeats"),
  ]);
  const salesRow = Array.isArray(sales.data) ? sales.data[0] : null;

  const entry = parsePricingSource(source);
  if (entry && (await rateLimit(`pricing_view:${entry}`, RATE_LIMITS.pricingViewDedupe))) {
    await recordFunnelEvent({
      accountId: account.accountId,
      actorId: account.userId,
      kind: "pricing_viewed",
      source: entry,
      plan: billing.billing.plan,
    });
  }

  const { billing: b } = billing;
  return {
    ok: true,
    context: {
      plan: b.plan,
      interval: b.interval,
      status: b.status,
      cancelAtPeriodEnd: b.cancelAtPeriodEnd,
      currentPeriodEnd: b.currentPeriodEnd,
      priceCents: b.priceCents,
      hasSubscription: Boolean(b.subscriptionId) && isLiveSubscription(b.status),
      canManage: account.isOwner && can(account.role, "billing.manage"),
      available: billingProvider() !== null,
      salesSubtotal30dCents: sales.error || !salesRow ? null : Number(salesRow.subtotal_cents),
      usage: { storefronts, teamSeats },
    },
  };
}

const checkoutSchema = z.object({
  plan: z.enum(PAID_PLAN_IDS),
  interval: z.enum(BILLING_INTERVALS),
  source: z.enum(PRICING_SOURCES).optional(),
});

export type CheckoutResult = { ok: true; url: string } | ActionFailure;

type ActiveAccount = NonNullable<Awaited<ReturnType<typeof getActiveAccount>>>;

/** The owner of the active store, or the error that says why not. */
async function billingOwner(): Promise<{ ok: true; account: ActiveAccount } | { ok: false; error: ActionError }> {
  const account = await getActiveAccount();
  if (!account) return { ok: false, error: sessionExpired() };
  // `isOwner` as well as the permission: billing.manage is the owner's, and
  // the only store an owner may bill is their own.
  if (!account.isOwner || !can(account.role, "billing.manage")) {
    // The generic fix ("ask to be made an Editor") would not help here: no
    // role but the owner's can change a plan.
    return {
      ok: false,
      error: { ...permissionDenied(account.role, "manageBilling"), fix: msg("Errors.billing.ownerOnlyFix") },
    };
  }
  return { ok: true, account };
}

/** The provider, or the error a seller sees when plans cannot be bought here. */
function unavailable() {
  return actionError("server_error", msg("Errors.billing.unavailable"), msg("Errors.billing.unavailableFix"));
}

/** The reader's language, for Stripe's hosted pages and emails. */
async function requestLocale() {
  return parseLocale(await getLocale()) ?? DEFAULT_LOCALE;
}

/**
 * Send the owner to Stripe Checkout to start a paid plan. Returns the URL for
 * the browser to go to (the modal navigates with window.location, which keeps
 * the redirect out of the page's form-action policy).
 *
 * Refuses when the store already has a live subscription: a change of plan
 * goes through the Customer Portal (openBillingPortal), so a double click can
 * never leave a seller paying for two plans.
 */
export async function startCheckout(input: unknown): Promise<CheckoutResult> {
  const owner = await billingOwner();
  if (!owner.ok) return failure(owner.error);
  const { account } = owner;

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return failure(invalidInput(msg("Errors.billing.invalidPlan")));
  const { plan, interval, source } = parsed.data;

  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failure(rateLimited("changePlan"));
  }

  const provider = getBillingProvider();
  if (!provider) return failure(unavailable());

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return failure(serverError("startCheckout"));
  if (billing.billing.subscriptionId && isLiveSubscription(billing.billing.status)) {
    return failure(invalidInput(msg("Errors.billing.alreadySubscribed")));
  }

  try {
    const user = await getUser();
    const locale = await requestLocale();
    const customerId = await ensureBillingCustomer(
      provider,
      { ownerId: account.accountId, email: user?.email ?? null, locale },
      billing.billing.customerId,
    );
    const url = await provider.createCheckout({
      ownerId: account.accountId,
      customerId,
      plan,
      interval,
      locale,
      // `{CHECKOUT_SESSION_ID}` is Stripe's placeholder, filled in on return.
      successUrl: appUrl(`${BILLING_SETTINGS_PATH}?${CHECKOUT_SESSION_PARAM}={CHECKOUT_SESSION_ID}`),
      cancelUrl: appUrl(pricingHref("checkout_cancel")),
    });
    await recordFunnelEvent({
      accountId: account.accountId,
      actorId: account.userId,
      kind: "checkout_started",
      source: source ?? null,
      plan,
      interval,
    });
    return { ok: true, url };
  } catch (error) {
    logBillingFailure("checkout", error);
    return failure(error instanceof BillingConfigError ? unavailable() : serverError("startCheckout"));
  }
}

const portalSchema = z.discriminatedUnion("flow", [
  z.object({ flow: z.literal("manage") }),
  z.object({ flow: z.literal("cancel") }),
  z.object({ flow: z.literal("switch"), plan: z.enum(PAID_PLAN_IDS), interval: z.enum(BILLING_INTERVALS) }),
]);

/** A form action's state, plus where to send the browser when it succeeded. */
export type PortalState = ActionState & { url?: string };

/**
 * Open the Stripe Customer Portal for the active store's owner: its home
 * (card, invoices, address), or straight to confirming a switch of plan, or
 * to cancelling back to Free at the end of the period.
 *
 * A form action (not a plain call) because it may ask for a two-factor code
 * first: the form renders <StepUpField> and the owner resubmits.
 */
export async function openBillingPortal(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const owner = await billingOwner();
  if (!owner.ok) return failed(owner.error);
  const { account } = owner;

  const rejected = unknownField(formData, ["flow", "plan", "interval", "source", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;
  const parsed = portalSchema.safeParse({
    flow: formData.get("flow"),
    plan: formData.get("plan") ?? undefined,
    interval: formData.get("interval") ?? undefined,
  });
  if (!parsed.success) return failed(invalidInput(msg("Errors.billing.invalidPlan")));
  const source: PricingSource | null = parsePricingSource(formData.get("source"));

  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failed(rateLimited("changePlan"));
  }

  const provider = getBillingProvider();
  if (!provider) return failed(unavailable());

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return failed(serverError("openBillingPortal"));
  const { customerId, subscriptionId, status } = billing.billing;
  if (!customerId) return failed(invalidInput(msg("Errors.billing.noBillingAccount")));

  const flow: PortalFlow =
    parsed.data.flow === "switch"
      ? { kind: "switch", plan: parsed.data.plan, interval: parsed.data.interval }
      : { kind: parsed.data.flow };
  if (flow.kind !== "manage" && !(subscriptionId && isLiveSubscription(status))) {
    return failed(invalidInput(msg("Errors.billing.noSubscription")));
  }

  try {
    const url = await provider.createPortal({
      ownerId: account.accountId,
      customerId,
      subscriptionId,
      flow,
      locale: await requestLocale(),
      returnUrl: appUrl(BILLING_SETTINGS_PATH),
    });
    await recordFunnelEvent({
      accountId: account.accountId,
      actorId: account.userId,
      kind: "portal_opened",
      source,
      plan: flow.kind === "switch" ? flow.plan : billing.billing.plan,
      interval: flow.kind === "switch" ? flow.interval : billing.billing.interval,
    });
    return { url };
  } catch (error) {
    logBillingFailure("portal", error);
    return failed(error instanceof BillingConfigError ? unavailable() : serverError("openBillingPortal"));
  }
}

/** A provider failure, logged without anything a request or response carried. */
function logBillingFailure(what: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[billing] ${what} failed: ${detail}`);
}
