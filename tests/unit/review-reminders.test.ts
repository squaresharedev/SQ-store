// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REVIEW_REMINDER_DAYS,
  buyerHasGoods,
  parseReviewDialog,
  reviewReminderCutoffs,
  reviewReminderDueAt,
  reviewReminderLate,
  reviewReminderOffered,
  reviewReminderShownDue,
  reviewReminderStatus,
  type ReminderOrder,
} from "@/lib/reviews/reminders";
import { orderReviewState } from "@/lib/reviews/eligibility";

// When a buyer is asked for a review, and the one reminder email they can ask
// for (lib/reviews/reminders.ts): after they have the goods, never before.

const DAY = 24 * 60 * 60 * 1000;
const PLACED = "2026-10-01T10:00:00.000Z";
const at = (days: number) => new Date(new Date(PLACED).getTime() + days * DAY);
const iso = (days: number) => at(days).toISOString();

function parcel(overrides: Partial<ReminderOrder> = {}): ReminderOrder {
  return {
    fulfilment_status: "unfulfilled",
    shipped_at: null,
    created_at: PLACED,
    review_reminder_requested_at: null,
    review_reminder_stopped_at: null,
    review_reminder_sent_at: null,
    review_reminder_dropped_at: null,
    ...overrides,
  };
}
const download = (overrides: Partial<ReminderOrder> = {}) => parcel({ fulfilment_status: "not_required", ...overrides });

describe("when the order page asks for the review itself", () => {
  it("asks for a parcel once it has shipped, never on the thank-you before", () => {
    expect(buyerHasGoods({ isDigital: false, fulfilment: "unfulfilled" }, true)).toBe(false);
    expect(buyerHasGoods({ isDigital: false, fulfilment: "unfulfilled" }, false)).toBe(false);
    expect(buyerHasGoods({ isDigital: false, fulfilment: "shipped" }, false)).toBe(true);
  });

  it("asks for a download on any visit but the one straight after paying", () => {
    expect(buyerHasGoods({ isDigital: true, fulfilment: "not_required" }, true)).toBe(false);
    expect(buyerHasGoods({ isDigital: true, fulfilment: "not_required" }, false)).toBe(true);
  });
});

describe("when the reminder falls due", () => {
  it("is never, while nothing was asked for or the parcel has not gone", () => {
    expect(reviewReminderDueAt(parcel())).toBeNull();
    expect(reviewReminderDueAt(parcel({ review_reminder_requested_at: PLACED }))).toBeNull();
  });

  it("is a week after shipping for a parcel asked for on the thank-you", () => {
    const order = parcel({ review_reminder_requested_at: PLACED, fulfilment_status: "shipped", shipped_at: iso(2) });
    expect(reviewReminderDueAt(order)).toEqual(at(2 + REVIEW_REMINDER_DAYS.afterShipped));
  });

  it("is three days after buying a download", () => {
    expect(reviewReminderDueAt(download({ review_reminder_requested_at: PLACED }))).toEqual(
      at(REVIEW_REMINDER_DAYS.afterDownload),
    );
  });

  it("never lands the morning after a late request", () => {
    const order = parcel({ review_reminder_requested_at: iso(20), fulfilment_status: "shipped", shipped_at: iso(2) });
    expect(reviewReminderDueAt(order)).toEqual(at(20 + REVIEW_REMINDER_DAYS.minDelay));
  });

  it("is told to the buyer as today at the earliest, never a day gone by", () => {
    const order = parcel({ review_reminder_requested_at: PLACED, fulfilment_status: "shipped", shipped_at: iso(2) });
    expect(reviewReminderShownDue(order, at(30))).toBe(iso(30));
    expect(reviewReminderShownDue(order, at(3))).toBe(iso(9));
  });

  it("is let go rather than sent late", () => {
    expect(reviewReminderLate(at(9), at(9 + REVIEW_REMINDER_DAYS.grace))).toBe(false);
    expect(reviewReminderLate(at(9), at(9 + REVIEW_REMINDER_DAYS.grace + 1))).toBe(true);
  });

  it("gives the job cut-offs under which exactly the due reminders fall", () => {
    const now = at(20);
    const cut = reviewReminderCutoffs(now);
    const due = (order: ReminderOrder) => {
      const shippedOk = order.fulfilment_status === "shipped" && order.shipped_at! <= cut.shippedBy;
      const boughtOk = order.fulfilment_status === "not_required" && order.created_at <= cut.boughtBy;
      return order.review_reminder_requested_at! <= cut.requestedBy && (shippedOk || boughtOk);
    };
    const orders = [
      parcel({ review_reminder_requested_at: PLACED, fulfilment_status: "shipped", shipped_at: iso(13) }),
      parcel({ review_reminder_requested_at: PLACED, fulfilment_status: "shipped", shipped_at: iso(14) }),
      parcel({ review_reminder_requested_at: iso(17), fulfilment_status: "shipped", shipped_at: iso(2) }),
      parcel({ review_reminder_requested_at: iso(18), fulfilment_status: "shipped", shipped_at: iso(2) }),
      download({ review_reminder_requested_at: iso(16) }),
      download({ review_reminder_requested_at: iso(18) }),
    ];
    for (const order of orders) {
      expect(due(order)).toBe(reviewReminderDueAt(order)!.getTime() <= now.getTime());
    }
  });
});

describe("what the order page shows of it", () => {
  it("reads off, on, sent, or nothing once the job let it go", () => {
    expect(reviewReminderStatus(parcel())).toBe("off");
    expect(reviewReminderStatus(parcel({ review_reminder_requested_at: PLACED }))).toBe("on");
    expect(reviewReminderStatus(parcel({ review_reminder_requested_at: PLACED, review_reminder_stopped_at: iso(1) }))).toBe(
      "off",
    );
    expect(reviewReminderStatus(parcel({ review_reminder_requested_at: PLACED, review_reminder_sent_at: iso(9) }))).toBe("sent");
    expect(
      reviewReminderStatus(parcel({ review_reminder_requested_at: PLACED, review_reminder_dropped_at: iso(9) })),
    ).toBeNull();
  });

  it("can be asked for while a parcel waits, and for a month after it ships", () => {
    expect(reviewReminderOffered(parcel(), at(90))).toBe(true);
    const shipped = parcel({ fulfilment_status: "shipped", shipped_at: iso(2) });
    expect(reviewReminderOffered(shipped, at(2 + REVIEW_REMINDER_DAYS.offer))).toBe(true);
    expect(reviewReminderOffered(shipped, at(3 + REVIEW_REMINDER_DAYS.offer))).toBe(false);
    expect(reviewReminderOffered(download(), at(REVIEW_REMINDER_DAYS.offer + 1))).toBe(false);
  });

  it("cannot be asked for again once sent or let go", () => {
    expect(reviewReminderOffered(parcel({ review_reminder_requested_at: PLACED, review_reminder_sent_at: iso(1) }), at(1))).toBe(false);
    expect(reviewReminderOffered(parcel({ review_reminder_requested_at: PLACED, review_reminder_dropped_at: iso(1) }), at(1))).toBe(
      false,
    );
  });

  it("opens only the two dialogs the email links to", () => {
    expect(parseReviewDialog("write")).toBe("write");
    expect(parseReviewDialog("stop")).toBe("stop");
    expect(parseReviewDialog("delete")).toBeNull();
    expect(parseReviewDialog(undefined)).toBeNull();
  });
});

describe("whether the order is open to a review", () => {
  const paid = { status: "paid", refunded_at: null, product_id: "p" };
  const live = { status: "active", moderation_status: "ok" };

  it("is open for a paid order of a live product, done once reviewed", () => {
    expect(orderReviewState(paid, live, false)).toBe("open");
    expect(orderReviewState(paid, live, true)).toBe("done");
  });

  it("is closed for a refund, a deleted product, or one taken off sale", () => {
    expect(orderReviewState({ ...paid, refunded_at: iso(3) }, live, false)).toBe("closed");
    expect(orderReviewState({ ...paid, product_id: null }, null, false)).toBe("closed");
    expect(orderReviewState(paid, { ...live, status: "draft" }, false)).toBe("closed");
    expect(orderReviewState(paid, { ...live, moderation_status: "removed" }, false)).toBe("closed");
  });
});
