"use server";

// Plans & billing server actions: what the plans page and Settings › Plan &
// billing call to change a plan. (Reading it is lib/billing/pricing-context.ts.)
//
// SECURITY MODEL, the same order as every other action here:
//   session -> ACTIVE account -> permission -> input -> (step-up) -> budget ->
//   provider.
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
//     Cancelling (and undoing it) shows nothing and is one click to reverse,
//     so it takes no code: leaving must be easy.
//   - Checkout and portal URLs are bearer links to a seller's billing: they go
//     back to the owner's own browser and are never logged.

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/session";
import { STEP_UP_FIELDS, requireStepUpState } from "@/lib/auth/mfa";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
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
import { readAccountBilling, type AccountBilling } from "@/lib/billing/account-plan";
import {
  CANCELLATION_DETAIL_MAX,
  CANCELLATION_REASONS,
  type CancellationFeedback,
} from "@/lib/billing/cancellation";
import { ensureBillingCustomer } from "@/lib/billing/customer";
import { isLiveSubscription } from "@/lib/billing/entitlement";
import { recordFunnelEvent } from "@/lib/billing/funnel";
import {
  BILLING_SETTINGS_PATH,
  CHECKOUT_SESSION_PARAM,
  PRICING_SOURCES,
  parsePricingSource,
  plansHref,
  type PricingSource,
} from "@/lib/billing/paths";
import { BILLING_INTERVALS, PAID_PLAN_IDS } from "@/lib/billing/plans";
import { BillingConfigError, type PortalFlow } from "@/lib/billing/provider";
import { getBillingProvider } from "@/lib/billing/providers";

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
 * the browser to go to (the page navigates with window.location, which keeps
 * the redirect out of the page's form-action policy).
 *
 * Refuses when the store already has a live subscription: a change of plan
 * goes through the Customer Portal (openBillingPortal), so a double click can
 * never leave a seller paying for two plans. Two tabs that both pass that check
 * are covered by the provider, which closes the customer's other open Checkout
 * before opening this one.
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
      cancelUrl: appUrl(plansHref("checkout_cancel")),
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

// No "cancel" flow: cancelling is cancelPlan below, in the app, where the
// seller can say why. The portal is for the card, invoices and switches.
const portalSchema = z.discriminatedUnion("flow", [
  z.object({ flow: z.literal("manage") }),
  z.object({ flow: z.literal("switch"), plan: z.enum(PAID_PLAN_IDS), interval: z.enum(BILLING_INTERVALS) }),
]);

/** A form action's state, plus where to send the browser when it succeeded. */
export type PortalState = ActionState & { url?: string };

/**
 * Open the Stripe Customer Portal for the active store's owner: its home
 * (card, invoices, address), or straight to confirming a switch of plan.
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
      : { kind: "manage" };
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

/** Characters a note never needs and a reader can be fooled by: control
 *  characters (line breaks are kept) and the bidi overrides and isolates,
 *  which can make text display in a different order than it was typed. */
const UNSAFE_NOTE_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

const cancelSchema = z.object({
  reason: z.enum(CANCELLATION_REASONS).nullish(),
  // Cleaned, not refused: leaving must never fail over an invisible character.
  detail: z
    .string()
    .nullish()
    .transform((value) => value?.replace(UNSAFE_NOTE_CHARS, "").trim() || null)
    .pipe(z.string().max(CANCELLATION_DETAIL_MAX).nullable()),
});

export type CancelPlanResult = { ok: true; endsAt: string } | ActionFailure;
export type ResumePlanResult = { ok: true } | ActionFailure;

/**
 * Cancel the active store's paid plan at the end of the period it has paid
 * for, with what the owner chose to tell us (both parts optional). The plan
 * keeps working until then; the store then moves to Free and keeps
 * everything it has. Reversible until the period ends (resumePlan).
 *
 * NO TWO-FACTOR STEP-UP, unlike the portal: cancelling must be easy, it is
 * undone with one click until the period ends, and it is still the owner's
 * alone and rate limited. (The portal asks for a code because it shows a card
 * and invoices; this shows nothing.)
 */
export async function cancelPlan(input: unknown): Promise<CancelPlanResult> {
  const owner = await billingOwner();
  if (!owner.ok) return failure(owner.error);
  const { account } = owner;

  const parsed = cancelSchema.safeParse(input ?? {});
  if (!parsed.success) return failure(invalidInput(msg("Errors.billing.invalidFeedback")));
  const feedback = { reason: parsed.data.reason ?? null, detail: parsed.data.detail };

  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failure(rateLimited("changePlan"));
  }

  const provider = getBillingProvider();
  if (!provider) return failure(unavailable());

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return failure(serverError("cancelPlan"));
  const { customerId, subscriptionId, status, cancelAtPeriodEnd } = billing.billing;
  if (!customerId || !subscriptionId || !isLiveSubscription(status) || cancelAtPeriodEnd) {
    return failure(invalidInput(msg("Errors.billing.notCancellable")));
  }

  try {
    await provider.scheduleCancellation(account.accountId, customerId, subscriptionId, feedback);
    // What the provider actually did, not what was asked: only a plan that is
    // now set to end gets a cancellation on record.
    const after = await readAccountBilling(account.accountId);
    if (!after.ok || !after.billing.cancelAtPeriodEnd || !after.billing.currentPeriodEnd) {
      return failure(serverError("cancelPlan"));
    }
    await recordCancellation(account.accountId, after.billing, after.billing.currentPeriodEnd, feedback);
    // No revalidatePath: it would re-render the page under the open dialog,
    // swap the cancel button for "Keep my plan" and unmount the confirmation.
    // The dialog refreshes the page itself when it closes.
    return { ok: true, endsAt: after.billing.currentPeriodEnd };
  } catch (error) {
    logBillingFailure("cancel", error);
    return failure(error instanceof BillingConfigError ? unavailable() : serverError("cancelPlan"));
  }
}

/**
 * Undo a scheduled cancellation while the paid period is still running, so
 * the plan renews as before ("Keep my plan").
 *
 * Refused while the account has asked to be deleted: that request ends the
 * plan on purpose (lib/settings/actions.ts requestAccountDeletion), and
 * resuming it would keep charging an account that is about to be gone.
 */
export async function resumePlan(): Promise<ResumePlanResult> {
  const owner = await billingOwner();
  if (!owner.ok) return failure(owner.error);
  const { account } = owner;

  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failure(rateLimited("changePlan"));
  }

  const provider = getBillingProvider();
  if (!provider) return failure(unavailable());

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("deletion_requested_at")
    .eq("id", account.accountId)
    .maybeSingle();
  if (profileError) return failure(serverError("resumePlan"));
  if (profile?.deletion_requested_at) return failure(invalidInput(msg("Errors.billing.deletionPending")));

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return failure(serverError("resumePlan"));
  const { customerId, subscriptionId, status, cancelAtPeriodEnd, currentPeriodEnd } = billing.billing;
  const periodRunning = currentPeriodEnd !== null && new Date(currentPeriodEnd).getTime() > Date.now();
  if (!customerId || !subscriptionId || !isLiveSubscription(status) || !cancelAtPeriodEnd || !periodRunning) {
    return failure(invalidInput(msg("Errors.billing.notResumable")));
  }

  try {
    await provider.resumeSubscription(account.accountId, customerId, subscriptionId);
    const { error } = await admin
      .from("plan_cancellations")
      .update({ resumed_at: new Date().toISOString() })
      .eq("owner_id", account.accountId)
      .is("resumed_at", null);
    if (error) console.warn("[billing] resume not marked on the cancellation:", error.message);
    // KeepPlanButton refreshes the page once its toast is up.
    return { ok: true };
  } catch (error) {
    logBillingFailure("resume", error);
    return failure(error instanceof BillingConfigError ? unavailable() : serverError("resumePlan"));
  }
}

/** Postgres: a unique index refused the row. */
const UNIQUE_VIOLATION = "23505";

/**
 * The cancellation on record, for the admin panel's feedback list. One open
 * row per plan end: a double submit lands on the partial unique index and is
 * dropped as already recorded, never counted twice. Best effort: the
 * cancellation itself has happened, and a missing note must not tell the
 * seller it failed.
 */
async function recordCancellation(
  ownerId: string,
  billing: AccountBilling,
  endsAt: string,
  feedback: CancellationFeedback,
): Promise<void> {
  const { error } = await createAdminClient().from("plan_cancellations").insert({
    owner_id: ownerId,
    plan: billing.storedPlan ?? billing.plan,
    billing_interval: billing.interval,
    reason: feedback.reason,
    detail: feedback.detail,
    ends_at: endsAt,
  });
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.warn("[billing] cancellation not recorded:", error.message);
  }
}

/** A provider failure, logged without anything a request or response carried. */
function logBillingFailure(what: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[billing] ${what} failed: ${detail}`);
}
