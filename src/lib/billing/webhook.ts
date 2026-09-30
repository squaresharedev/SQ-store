// SERVER ONLY. What a verified Stripe Billing event does. The route
// (app/api/billing/webhook/route.ts) verifies the signature and hands the
// parsed event here.
//
// THE CONTRACT
//   1. Only PLATFORM events. An event with `account` set comes from a
//      connected account (Stripe Connect, i.e. a seller's own Stripe): it is
//      not about a plan and is never acted on here.
//   2. Only events of this key's mode: a live deployment ignores test events
//      and the other way round.
//   3. The account is resolved from seller_billing.stripe_customer_id, a row
//      only this server writes (lib/billing/customer.ts). Never from event
//      metadata alone, which is a claim.
//   4. The event's payload is not applied. The customer's subscriptions are
//      re-read from Stripe and synced (lib/billing/sync.ts), which makes the
//      order events arrive in irrelevant and a replay harmless.
//   5. Idempotent. An event id is recorded in stripe_events and marked
//      processed only AFTER its sync succeeded; a failure answers 500 and
//      Stripe delivers it again. Side effects (the bell notification, the
//      funnel row) are claimed separately, so a retried event never tells the
//      seller the same thing twice.

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { recordFunnelEvent } from "@/lib/billing/funnel";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/paths";
import { stripeKeyIsLive } from "@/lib/billing/stripe-api";
import { stripeBillingProvider } from "@/lib/billing/stripe-provider";
import { planTransition, type ApplyResult } from "@/lib/billing/sync";

/** The event types that can change an account's plan. Everything else is
 *  acknowledged and ignored. Subscribe the endpoint to exactly these. */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;

const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]{1,250}$/),
  type: z.string().min(1).max(100),
  livemode: z.boolean(),
  account: z.string().nullish(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type StripeEvent = z.infer<typeof eventSchema>;

/** Parse a verified body into an event, or null if it is not one. */
export function parseStripeEvent(body: string): StripeEvent | null {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The customer an event is about: the object's `customer` (a string, or an
 *  expanded customer), or the object itself for a customer.* event. */
export function customerOfEvent(event: StripeEvent): string | null {
  const object = event.data.object;
  const direct = object.customer;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && typeof (direct as { id?: unknown }).id === "string") {
    return (direct as { id: string }).id;
  }
  if (event.type.startsWith("customer.") && !event.type.startsWith("customer.subscription.")) {
    return typeof object.id === "string" ? object.id : null;
  }
  return null;
}

/** How the route should answer Stripe. */
export type WebhookOutcome =
  | { status: 200; note: string }
  /** Something on our side failed: Stripe will deliver the event again. */
  | { status: 500; note: string };

/** Handle one verified event. Never throws. */
export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  if (event.account) return { status: 200, note: "connect event, not a plan" };
  if (event.livemode !== stripeKeyIsLive()) return { status: 200, note: "other mode" };
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) return { status: 200, note: "ignored type" };

  try {
    const admin = createAdminClient();

    // Seen before and fully processed: nothing to do.
    await admin
      .from("stripe_events")
      .upsert({ id: event.id, type: event.type, livemode: event.livemode }, { onConflict: "id", ignoreDuplicates: true });
    const { data: seen, error: seenError } = await admin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .single();
    if (seenError) throw new Error(`reading the event ledger failed: ${seenError.message}`);
    if (seen.processed_at) return { status: 200, note: "already processed" };

    const customerId = customerOfEvent(event);
    const owner = customerId
      ? await admin.from("seller_billing").select("owner_id").eq("stripe_customer_id", customerId).maybeSingle()
      : null;
    if (owner?.error) throw new Error(`resolving the account failed: ${owner.error.message}`);

    let result: ApplyResult | null = null;
    if (customerId && owner?.data) {
      result = await stripeBillingProvider.syncCustomer(owner.data.owner_id, customerId);
    } else {
      // A customer this app never created (made by hand in the dashboard, or
      // another integration's): nothing of ours to change.
      console.warn(`[billing] ${event.type} ${event.id} is about an unknown customer; ignored`);
    }

    const { error: markError } = await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (markError) throw new Error(`marking the event processed failed: ${markError.message}`);

    if (owner?.data && result) await tellSeller(event, owner.data.owner_id, result);
    return { status: 200, note: "synced" };
  } catch (error) {
    console.error(
      `[billing] webhook ${event.type} ${event.id} failed:`,
      error instanceof Error ? error.message : error,
    );
    return { status: 500, note: "failed" };
  }
}

/**
 * The seller-facing consequences of an event, at most once per event: a bell
 * notification when their plan changed or a renewal failed, and the matching
 * funnel row. Best-effort: the plan is already synced whatever happens here.
 */
async function tellSeller(event: StripeEvent, ownerId: string, result: ApplyResult): Promise<void> {
  try {
    const { data: claimed } = await createAdminClient()
      .from("stripe_events")
      .update({ side_effects_at: new Date().toISOString() })
      .eq("id", event.id)
      .is("side_effects_at", null)
      .select("id");
    if (!claimed?.length) return;

    const href = BILLING_SETTINGS_PATH;
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
      const billing = await readAccountBilling(ownerId);
      const plan = billing.ok ? (billing.billing.storedPlan ?? billing.billing.plan) : "free";
      await recordFunnelEvent({ accountId: ownerId, actorId: null, kind: "payment_failed", plan });
      await createNotification({
        userId: ownerId,
        type: "billing",
        message: {
          title: { key: "Notifications.messages.billing.paymentFailed.title", values: { plan } },
          body: { key: "Notifications.messages.billing.paymentFailed.body" },
        },
        data: { href },
      });
      return;
    }

    // A stale snapshot (a newer one was already stored) says nothing new.
    const transition = result.applied ? planTransition(result.before, result.after) : null;
    if (!transition) return;
    await recordFunnelEvent({ accountId: ownerId, actorId: null, kind: transition, plan: result.after });
    await createNotification({
      userId: ownerId,
      type: "billing",
      message: {
        title: {
          key: `Notifications.messages.billing.${transition}.title`,
          values: { plan: result.after, previous: result.before },
        },
        body: { key: `Notifications.messages.billing.${transition}.body` },
      },
      data: { href },
    });
  } catch (error) {
    console.warn("[billing] telling the seller failed:", error instanceof Error ? error.message : error);
  }
}
