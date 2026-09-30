// SERVER ONLY. What the account's own lifecycle does to its plan.

import { readAccountBilling } from "@/lib/billing/account-plan";
import { isLiveSubscription } from "@/lib/billing/entitlement";
import { getBillingProvider } from "@/lib/billing/providers";

/**
 * An owner asked for their account to be deleted: their paid plan must stop
 * renewing. It ends at the close of the period they already paid for (no
 * partial refunds, as the Terms say); the Stripe customer and its invoices
 * are KEPT, because invoices must be retained for years after an account is
 * gone.
 *
 * Never throws. "failed" is logged loudly for support to finish by hand: the
 * deletion request itself must not be refused because Stripe was down.
 */
export async function endPlanForDeletion(ownerId: string): Promise<"none" | "scheduled" | "failed"> {
  const billing = await readAccountBilling(ownerId);
  if (!billing.ok) {
    console.error(`[billing] deletion requested for ${ownerId}, but the plan could not be read; check it by hand`);
    return "failed";
  }
  const { customerId, subscriptionId, status, cancelAtPeriodEnd } = billing.billing;
  if (!customerId || !subscriptionId || !isLiveSubscription(status) || cancelAtPeriodEnd) return "none";

  const provider = getBillingProvider();
  if (!provider) {
    console.error(`[billing] deletion requested for ${ownerId} with a live subscription, but billing is not configured here`);
    return "failed";
  }
  try {
    await provider.scheduleCancellation(ownerId, customerId, subscriptionId);
    return "scheduled";
  } catch (error) {
    console.error(
      `[billing] could not end the plan of ${ownerId} after a deletion request; cancel it by hand:`,
      error instanceof Error ? error.message : error,
    );
    return "failed";
  }
}
