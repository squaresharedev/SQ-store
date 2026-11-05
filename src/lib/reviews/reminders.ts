// WHEN A BUYER IS ASKED FOR A REVIEW, and the one reminder email they can ask
// for. Pure: the order page (which offers it), the reminder route (which
// records the buyer's choice) and the daily job (which sends it) all ask these
// functions, so the three cannot disagree.
//
// AFTER THEY HAVE IT, NOT AFTER THEY PAID. A buyer straight off the payment
// page has nothing to review yet. So the order page asks once the goods are
// with them: a parcel once the seller has marked it shipped, a download from
// any visit after the thank-you. Before that it offers a reminder instead.
//
// THE REMINDER IS OPT-IN, and that is the law, not a nicety. Asking a customer
// by email for a review is direct marketing in the EU (ePrivacy Directive art.
// 13; the German Federal Court of Justice held exactly this of a review request
// tucked into an invoice email, BGH VI ZR 225/17), which needs prior consent;
// CASL (Canada) and CAN-SPAM (US) want the sender named, a postal address and
// a way to stop. So: nobody is emailed who did not press "Email me a
// reminder" on their own order page, they get ONE email, it says who sent it
// and why, and every way of stopping it works (the page, the email's link, and
// the mail client's one-click unsubscribe). The confirmation email, which is
// the contract's durable record, never asks.
//
// NOBODY IS PICKED. Every buyer whose order can be reviewed is offered the
// same thing, whatever they paid or whoever they are, and nothing is offered
// in return for a review (EU UCPD annex I 23b-c; the US FTC's review rule,
// 16 CFR 465): asking only the people likely to be pleased would make the
// stars a lie.

import type { BuyerOrder } from "@/types/checkout";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The reminder's clock, in days. */
export const REVIEW_REMINDER_DAYS = {
  /** After "shipped", standing in for "it has arrived and been used a little":
   *  nobody records delivery. */
  afterShipped: 7,
  /** After buying a download, which the buyer has at once. */
  afterDownload: 3,
  /** At least this long between asking for a reminder and getting it, so one
   *  asked for late does not land the next morning. */
  minDelay: 3,
  /** How long after shipping (or buying a download) a reminder can still be
   *  asked for. A parcel not yet sent can always have one. */
  offer: 30,
  /** A reminder the job could not send within this long of falling due is let
   *  go rather than sent late (mail was off, or kept failing). */
  grace: 14,
} as const;

/** The orders columns these rules read. */
export type ReminderOrder = {
  fulfilment_status: string;
  shipped_at: string | null;
  created_at: string;
  review_reminder_requested_at: string | null;
  review_reminder_stopped_at: string | null;
  review_reminder_sent_at: string | null;
  review_reminder_dropped_at: string | null;
};

/** What the order page shows of the reminder: not asked for (or stopped),
 *  asked for, or already sent. */
export type ReminderStatus = NonNullable<BuyerOrder["reviewReminder"]>["status"];

const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY_MS);

/**
 * Whether the buyer has the goods, so their order page asks for the review
 * itself: a parcel once it is shipped, a download on any visit but the
 * thank-you straight after paying (`placed`).
 */
export function buyerHasGoods(order: { isDigital: boolean; fulfilment: string }, placed: boolean): boolean {
  return order.isDigital ? !placed : order.fulfilment === "shipped";
}

/** When the goods count as settled in: a week after shipping, three days
 *  after a download. Null while a parcel has not been sent. */
function settledAt(order: ReminderOrder): Date | null {
  if (order.fulfilment_status === "not_required") return plusDays(order.created_at, REVIEW_REMINDER_DAYS.afterDownload);
  if (order.fulfilment_status === "shipped" && order.shipped_at) {
    return plusDays(order.shipped_at, REVIEW_REMINDER_DAYS.afterShipped);
  }
  return null;
}

/**
 * When the reminder falls due: once the goods have settled in, and at least
 * {@link REVIEW_REMINDER_DAYS.minDelay} days after it was asked for. Null while
 * a parcel has not been sent, or nothing was asked for.
 */
export function reviewReminderDueAt(order: ReminderOrder): Date | null {
  const settled = settledAt(order);
  if (!settled || !order.review_reminder_requested_at) return null;
  const earliest = plusDays(order.review_reminder_requested_at, REVIEW_REMINDER_DAYS.minDelay);
  return settled > earliest ? settled : earliest;
}

/** The due date as a buyer is told it: never in the past, since one already
 *  due goes with the job's next run. Null while a parcel has not been sent. */
export function reviewReminderShownDue(order: ReminderOrder, now: Date): string | null {
  const due = reviewReminderDueAt(order);
  return due ? new Date(Math.max(due.getTime(), now.getTime())).toISOString() : null;
}

/** A reminder that fell due more than {@link REVIEW_REMINDER_DAYS.grace} days
 *  ago: let go, not sent late. */
export function reviewReminderLate(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime() + REVIEW_REMINDER_DAYS.grace * DAY_MS;
}

/** Where the order's reminder stands. Null once the job has let it go. */
export function reviewReminderStatus(order: ReminderOrder): ReminderStatus | null {
  if (order.review_reminder_sent_at) return "sent";
  if (order.review_reminder_dropped_at) return null;
  return order.review_reminder_requested_at && !order.review_reminder_stopped_at ? "on" : "off";
}

/**
 * Whether a buyer may ask for the reminder now: it has not been sent or let
 * go, and the goods are not long settled (a parcel not yet sent always may).
 */
export function reviewReminderOffered(order: ReminderOrder, now: Date): boolean {
  if (order.review_reminder_sent_at || order.review_reminder_dropped_at) return false;
  if (order.fulfilment_status === "not_required") {
    return now <= plusDays(order.created_at, REVIEW_REMINDER_DAYS.offer);
  }
  if (order.fulfilment_status === "shipped") {
    return order.shipped_at !== null && now <= plusDays(order.shipped_at, REVIEW_REMINDER_DAYS.offer);
  }
  return true;
}

/**
 * The job's queue cut-offs for `now`: a parcel shipped, and a download bought,
 * on or before these, both asked for on or before `requestedBy`, is due. Exact,
 * because the due date is the later of two dates and "the later one has
 * passed" is "both have".
 */
export function reviewReminderCutoffs(now: Date): { shippedBy: string; boughtBy: string; requestedBy: string } {
  const back = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  return {
    shippedBy: back(REVIEW_REMINDER_DAYS.afterShipped),
    boughtBy: back(REVIEW_REMINDER_DAYS.afterDownload),
    requestedBy: back(REVIEW_REMINDER_DAYS.minDelay),
  };
}

/** `?review=` on a buyer's order page, as the reminder email links it: open
 *  the review dialog, or the dialog that stops the reminder. */
export const REVIEW_DIALOGS = ["write", "stop"] as const;
export type ReviewDialog = (typeof REVIEW_DIALOGS)[number];

export function parseReviewDialog(value: string | undefined): ReviewDialog | null {
  return (REVIEW_DIALOGS as readonly string[]).includes(value ?? "") ? (value as ReviewDialog) : null;
}
