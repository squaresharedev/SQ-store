// SERVER ONLY. Sends the review reminders that have fallen due: the one email
// a buyer asked for on their order page (the rules, and why it is opt-in, are
// in lib/reviews/reminders.ts). Run once a day by the scheduler
// (app/api/cron/review-reminders), which calls again while `more` is true.
//
// EVERY ROW IT READS IS SETTLED: sent, or let go (dropped) with nothing sent
// when the order can no longer be reviewed, was reviewed already, has nowhere
// to show the review, or fell due too long ago. So a run always moves on, and
// a reminder can never go to someone who has nothing left to review.
//
// AT MOST ONCE. A row is claimed (sent_at set, only where it is still empty and
// nobody has stopped it) before the email goes, and released again if the
// email does not: two runs at once, or a stop that lands mid-run, cannot send
// it twice or after the buyer said no.

import { createAdminClient } from "@/lib/supabase/admin";
import { emailSendingEnabled } from "@/lib/email/send";
import { cronConfigured } from "@/lib/ops/cron";
import { appUrl } from "@/lib/app-url";
import { orderRef } from "@/lib/orders/order-link";
import { parseOrderSelection } from "@/lib/orders/selection";
import { sendReviewReminder } from "@/lib/orders/emails";
import { orderReviewReminderUnsubscribePath } from "@/lib/checkout/paths";
import { orderPageUrl } from "@/lib/storefront/product-page-url";
import { buyerFacingStorefront } from "@/lib/storefront/buyer-face";
import { isProductPageSectionShown, resolveProductPage } from "@/lib/storefront/product-page";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { orderReviewState } from "@/lib/reviews/eligibility";
import {
  reviewReminderCutoffs,
  reviewReminderDueAt,
  reviewReminderLate,
  type ReminderOrder,
} from "@/lib/reviews/reminders";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import type { StorefrontSeller } from "@/types/storefront";

/** Emails in one run: a Worker request is bounded, and the scheduler calls
 *  again while the answer says `more`. */
const BATCH_SIZE = 20;

const QUEUE_SELECT =
  "id, storefront_id, seller_id, product_id, product_title, quantity, selected_options, status, refunded_at, buyer_email, buyer_locale, fulfilment_status, shipped_at, created_at, review_reminder_requested_at, review_reminder_stopped_at, review_reminder_sent_at, review_reminder_dropped_at" as const;

type QueuedOrder = ReminderOrder & {
  id: string;
  storefront_id: string | null;
  seller_id: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  selected_options: unknown;
  status: string;
  refunded_at: string | null;
  buyer_email: string | null;
  buyer_locale: string | null;
};

export type ReviewReminderRun = {
  /** False while mail is off: nothing was read or changed. */
  configured: boolean;
  sent: number;
  dropped: number;
  failed: number;
  /** Call again: this run took a full batch and nothing failed. */
  more: boolean;
};

/**
 * Whether a buyer can be offered the reminder at all: only where it can
 * actually be sent, by mail that is on and a schedule that runs. Promising an
 * email that nothing will send would be worse than not offering one.
 */
export function reviewRemindersAvailable(): boolean {
  return emailSendingEnabled() && cronConfigured();
}

/**
 * The buyer takes the reminder back: from their order page, the email's stop
 * link, or their mail client's one-click unsubscribe. Recorded when there was
 * something to take back; a no-op otherwise, and after the email went it
 * still records that they want no more. False only when the write failed.
 */
export async function stopReviewReminder(orderId: string): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("orders")
    .update({ review_reminder_stopped_at: new Date().toISOString() })
    .eq("id", orderId)
    .not("review_reminder_requested_at", "is", null)
    .is("review_reminder_stopped_at", null);
  if (error) console.error("[review-reminder] could not record the stop", error.message);
  return !error;
}

export async function runReviewReminders(now: Date = new Date()): Promise<ReviewReminderRun> {
  const run: ReviewReminderRun = { configured: emailSendingEnabled(), sent: 0, dropped: 0, failed: 0, more: false };
  if (!run.configured) return run;

  const admin = createAdminClient();
  const cut = reviewReminderCutoffs(now);
  const { data, error } = await admin
    .from("orders")
    .select(QUEUE_SELECT)
    .not("review_reminder_requested_at", "is", null)
    .is("review_reminder_sent_at", null)
    .is("review_reminder_dropped_at", null)
    .is("review_reminder_stopped_at", null)
    .lte("review_reminder_requested_at", cut.requestedBy)
    .or(
      `and(fulfilment_status.eq.shipped,shipped_at.lte."${cut.shippedBy}"),and(fulfilment_status.eq.not_required,created_at.lte."${cut.boughtBy}")`,
    )
    .order("review_reminder_requested_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`review reminder queue read failed: ${error.message}`);
  const queue = (data ?? []) as QueuedOrder[];
  if (queue.length === 0) return run;

  const ids = queue.map((order) => order.id);
  const productIds = [...new Set(queue.flatMap((order) => (order.product_id ? [order.product_id] : [])))];
  const storefrontIds = [...new Set(queue.flatMap((order) => (order.storefront_id ? [order.storefront_id] : [])))];
  const [reviews, products, storefronts] = await Promise.all([
    admin.from("reviews").select("order_id").in("order_id", ids),
    productIds.length
      ? admin.from("products").select("id, status, moderation_status").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    storefrontIds.length
      ? admin.from("storefronts").select("id, name, config, moderation_status").in("id", storefrontIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const readError = reviews.error ?? products.error ?? storefronts.error;
  if (readError) throw new Error(`review reminder read failed: ${readError.message}`);
  const reviewed = new Set((reviews.data ?? []).map((row) => row.order_id));
  const productById = new Map((products.data ?? []).map((row) => [row.id, row]));
  const storefrontById = new Map((storefronts.data ?? []).map((row) => [row.id, row]));
  const sellers = new Map<string, Promise<StorefrontSeller>>();
  const sellerFor = (id: string) => {
    if (!sellers.has(id)) sellers.set(id, getSellerIdentity(id));
    return sellers.get(id)!;
  };

  for (const order of queue) {
    const seller = await sellerFor(order.seller_id);
    const storefront = order.storefront_id ? storefrontById.get(order.storefront_id) : undefined;
    // The same shop face the order page shows, so "reviews are shown" means
    // what the buyer would see there.
    const face = storefront ? buyerFacingStorefront(storefront, seller.businessName) : null;
    const dueAt = reviewReminderDueAt(order);
    const sendable =
      dueAt !== null &&
      !reviewReminderLate(dueAt, now) &&
      order.buyer_email !== null &&
      orderReviewState(order, productById.get(order.product_id ?? "") ?? null, reviewed.has(order.id)) === "open" &&
      face !== null &&
      isProductPageSectionShown(resolveProductPage(face.config), "reviews");
    if (!sendable) {
      await admin
        .from("orders")
        .update({ review_reminder_dropped_at: now.toISOString() })
        .eq("id", order.id)
        .is("review_reminder_sent_at", null)
        .is("review_reminder_dropped_at", null);
      run.dropped += 1;
      continue;
    }

    const { data: claimed, error: claimError } = await admin
      .from("orders")
      .update({ review_reminder_sent_at: now.toISOString() })
      .eq("id", order.id)
      .is("review_reminder_sent_at", null)
      .is("review_reminder_dropped_at", null)
      .is("review_reminder_stopped_at", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(`review reminder claim failed: ${claimError.message}`);
    // Stopped, or taken by another run, since the queue was read.
    if (!claimed) continue;

    const ref = await orderRef(order.id);
    const result = ref
      ? await sendReviewReminder(order.buyer_email!, parseLocale(order.buyer_locale) ?? DEFAULT_LOCALE, {
          productTitle: order.product_title,
          quantity: order.quantity,
          selection: parseOrderSelection(order.selected_options),
          requestedAt: new Date(order.review_reminder_requested_at!),
          reviewUrl: orderPageUrl(order.storefront_id!, ref, "write"),
          stopUrl: orderPageUrl(order.storefront_id!, ref, "stop"),
          unsubscribeUrl: appUrl(orderReviewReminderUnsubscribePath(ref)),
          seller,
          store: { name: seller.businessName || face!.name, contactEmail: seller.email ?? null },
        })
      : ({ sent: false, reason: "failed" } as const);
    if (result.sent) {
      run.sent += 1;
      continue;
    }
    // Give it back for tomorrow's run, and stop here: mail that fails for one
    // buyer is usually failing for all of them.
    await admin.from("orders").update({ review_reminder_sent_at: null }).eq("id", order.id);
    run.failed += 1;
    return run;
  }

  run.more = queue.length === BATCH_SIZE;
  return run;
}
