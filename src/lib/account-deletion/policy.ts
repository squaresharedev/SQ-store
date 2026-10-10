// WHEN AN ACCOUNT IS DELETED, as rules. Pure and client-safe: the deletion job
// (./run.ts) and the Settings page that tells a seller where their request
// stands ask the same functions, so the page can never promise a date the job
// would not keep.
//
// TWO WAITS, for two different people:
//   - the seller's: ACCOUNT_DELETION_GRACE_DAYS after they ask, in which
//     "Keep my account" undoes it. Deleting is the one thing in Settings that
//     cannot be taken back.
//   - their buyers': an account is not deleted out from under someone it still
//     owes something. Orders are deleted WITH the account (orders.seller_id
//     cascades), and with them the buyer's order page, their download and the
//     withdrawal form on it. So the deletion holds while a parcel is owed, a
//     payment is in flight or in dispute, and for ORDER_AFTERCARE_DAYS after
//     the last sale.

/** Days between asking and deletion, in which the seller can change their mind. */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;

/**
 * Days after a seller's last sale in which their account is kept. Longer than
 * the 14-day withdrawal period plus a delivery, so a buyer's order page
 * outlives every right they exercise on it.
 */
export const ORDER_AFTERCARE_DAYS = 30;

/**
 * Hours a deletion that failed is left alone before it is tried again. What
 * stops one is rarely the account itself (storage is down, a secret is
 * missing), so trying again at once fails again, and while it is being tried
 * nothing queued behind it is. Shorter than a day, so the daily run retries.
 */
export const DELETION_RETRY_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Why a deletion that is due is not being carried out yet. */
export const DELETION_HOLDS = ["toShip", "paymentPending", "disputed", "recentSale"] as const;
export type DeletionHold = (typeof DELETION_HOLDS)[number];

/** What the seller's orders say, as the job and the page both read it. */
export type DeletionOrderFacts = {
  /** Paid orders with something still to send. */
  toShip: number;
  /** Orders waiting on a payment. */
  pending: number;
  /** Orders whose payment is disputed. */
  disputed: number;
  /** ISO time of the newest paid order, or null when there is none. */
  lastSaleAt: string | null;
};

export type DeletionOutlook = {
  /** The end of the seller's own waiting period. */
  dueAt: Date;
  /** What else is in the way, most pressing first. Empty when nothing is. */
  holds: DeletionHold[];
  /** When the recent-sale hold lifts, when that is what is in the way. */
  aftercareEndsAt: Date | null;
  /** Due, and nothing in the way. */
  ready: boolean;
};

/** The end of the waiting period for a request made at `requestedAt`. */
export function deletionDueAt(requestedAt: string | Date): Date {
  return new Date(new Date(requestedAt).getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
}

/** Where a deletion request stands, as of `now`. */
export function deletionOutlook(
  requestedAt: string | Date,
  facts: DeletionOrderFacts,
  now: Date = new Date(),
): DeletionOutlook {
  const dueAt = deletionDueAt(requestedAt);
  const aftercareEndsAt = facts.lastSaleAt
    ? new Date(new Date(facts.lastSaleAt).getTime() + ORDER_AFTERCARE_DAYS * DAY_MS)
    : null;
  const recent = aftercareEndsAt !== null && aftercareEndsAt.getTime() > now.getTime();

  const holds: DeletionHold[] = [
    ...(facts.toShip > 0 ? (["toShip"] as const) : []),
    ...(facts.pending > 0 ? (["paymentPending"] as const) : []),
    ...(facts.disputed > 0 ? (["disputed"] as const) : []),
    ...(recent ? (["recentSale"] as const) : []),
  ];
  return {
    dueAt,
    holds,
    aftercareEndsAt: recent ? aftercareEndsAt : null,
    ready: holds.length === 0 && dueAt.getTime() <= now.getTime(),
  };
}

/** The oldest request time that is due as of `now`: requests at or before it
 *  have served their waiting period. */
export function dueCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
}

/**
 * Whether a request whose last attempt failed is still resting as of `now`
 * (DELETION_RETRY_HOURS). A resting request is passed over, so the run moves
 * on to the next account instead of failing on the same one again.
 */
export function deletionResting(lastAttemptAt: string | null, lastError: string | null, now: Date = new Date()): boolean {
  if (!lastAttemptAt || !lastError) return false;
  return now.getTime() - new Date(lastAttemptAt).getTime() < DELETION_RETRY_HOURS * HOUR_MS;
}

/** The oldest sale time that still holds a deletion as of `now`. */
export function aftercareCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ORDER_AFTERCARE_DAYS * DAY_MS);
}
