// SERVER ONLY. The pricing funnel: what happens around the pricing modal, per
// account, so we can see which entry points lead to an upgrade and which
// never do.
//
// SERVER-PRODUCED ONLY. Every event is recorded by the code that knows it
// happened (the modal's loader, the checkout action, the limit check, the
// webhook), never reported by a browser. There is no endpoint a client can
// post to, so the numbers cannot be padded or forged.
//
// BEST EFFORT. Recording never throws and never holds anything up: an upgrade
// must not fail because its analytics row could not be written.

import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingInterval, PlanId } from "@/lib/billing/plans";
import type { PricingSource } from "@/lib/billing/paths";

/**
 * Every kind of event. MIRRORED by the seller_funnel_events kind CHECK in
 * supabase/migrations/20260930_seller_plans.sql: a kind missing there makes
 * its insert fail silently (this module is best-effort). Edit both together.
 */
export const FUNNEL_EVENT_KINDS = [
  /** The pricing modal was opened (deduped per account and source). */
  "pricing_viewed",
  /** A create action was refused by a plan limit. */
  "limit_hit",
  /** The owner pressed Upgrade and was sent to Checkout. */
  "checkout_started",
  /** The owner was sent to the Customer Portal (switch, cancel, manage). */
  "portal_opened",
  /** Free to a paid plan, confirmed by Stripe. */
  "upgraded",
  /** One paid plan to another, confirmed by Stripe. */
  "plan_changed",
  /** A paid plan ended; the account is on Free again. */
  "downgraded",
  /** A renewal payment failed. */
  "payment_failed",
] as const;
export type FunnelEventKind = (typeof FUNNEL_EVENT_KINDS)[number];

export type FunnelEvent = {
  accountId: string;
  /** Who acted; null for events Stripe produced. */
  actorId: string | null;
  kind: FunnelEventKind;
  source?: PricingSource | null;
  plan?: PlanId | null;
  interval?: BillingInterval | null;
};

/** Record one funnel event. Never throws. */
export async function recordFunnelEvent(event: FunnelEvent): Promise<void> {
  try {
    const { error } = await createAdminClient().from("seller_funnel_events").insert({
      account_id: event.accountId,
      actor_id: event.actorId,
      kind: event.kind,
      // Every key on every row: PostgREST builds one column list per insert.
      source: event.source ?? null,
      plan: event.plan ?? null,
      billing_interval: event.interval ?? null,
    });
    if (error) console.warn(`[billing] funnel event ${event.kind} not recorded:`, error.message);
  } catch (error) {
    console.warn(
      `[billing] funnel event ${event.kind} threw:`,
      error instanceof Error ? error.message : error,
    );
  }
}
