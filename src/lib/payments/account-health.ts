import type { AccountStatus } from "./types";

/**
 * True when Stripe can take payments for the seller and send payouts, with
 * nothing outstanding. A page may then reduce the connection to a one-line
 * status; anything else (not connected, unfinished, a requirement due) keeps
 * the full card at the top, because it is what the seller has to act on.
 */
export function accountIsInOrder(account: AccountStatus): boolean {
  return (
    account.connected &&
    account.chargesEnabled &&
    account.payoutsEnabled &&
    account.requirementsDue.length === 0
  );
}
