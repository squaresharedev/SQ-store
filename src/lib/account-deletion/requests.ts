// SERVER ONLY. The record a deletion is carried out from
// (account_deletion_requests, 20261010), and what the seller's orders say
// about whether it may go ahead yet.
//
// WHY A TABLE AND NOT THE PROFILE FLAG. profiles.deletion_requested_at is a
// column on a row its owner may update, so it can be written from outside the
// Settings page: without the two-factor step, and with a date in the past.
// This table is written only here, with the service role, after the action's
// own checks, and `requested_at` is this server's clock. The flag is still set
// alongside it, as what the seller's own pages have always read; nothing is
// deleted because of it.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  aftercareCutoff,
  deletionOutlook,
  type DeletionHold,
  type DeletionOrderFacts,
} from "@/lib/account-deletion/policy";

type Admin = ReturnType<typeof createAdminClient>;

export type DeletionRequest = {
  requestedAt: string;
  /** The deletion has begun and can no longer be withdrawn. */
  started: boolean;
};

/** The signed-in person's own request, or null when they have none. */
export async function readDeletionRequest(userId: string): Promise<DeletionRequest | null> {
  const { data, error } = await createAdminClient()
    .from("account_deletion_requests")
    .select("requested_at, started_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[account deletion] request read failed:", error.message);
    return null;
  }
  return data ? { requestedAt: data.requested_at, started: data.started_at !== null } : null;
}

/**
 * Record that this person asked for their account to be deleted. Asking twice
 * keeps the FIRST request's date: the waiting period is not restarted by a
 * second press, and cannot be shortened by one either. Returns the time the
 * request stands from, or null when it could not be recorded.
 */
export async function recordDeletionRequest(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("account_deletion_requests")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) {
    console.error("[account deletion] request write failed:", error.message);
    return null;
  }
  return (await readDeletionRequest(userId))?.requestedAt ?? null;
}

/**
 * Withdraw a request ("Keep my account"). Only one that has not begun: see
 * started_at in the migration. "gone" also covers a request that never
 * existed, which is the same answer to the person asking.
 */
export async function withdrawDeletionRequest(userId: string): Promise<"gone" | "started" | "failed"> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("account_deletion_requests")
    .delete()
    .eq("user_id", userId)
    .is("started_at", null);
  if (error) {
    console.error("[account deletion] request withdrawal failed:", error.message);
    return "failed";
  }
  const { data: left, error: readError } = await admin
    .from("account_deletion_requests")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return "failed";
  return left ? "started" : "gone";
}

/**
 * What this seller's orders say about deleting their account now. Null when
 * any of the reads failed: a deletion is never carried out on a guess.
 */
export async function readDeletionOrderFacts(
  admin: Admin,
  userId: string,
  now: Date = new Date(),
): Promise<DeletionOrderFacts | null> {
  const count = (status: string) =>
    admin.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", status);
  // The newest paid order by `column`, when it is recent enough to hold the
  // deletion (anything older is of no interest).
  const newestPaid = (column: "created_at" | "shipped_at") =>
    admin
      .from("orders")
      .select(column)
      .eq("seller_id", userId)
      .eq("status", "paid")
      .gte(column, aftercareCutoff(now).toISOString())
      .order(column, { ascending: false })
      .limit(1)
      .maybeSingle();
  const [toShip, pending, disputed, lastSale, lastShipped] = await Promise.all([
    count("paid").eq("fulfilment_status", "unfulfilled"),
    count("pending"),
    count("disputed"),
    newestPaid("created_at"),
    newestPaid("shipped_at"),
  ]);
  const failed = toShip.error ?? pending.error ?? disputed.error ?? lastSale.error ?? lastShipped.error;
  if (failed) {
    console.error("[account deletion] order facts read failed:", failed.message);
    return null;
  }
  return {
    toShip: toShip.count ?? 0,
    pending: pending.count ?? 0,
    disputed: disputed.count ?? 0,
    lastSaleAt: (lastSale.data as { created_at?: string } | null)?.created_at ?? null,
    lastShippedAt: (lastShipped.data as { shipped_at?: string | null } | null)?.shipped_at ?? null,
  };
}

/** Where the signed-in person's request stands, in a shape a page can be
 *  handed: dates as ISO strings. */
export type DeletionStatus = {
  requestedAt: string;
  started: boolean;
  deleteOn: string;
  holds: DeletionHold[];
  /** When the recent-sale hold lifts, when that is one of the holds. */
  aftercareEndsOn: string | null;
};

/** The Settings page's read: the request, and what stands in its way. Null
 *  when there is no request. */
export async function getDeletionStatus(userId: string): Promise<DeletionStatus | null> {
  const request = await readDeletionRequest(userId);
  if (!request) return null;
  const now = new Date();
  // A failed read shows the request without holds rather than no request: the
  // seller did ask, and the job checks again for itself before it deletes.
  const facts = (await readDeletionOrderFacts(createAdminClient(), userId, now)) ?? {
    toShip: 0,
    pending: 0,
    disputed: 0,
    lastSaleAt: null,
    lastShippedAt: null,
  };
  const outlook = deletionOutlook(request.requestedAt, facts, now);
  return {
    requestedAt: request.requestedAt,
    started: request.started,
    deleteOn: outlook.dueAt.toISOString(),
    holds: outlook.holds,
    aftercareEndsOn: outlook.aftercareEndsAt?.toISOString() ?? null,
  };
}
