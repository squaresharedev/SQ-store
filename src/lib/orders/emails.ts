// SERVER ONLY. The two emails an order sends, and nothing else.
//
//   1. "Ship this" to the SELLER when an order lands (lib/orders/record.ts):
//      everything needed to pack and address the parcel without opening the
//      dashboard, plus one link to the order to mark it shipped.
//   2. "It's on its way" to the BUYER when the seller marks it shipped, or
//      adds a tracking number afterwards (lib/orders/actions.ts).
//
// PLAIN TEXT, like every other mail this app sends (lib/security/events.ts):
// an order email is read on a phone next to a pile of boxes, and it has to
// work in any mail client.
//
// IN THE READER'S LANGUAGE, which is never the language of the request that
// sends it: the seller's chosen UI language for (1), the language the buyer
// checked out in for (2). Hence translatorFor rather than getTranslations.
//
// NOT MERCHANT OF RECORD. Mail to a buyer is sent on the SELLER's behalf: it
// arrives as "<store> via Square Share", and replies go to the seller's own
// contact address, because the seller is who the buyer bought from and who
// answers questions about the goods (see components/product-page/ProductCta.tsx).

import { appUrl } from "@/lib/app-url";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { formatCents } from "@/lib/format/money";
import { regionName } from "@/lib/format/country";
import { orderDetailPath } from "@/lib/orders/paths";
import { formatOrderSelection } from "@/lib/orders/selection";
import { formatShipTo } from "@/lib/orders/ship-to";
import { translatorFor, type Translate } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import type { OrderSelection, ShipTo } from "@/types/order-view";

/** What both emails say about the goods. */
type Goods = {
  productTitle: string;
  quantity: number;
  selection: readonly OrderSelection[];
};

/** "2 × Blue mug" and, when there is one, the version under it: the same two
 *  lines the order panel shows under What to pack. */
function packLines(t: Translate, goods: Goods): string[] {
  const lines = [t("Orders.detail.packLine", { quantity: goods.quantity, title: goods.productTitle })];
  if (goods.selection.length > 0) lines.push(formatOrderSelection(goods.selection));
  return lines;
}

/** The address as parcel-label lines, its country named in the reader's language. */
function addressBlock(address: ShipTo, locale: Locale): string {
  return formatShipTo(address, regionName(address.country, locale));
}

/** Log a delivery that should have worked. "disabled" is a deployment choice
 *  (mail not configured) and says nothing about this order. */
function reportFailure(kind: string, result: SendResult): void {
  if (!result.sent && result.reason === "failed") {
    console.error(`[orders] ${kind} email failed:`, result.detail);
  }
}

// ── 1. To the seller ──────────────────────────────────────────────────────

export type NewOrderEmail = Goods & {
  orderId: string;
  /** False for an order with nothing physical to send (a download). */
  ships: boolean;
  shipTo: ShipTo | null;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
};

/**
 * "You have a new order to ship", to the seller's account address. Never
 * throws (a mail problem must not undo a recorded sale); the result says
 * whether it went.
 */
export async function sendNewOrderEmail(
  to: string,
  locale: Locale,
  order: NewOrderEmail,
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const url = appUrl(orderDetailPath(order.orderId));
    const lines: string[] = [];

    if (order.ships) {
      lines.push(t("Orders.email.newOrder.introShip"), "");
      lines.push(t("Orders.email.newOrder.pack"), ...packLines(t, order), "");
      lines.push(t("Orders.email.newOrder.shipTo"));
      if (order.shipTo) {
        lines.push(addressBlock(order.shipTo, locale));
        if (order.shipTo.phone) {
          lines.push(t("Orders.email.newOrder.phone", { phone: order.shipTo.phone }));
        }
      } else {
        lines.push(t("Orders.email.newOrder.noAddress"));
      }
      lines.push("");
    } else {
      lines.push(t("Orders.email.newOrder.introDigital", { title: order.productTitle }), "");
    }

    if (order.buyerEmail) lines.push(t("Orders.email.newOrder.buyer", { email: order.buyerEmail }));
    lines.push(
      t("Orders.email.newOrder.total", {
        amount: formatCents(order.amountCents, order.currency, locale),
      }),
      "",
      order.ships
        ? t("Orders.email.newOrder.openShip", { url })
        : t("Orders.email.newOrder.openDigital", { url }),
      "",
      t("Orders.email.signOff"),
    );

    const subject =
      order.ships && order.shipTo
        ? t("Orders.email.newOrder.subjectShip", {
            quantity: order.quantity,
            title: order.productTitle,
            city: order.shipTo.city,
          })
        : t("Orders.email.newOrder.subjectDigital", { title: order.productTitle });

    const result = await sendEmail({ to, subject, text: lines.join("\n") });
    reportFailure("new-order", result);
    return result;
  } catch (error) {
    console.error("[orders] new-order email threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}

// ── 2. To the buyer ───────────────────────────────────────────────────────

export type ShippedEmail = Goods & {
  /** "shipped" when it has just gone; "tracking" when a number was added later. */
  kind: "shipped" | "tracking";
  trackingNumber: string | null;
  shipTo: ShipTo | null;
  /** Who the buyer bought from: the seller's trading name, and where replies go. */
  store: { name: string; contactEmail: string | null };
};

/**
 * "Your order is on its way", to the buyer, on the seller's behalf. Never
 * throws; the result says whether it went, so the seller can be told honestly
 * whether the buyer was emailed.
 */
export async function sendShippedEmail(
  to: string,
  locale: Locale,
  order: ShippedEmail,
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const store = order.store.name;
    const lines: string[] = [
      order.kind === "shipped"
        ? t("Orders.email.shipped.intro", { store })
        : t("Orders.email.shipped.introTracking", { store }),
      "",
      ...packLines(t, order),
    ];
    if (order.trackingNumber) {
      lines.push("", t("Orders.email.shipped.tracking", { tracking: order.trackingNumber }));
    }
    if (order.shipTo) {
      lines.push("", t("Orders.email.shipped.shipTo"), addressBlock(order.shipTo, locale));
    }
    if (order.store.contactEmail) {
      lines.push("", t("Orders.email.shipped.questions", { store }));
    }
    lines.push("", t("Orders.email.shipped.footer", { store }));

    const result = await sendEmail({
      to,
      subject:
        order.kind === "shipped"
          ? t("Orders.email.shipped.subject", { store })
          : t("Orders.email.shipped.subjectTracking", { store }),
      text: lines.join("\n"),
      fromName: t("Orders.email.fromName", { store }),
      ...(order.store.contactEmail ? { replyTo: order.store.contactEmail } : {}),
    });
    reportFailure("shipped", result);
    return result;
  } catch (error) {
    console.error("[orders] shipped email threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}
