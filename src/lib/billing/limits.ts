// SERVER ONLY. THE PLAN LIMITS, checked where each capped thing is created.
//
// Two layers, like every other rule here that matters:
//   1. This check, in the create action, BEFORE the insert: it answers with a
//      planLimitReached error whose action links to the plans page,
//      which is the whole point of a limit on a generous Free plan.
//   2. The database trigger public.enforce_plan_limit (migrations
//      20260930_seller_plans and 20261002_product_limits), which holds the
//      same numbers and refuses the insert with 'plan_limit_reached:<key>'
//      for any client that skips the action. `planLimitKeyOf` turns that
//      refusal into the same error, which also covers two creates racing past
//      this check together.
//
// ONLY CREATION IS LIMITED. An account that downgrades keeps every storefront,
// product and teammate it has; it just cannot add more past its plan's cap
// until it is back under it. Nothing is ever deleted or hidden because of a
// plan, and a store already over a cap when limits are switched on keeps
// selling everything it has.
//
// A READ FAILURE LETS THE CREATE THROUGH (logged). The limit is an upsell, not
// a security boundary, and the trigger still holds; refusing a seller's work
// because the billing row could not be read would be the wrong way round.
//
// OFF UNTIL PAID PLANS ARE ON SALE. One switch, billing_switches.
// plan_limits_enforced, read here and by the trigger alike, so the two cannot
// disagree: a limit whose only way out is an upgrade marked "Soon" is a dead
// end, so neither layer refuses anything until the switch is turned on.

import { createAdminClient } from "@/lib/supabase/admin";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { recordFunnelEvent } from "@/lib/billing/funnel";
import { LIMIT_SOURCE } from "@/lib/billing/paths";
import { PLANS, PLAN_LIMIT_KEYS, type PlanId, type PlanLimitKey } from "@/lib/billing/plans";
import { planLimitReached, type ActionError } from "@/lib/errors";

/** Seat statuses that take a seat: a live member, or an invite not yet
 *  answered (a seat promised). Mirrors the trigger. */
const LIVE_SEAT_STATUSES = ["invited", "active"] as const;

/**
 * Whether plan limits refuse creates at all yet (billing_switches). False on
 * any read failure, including a database the migration has not reached.
 */
export async function planLimitsEnforced(): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("billing_switches")
      .select("plan_limits_enforced")
      .eq("id", true)
      .maybeSingle();
    return !error && data?.plan_limits_enforced === true;
  } catch {
    return false;
  }
}

/** How many of `key` the account has now. Null when it could not be counted. */
export async function countPlanUsage(accountId: string, key: PlanLimitKey): Promise<number | null> {
  try {
    const admin = createAdminClient();
    const query =
      key === "teamSeats"
        ? admin
            .from("team_members")
            .select("id", { count: "exact", head: true })
            .eq("account_owner_id", accountId)
            .in("status", [...LIVE_SEAT_STATUSES])
        : // Storefronts and products are both counted whole, whatever their
          // status: a draft product takes a place like a live one.
          admin.from(key).select("id", { count: "exact", head: true }).eq("owner_id", accountId);
    const { count, error } = await query;
    if (error) {
      console.error(`[billing] counting ${key} failed:`, error.message);
      return null;
    }
    return count ?? 0;
  } catch (error) {
    console.error(`[billing] counting ${key} threw:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Where an account stands against one of its plan's caps. */
export type PlanRoom = {
  plan: PlanId;
  cap: number;
  used: number;
  /** How many more it may create: zero or more. */
  left: number;
};

/**
 * How much room `accountId` has for more of `key`, or null when nothing caps
 * it: limits are switched off, the plan has no cap on it, or the plan or the
 * count could not be read (see the note on read failures above).
 *
 * `accountId` must be the account the caller has already been authorised on
 * (the active account, or the team's owner for an invite): this reads with the
 * service role and checks nothing about the caller.
 */
export async function planRoom(accountId: string, key: PlanLimitKey): Promise<PlanRoom | null> {
  if (!(await planLimitsEnforced())) return null;
  const billing = await readAccountBilling(accountId);
  if (!billing.ok) return null;
  const { plan } = billing.billing;
  const cap = PLANS[plan].limits[key];
  if (cap === null) return null;

  const used = await countPlanUsage(accountId, key);
  if (used === null) return null;
  return { plan, cap, used, left: Math.max(0, cap - used) };
}

/**
 * The error to return when `accountId` may not create `adding` more of `key`
 * (one, unless a batch is being written), or null when it may. Records a
 * `limit_hit` funnel event when it refuses.
 *
 * Same contract as planRoom on who `accountId` must be.
 */
export async function planLimitError(
  accountId: string,
  key: PlanLimitKey,
  actorId: string | null,
  adding = 1,
): Promise<ActionError | null> {
  const room = await planRoom(accountId, key);
  if (!room || room.left >= adding) return null;

  await recordFunnelEvent({
    accountId,
    actorId,
    kind: "limit_hit",
    source: LIMIT_SOURCE[key],
    plan: room.plan,
  });
  return planLimitReached(key, room.plan, room.cap);
}

/**
 * The limit a database error reports, if it is the plan-limit trigger's
 * refusal (SQLSTATE 23514, message 'plan_limit_reached:<key>'), else null.
 */
export function planLimitKeyOf(error: { code?: string; message?: string } | null | undefined): PlanLimitKey | null {
  if (!error || error.code !== "23514") return null;
  const match = /plan_limit_reached:(\w+)/.exec(error.message ?? "");
  const key = match?.[1];
  return key && (PLAN_LIMIT_KEYS as readonly string[]).includes(key) ? (key as PlanLimitKey) : null;
}

/**
 * The same refusal as planLimitError, for when the trigger caught what the
 * action's own check let through (two creates racing). Re-reads the plan so
 * the sentence names the right one; falls back to Free's cap.
 */
export async function planLimitErrorFromTrigger(accountId: string, key: PlanLimitKey): Promise<ActionError> {
  const billing = await readAccountBilling(accountId);
  const plan = billing.ok ? billing.billing.plan : "free";
  return planLimitReached(key, plan, PLANS[plan].limits[key] ?? 0);
}
