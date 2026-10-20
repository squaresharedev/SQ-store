// SERVER ONLY. THE DELETION JOB: carries out the account deletions people
// asked for, once their waiting period is over and nothing is owed to a buyer.
// Called on a schedule through app/api/cron/account-deletions.
//
// WHAT IT ACTS ON is account_deletion_requests, a table only this server
// writes (./requests.ts says why), never the flag on the profile.
//
// WHAT "DELETED" MEANS. The account's files leave storage, then the sign-in
// account is deleted, which takes everything that hangs off it with it
// (profile, products, storefronts, orders, team, notifications: every one of
// them references the account with ON DELETE CASCADE). Files go FIRST, and by
// what the rows point at: once a row is gone, nothing remembers which objects
// were its own.
//
// ONE ACCOUNT, A FEW STEPS AT A TIME. A Worker may make only so many outgoing
// requests while answering one, and an account can hold more files than that.
// So each run does a bounded amount of work on ONE account and says whether
// there is more, and the schedule calls again. Progress needs no bookkeeping:
// a product is deleted as soon as its files are, so what is left to do is
// simply what is still there.
//
// NO WAY BACK ONCE BEGUN. The first step stamps the request `started_at`, and
// "Keep my account" refuses a request that carries it.
//
// WHAT THE AUTOMATIC CONTENT CHECK REMEMBERED goes too: its record of a
// file (image:<key>, pdf:<key>), of the handle (handle:<name>) and of the
// picture (avatar:<url>) names the account or its files, so it is removed with
// them. Its record of a piece of TEXT is a fingerprint of the words and says
// nothing about who wrote them; it stays, so the same words are not judged
// twice. See forgetChecks.
//
// WHAT IS LEFT BEHIND, knowingly:
//   - files this person uploaded while working in SOMEONE ELSE's store: they
//     are that store's, and its rows still point at them;
//   - files uploaded and never attached to anything: unreachable (the bucket
//     is private and nothing signs a URL for a key no row holds), and not
//     swept here;
//   - the seller's connected Stripe account, which is Stripe's record of
//     payments already made, and anything Stripe keeps for a subscription.

import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { collectObjectKeys } from "@/lib/account-deletion/object-keys";
import { aftercareCutoff, deletionOutlook, deletionResting, dueCutoff } from "@/lib/account-deletion/policy";
import { readDeletionOrderFacts } from "@/lib/account-deletion/requests";
import { sendAccountDeletedEmail } from "@/lib/account-deletion/emails";
import { alertOps } from "@/lib/ops/alert";
import { deleteObject, hasR2Credentials } from "@/lib/r2";
import { AVATAR_BUCKET } from "@/lib/settings/constants";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** The most stored files removed and row batches deleted in one run. Sized so
 *  a run stays well inside a Worker's limit on outgoing requests. */
const OPERATION_BUDGET = 25;
/** Due requests read per run, and how many of them are looked at closely
 *  before the run gives up finding one that can go ahead. */
const DUE_PAGE = 50;
const CANDIDATES_PER_RUN = 3;
/** Rows of one kind read at a time while an account is taken apart. */
const ROW_PAGE = 10;
/** The most rows of the hold screen: see screenHeld. */
const SCREEN_ROWS = 1000;

export type DeletionRunResult = {
  /** Accounts deleted in this run (0 or 1). */
  deleted: number;
  /** An account was worked on and is not finished yet. */
  inProgress: number;
  /** Due requests that are waiting on the seller's orders. */
  held: number;
  /** Accounts whose deletion hit an error, in this run or a recent one. Each
   *  rests a while (DELETION_RETRY_HOURS), then is tried again. */
  failed: number;
  /** There is more to do right now: call again. */
  more: boolean;
};

/** A step that could not be finished, with a short code that is safe to store
 *  and to alert on (never a message that might quote data). */
class DeletionStepError extends Error {
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(`${step}: ${detail}`);
  }
}

function must<T>(step: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new DeletionStepError(step, result.error.message);
  return result.data;
}

/**
 * The due sellers who plainly still owe a buyer something, in one read.
 *
 * A SCREEN, not the decision: it spares a closer look at accounts that are
 * obviously waiting. The account that is about to be deleted is always checked
 * again on its own (readDeletionOrderFacts), because this read is capped, and
 * one busy seller's rows could fill it and hide another's.
 */
async function screenHeld(admin: Admin, userIds: string[], now: Date): Promise<Set<string>> {
  const rows = must(
    "screen",
    await admin
      .from("orders")
      .select("seller_id")
      .in("seller_id", userIds)
      .or(
        [
          "status.in.(pending,disputed)",
          "and(status.eq.paid,fulfilment_status.eq.unfulfilled)",
          `and(status.eq.paid,created_at.gte.${aftercareCutoff(now).toISOString()})`,
          `and(status.eq.paid,shipped_at.gte.${aftercareCutoff(now).toISOString()})`,
        ].join(","),
      )
      .limit(SCREEN_ROWS),
  );
  return new Set((rows ?? []).map((row) => row.seller_id));
}

/** Remove stored files. In production an account with files and no storage
 *  credentials is a misconfiguration to stop on, not a reason to delete the
 *  rows and strand the files; a development server has no bucket to empty. */
async function removeFiles(keys: Iterable<string>): Promise<void> {
  const list = [...keys];
  if (list.length === 0) return;
  if (!hasR2Credentials()) {
    if (process.env.NODE_ENV === "production") throw new DeletionStepError("files", "storage is not configured");
    return;
  }
  for (const key of list) {
    try {
      await deleteObject(key);
    } catch (error) {
      throw new DeletionStepError("files", error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * Forget what the automatic content check remembered about these subjects.
 * Best-effort, like the avatar: a record that cannot be removed now is not a
 * reason to keep an account, and an object that was never checked has none.
 * Quiet before the check's migration exists (there is no table to clear).
 */
async function forgetChecks(admin: Admin, subjects: string[]): Promise<void> {
  for (let at = 0; at < subjects.length; at += 50) {
    try {
      const { error } = await admin
        .from("moderation_checks")
        .delete()
        .in("subject", subjects.slice(at, at + 50));
      if (error && error.code !== "PGRST205" && error.code !== "42P01") {
        console.warn("[account deletion] content check records were not removed:", error.message);
      }
    } catch (error) {
      console.warn(
        "[account deletion] content check records were not removed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** The approved-list subjects that name these stored files. */
const fileSubjects = (keys: Iterable<string>): string[] =>
  [...keys].flatMap((key) => [`image:${key}`, `pdf:${key}`]);

/** How much of the run's budget is left, counted down as work is done. */
type Budget = { left: number; spent: number };

/**
 * Delete the account's rows of one kind, each after its files: read a page,
 * remove the files of as many rows as the budget allows, delete those rows in
 * one statement, and go round again. True when none are left.
 */
async function emptyTable(
  admin: Admin,
  table: "products" | "storefronts",
  userId: string,
  budget: Budget,
): Promise<boolean> {
  for (;;) {
    const rows = must(
      table,
      await admin.from(table).select("*").eq("owner_id", userId).order("id").limit(ROW_PAGE),
    ) as { id: string }[];
    if (rows.length === 0) return true;

    const done: string[] = [];
    for (const row of rows) {
      const keys = collectObjectKeys(row);
      // The first piece of work in a run is always done, whatever it costs,
      // or one row with many files could never be got past.
      if (budget.spent > 0 && keys.size + 1 > budget.left) break;
      await removeFiles(keys);
      await forgetChecks(admin, fileSubjects(keys));
      budget.left -= keys.size;
      budget.spent += keys.size;
      done.push(row.id);
    }
    if (done.length > 0) {
      must(table, await admin.from(table).delete().in("id", done).eq("owner_id", userId));
      budget.left -= 1;
      budget.spent += 1;
    }
    if (done.length < rows.length || budget.left <= 0) return false;
  }
}

/**
 * The files a seller's ORDERS still point at: the download as it was when it
 * was bought, which can outlive the product's current file. True when none are
 * left.
 */
async function emptyOrderFiles(admin: Admin, userId: string, budget: Budget): Promise<boolean> {
  for (;;) {
    const rows = must(
      "order files",
      await admin
        .from("orders")
        .select("digital_file_key")
        .eq("seller_id", userId)
        .not("digital_file_key", "is", null)
        .limit(ROW_PAGE * 5),
    );
    const keys = [...new Set((rows ?? []).flatMap((row) => (row.digital_file_key ? [row.digital_file_key] : [])))];
    if (keys.length === 0) return true;

    const batch = keys.slice(0, Math.max(1, budget.left - 1));
    const batchKeys = collectObjectKeys(batch);
    await removeFiles(batchKeys);
    await forgetChecks(admin, fileSubjects(batchKeys));
    must(
      "order files",
      await admin.from("orders").update({ digital_file_key: null }).eq("seller_id", userId).in("digital_file_key", batch),
    );
    budget.left -= batch.length + 1;
    budget.spent += batch.length + 1;
    if (batch.length < keys.length || budget.left <= 0) return false;
  }
}

/** The profile photo, in its own storage bucket. Best-effort: a photo that
 *  cannot be removed is not a reason to keep an account. */
async function removeAvatar(admin: Admin, userId: string): Promise<void> {
  try {
    const { data } = await admin.storage.from(AVATAR_BUCKET).list(userId);
    if (data?.length) {
      await admin.storage.from(AVATAR_BUCKET).remove(data.map((object) => `${userId}/${object.name}`));
    }
  } catch (error) {
    console.warn("[account deletion] avatar was not removed:", error instanceof Error ? error.message : error);
  }
}

/**
 * Take one account apart. "deleted" when it is gone; "more" when the budget
 * ran out first and the next run carries on from what is left.
 */
async function deleteAccount(
  admin: Admin,
  userId: string,
  requestedAt: string,
  budget: Budget,
): Promise<"deleted" | "more"> {
  if (!(await emptyTable(admin, "products", userId, budget))) return "more";
  if (!(await emptyTable(admin, "storefronts", userId, budget))) return "more";
  if (!(await emptyOrderFiles(admin, userId, budget))) return "more";
  await removeAvatar(admin, userId);

  // Who to tell, and what the content check remembered by name, read while
  // there is still a profile to read it from.
  const [account, profile] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("locale, username, avatar_url").eq("id", userId).maybeSingle(),
  ]);
  await forgetChecks(
    admin,
    [
      profile.data?.username ? `handle:${profile.data.username.toLowerCase()}` : null,
      profile.data?.avatar_url ? `avatar:${profile.data.avatar_url}` : null,
    ].filter((subject): subject is string => subject !== null),
  );
  const email = account.data.user?.email ?? null;
  const locale = parseLocale(profile.data?.locale) ?? DEFAULT_LOCALE;

  const removed = await admin.auth.admin.deleteUser(userId);
  if (removed.error) throw new DeletionStepError("account", removed.error.message);

  // Only once it is true.
  if (email) await sendAccountDeletedEmail(email, locale, requestedAt);
  console.warn(`[account deletion] DELETED user=${userId} requested=${requestedAt}`);
  return "deleted";
}

/** Note a failure on the request, and tell a person the first time it is seen
 *  (or when the reason changes), not every day it persists. */
async function recordFailure(admin: Admin, userId: string, previous: string | null, error: unknown): Promise<void> {
  const step = error instanceof DeletionStepError ? error.step : "unexpected";
  console.error("[account deletion] failed:", userId, error instanceof Error ? error.message : error);
  await admin
    .from("account_deletion_requests")
    .update({ last_attempt_at: new Date().toISOString(), last_error: step })
    .eq("user_id", userId);
  if (previous !== step) await alertOps("An account deletion could not be finished", { user: userId, step });
}

/**
 * Do one run's worth of deleting. Never throws for a single account's failure
 * (it is recorded and the run moves on); throws only when the run cannot even
 * tell what is due.
 */
export async function runAccountDeletions(now: Date = new Date()): Promise<DeletionRunResult> {
  const admin = createAdminClient();
  const result: DeletionRunResult = { deleted: 0, inProgress: 0, held: 0, failed: 0, more: false };

  const due = must(
    "due",
    await admin
      .from("account_deletion_requests")
      .select("user_id, requested_at, started_at, last_attempt_at, last_error")
      .lte("requested_at", dueCutoff(now).toISOString())
      // One already under way first: finish what was begun.
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("requested_at", { ascending: true })
      .limit(DUE_PAGE),
  );
  if (!due || due.length === 0) return result;

  // One that failed a short while ago rests. Tried again at once it would fail
  // again, and being first in line it would keep every other request waiting.
  const open = due.filter((request) => !deletionResting(request.last_attempt_at, request.last_error, now));
  result.failed = due.length - open.length;
  if (open.length === 0) return result;

  const screened = await screenHeld(
    admin,
    open.map((request) => request.user_id),
    now,
  );
  // A deletion that has begun is past its holds: it is finished, not weighed again.
  const waiting = open.filter((request) => request.started_at === null && screened.has(request.user_id));
  const candidates = open.filter((request) => request.started_at !== null || !screened.has(request.user_id));
  result.held = waiting.length;

  const budget: Budget = { left: OPERATION_BUDGET, spent: 0 };
  let examined = 0;
  let stopped = false;
  for (const request of candidates.slice(0, CANDIDATES_PER_RUN)) {
    examined += 1;
    try {
      if (request.started_at === null) {
        // THE DECISION, on this account's own orders, at this moment.
        const facts = await readDeletionOrderFacts(admin, request.user_id, now);
        if (!facts) throw new DeletionStepError("orders", "could not be read");
        if (!deletionOutlook(request.requested_at, facts, now).ready) {
          result.held += 1;
          continue;
        }
        // Begun: from here "Keep my account" refuses. Conditional, so a
        // request withdrawn a moment ago is not resurrected.
        const begun = must(
          "begin",
          await admin
            .from("account_deletion_requests")
            .update({ started_at: now.toISOString() })
            .eq("user_id", request.user_id)
            .is("started_at", null)
            .select("user_id"),
        );
        if (!begun || begun.length === 0) continue;
      }

      const outcome = await deleteAccount(admin, request.user_id, request.requested_at, budget);
      if (outcome === "deleted") result.deleted += 1;
      else result.inProgress += 1;
    } catch (error) {
      result.failed += 1;
      stopped = true;
      // Stamped with the time of the attempt: it rests from here, and the
      // next run starts with the account after it.
      await recordFailure(admin, request.user_id, request.last_error, error);
    }
    // One account per run: the budget is a run's, and it has been drawn on.
    if (budget.spent > 0 || stopped) break;
  }

  result.more = result.inProgress > 0 || candidates.length > examined;
  return result;
}
