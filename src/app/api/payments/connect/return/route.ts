import { appUrl } from "@/lib/app-url";
import { signInPath } from "@/lib/auth/paths";
import { PAYMENTS_PATH } from "@/lib/dashboard/paths";
import { refreshPaymentAccount } from "@/lib/payments/connect/account";
import { stripeConnectLive } from "@/lib/payments/connect/config";
import { getActiveAccount } from "@/lib/team/account-context";

/**
 * GET /api/payments/connect/return: where Stripe sends a seller back to, both
 * when they finish its hosted onboarding and when its link has expired.
 *
 * It does not trust either arrival to mean anything. It asks Stripe where the
 * account stands, records the answer, and lands on Payments, which then shows
 * what is true: connected, or still needing something. So the page is right
 * the moment the seller sees it, rather than whenever the account.updated
 * event happens to arrive.
 *
 * Nothing here can be made to act on another store: the account refreshed is
 * the signed-in owner's own, read from our row, and no id is taken from the
 * request.
 */
export const dynamic = "force-dynamic";

const to = (path: string) => Response.redirect(appUrl(path), 303);

export async function GET() {
  const account = await getActiveAccount();
  if (!account) return to(signInPath(PAYMENTS_PATH));

  if (account.isOwner && stripeConnectLive()) {
    try {
      await refreshPaymentAccount(account.accountId);
    } catch (error) {
      // The page still loads, on what we last knew; the event will catch up.
      console.error("[payments] refreshing the account failed:", error instanceof Error ? error.message : error);
    }
  }
  return to(PAYMENTS_PATH);
}
