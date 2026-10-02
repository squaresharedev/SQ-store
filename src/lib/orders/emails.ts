// SERVER ONLY. The emails an order sends, and nothing else.
//
//   1. "Ship this" to the SELLER when an order lands (lib/orders/record.ts):
//      everything needed to pack and address the parcel without opening the
//      dashboard, plus one link to the order to mark it shipped.
//   2. "It's on its way" to the BUYER when the seller marks it shipped, or
//      adds a tracking number afterwards (lib/orders/actions.ts), with the
//      link to their order page, where the parcel is followed.
//   3. The order CONFIRMATION to the BUYER when an order lands: the contract
//      confirmation EU distance selling owes them on a durable medium (CRD
//      art. 8(7)), which is why it carries the seller's identity and the
//      withdrawal information and is not just a receipt.
//   4. The two halves of a WITHDRAWAL (CRD art. 11a): the acknowledgement to
//      the buyer, and the notice to the seller who has to act on it.
//   5. The order link, again, to a buyer who asked for it by email.
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
import { signInPath } from "@/lib/auth/paths";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { formatCents } from "@/lib/format/money";
import { regionName } from "@/lib/format/country";
import { carrierName } from "@/lib/orders/carriers";
import { orderNumber } from "@/lib/orders/order-number";
import { orderDetailPath } from "@/lib/orders/paths";
import { formatOrderSelection } from "@/lib/orders/selection";
import { formatShipTo } from "@/lib/orders/ship-to";
import { translatorFor, type Translate } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import type { CarrierId, OrderSelection, ShipTo } from "@/types/order-view";
import type { StorefrontSeller } from "@/types/storefront";

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

/**
 * The link to an order, for a seller reading mail. Goes through sign-in rather
 * than straight to the order: a seller tapping it on a phone is usually signed
 * out, and a dashboard page a signed-out visitor requests forgets where they
 * were going. `/login?next=` remembers, sends a signed-in seller straight on,
 * and sends one who owes a second factor to the challenge first.
 */
function sellerOrderLink(orderId: string): string {
  return appUrl(signInPath(orderDetailPath(orderId)));
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
  /** What the buyer asked to go in the parcel, if anything. */
  giftMessage?: string | null;
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
    const url = sellerOrderLink(order.orderId);
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
      if (order.giftMessage) {
        lines.push("", t("Orders.email.newOrder.gift", { message: order.giftMessage }));
      }
      lines.push("");
    } else {
      lines.push(t("Orders.email.newOrder.introDigital", { title: order.productTitle }), "");
    }

    // The number the buyer will quote when they write, so the seller can match
    // it to this order without opening anything.
    lines.push(t("Orders.email.newOrder.number", { number: orderNumber(order.orderId) }));
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
  /** Who is carrying it, when the seller said. Named beside the number. */
  carrier: CarrierId | null;
  /** The buyer's order page (their credential; lib/orders/order-link.ts),
   *  where the parcel is followed. Null where there is none. */
  orderUrl: string | null;
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
      lines.push(
        "",
        order.carrier
          ? t("Orders.email.shipped.trackingCarrier", {
              tracking: order.trackingNumber,
              carrier: carrierName(order.carrier),
            })
          : t("Orders.email.shipped.tracking", { tracking: order.trackingNumber }),
      );
    }
    // The one link this mail carries is to the buyer's own order page on this
    // domain. The carrier's tracking link lives THERE, so mail sent from our
    // domain never points a buyer at a third party's site.
    if (order.orderUrl) {
      lines.push("", t("Orders.email.shipped.orderPage", { url: order.orderUrl }));
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

// ── 3. The confirmation, to the buyer ─────────────────────────────────────

export type OrderConfirmationEmail = Goods & {
  /** The short number printed on the order page (orderNumber). */
  number: string;
  placedAt: Date;
  subtotalCents: number;
  /** Null for a download. */
  shippingCents: number | null;
  amountCents: number;
  currency: string;
  shipTo: ShipTo | null;
  /** The seller's own dispatch line, if they wrote one. */
  dispatch: string | null;
  /** The order page (the buyer's credential; see lib/orders/order-link.ts),
   *  or null where there is none (an order recorded without a storefront). */
  orderUrl: string | null;
  /** The download route, for a digital order. Never a signed URL. */
  downloadUrl: string | null;
  /** Who the buyer contracted with: the identity the product page showed. */
  seller: StorefrontSeller;
  store: { name: string; contactEmail: string | null };
  /** EU seller: the withdrawal and guarantee lines are owed. */
  isEu: boolean;
  /** A download bought with consent to immediate supply. */
  supplyConsent: boolean;
};

/**
 * The buyer's confirmation. Never throws; the result says whether it went.
 *
 * Plain text for the same reason as every other order mail, and COMPLETE on
 * its own: this is the durable record of the contract, so it names who sold
 * it (name, address, contact), what it cost including delivery, and how to
 * withdraw, rather than pointing at a page that could change.
 */
export async function sendOrderConfirmation(
  to: string,
  locale: Locale,
  order: OrderConfirmationEmail,
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const store = order.store.name;
    const money = (cents: number) => formatCents(cents, order.currency, locale);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(order.placedAt);
    const lines: string[] = [
      t("Orders.email.confirmation.intro", { store }),
      "",
      t("Orders.email.confirmation.order", { number: order.number, date }),
      "",
      t("Orders.email.confirmation.bought"),
      ...packLines(t, order),
      "",
      t("Orders.email.confirmation.subtotal", { amount: money(order.subtotalCents) }),
    ];
    if (order.shippingCents !== null) {
      lines.push(
        order.shippingCents === 0
          ? t("Orders.email.confirmation.deliveryFree")
          : t("Orders.email.confirmation.delivery", { amount: money(order.shippingCents) }),
      );
    }
    lines.push(t("Orders.email.confirmation.total", { amount: money(order.amountCents) }), "");

    if (order.shipTo) {
      lines.push(t("Orders.email.confirmation.shipTo"), addressBlock(order.shipTo, locale), "");
      if (order.dispatch) {
        lines.push(t("Orders.email.confirmation.dispatch", { store, dispatch: order.dispatch }));
      }
      lines.push(t("Orders.email.confirmation.nextShip", { store }), "");
    }
    if (order.downloadUrl) {
      lines.push(t("Orders.email.confirmation.download", { url: order.downloadUrl }), "");
    }
    if (order.orderUrl) {
      lines.push(
        order.shipTo
          ? t("Orders.email.confirmation.orderPage", { url: order.orderUrl })
          : t("Orders.email.confirmation.orderPageDigital", { url: order.orderUrl }),
        "",
      );
    }

    // Who the contract is with: the identity the product page disclosed.
    lines.push(t("Orders.email.confirmation.seller"), order.seller.businessName || store);
    if (order.seller.address) lines.push(order.seller.address);
    // The address is free text; add the country when the seller did not write
    // it, so the contract names where the trader is without relying on it.
    const sellerCountry = regionName(order.seller.country, locale);
    if (sellerCountry && !order.seller.address?.toLowerCase().includes(sellerCountry.toLowerCase())) {
      lines.push(sellerCountry);
    }
    if (order.seller.email) lines.push(order.seller.email);
    if (order.seller.vatId) {
      lines.push(t("Orders.email.confirmation.sellerVat", { vat: order.seller.vatId }));
    }
    lines.push("");

    if (order.isEu) {
      lines.push(
        order.supplyConsent
          ? t("Orders.email.confirmation.withdrawalDigital")
          : t("Orders.email.confirmation.withdrawal", { store }),
        t("Orders.email.confirmation.guarantee"),
        "",
      );
    }
    if (order.store.contactEmail) lines.push(t("Orders.email.confirmation.questions", { store }), "");
    lines.push(t("Orders.email.confirmation.footer", { store }));

    const result = await sendEmail({
      to,
      subject: t("Orders.email.confirmation.subject", { store, title: order.productTitle }),
      text: lines.join("\n"),
      fromName: t("Orders.email.fromName", { store }),
      ...(order.store.contactEmail ? { replyTo: order.store.contactEmail } : {}),
    });
    reportFailure("confirmation", result);
    return result;
  } catch (error) {
    console.error("[orders] confirmation email threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}

// ── 4. A withdrawal, to both sides ────────────────────────────────────────

export type WithdrawalEmail = {
  number: string;
  productTitle: string;
  requestedAt: Date;
  store: { name: string; contactEmail: string | null };
};

/** The acknowledgement the buyer is owed "without undue delay" (art. 11a(3)). */
export async function sendWithdrawalAcknowledgement(
  to: string,
  locale: Locale,
  withdrawal: WithdrawalEmail,
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const store = withdrawal.store.name;
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
      withdrawal.requestedAt,
    );
    const lines = [
      t("Orders.email.withdrawal.buyerIntro", {
        number: withdrawal.number,
        title: withdrawal.productTitle,
        date,
        store,
      }),
      "",
      t("Orders.email.withdrawal.buyerNext", { store }),
      "",
      t("Orders.email.confirmation.footer", { store }),
    ];
    const result = await sendEmail({
      to,
      subject: t("Orders.email.withdrawal.buyerSubject", { number: withdrawal.number, store }),
      text: lines.join("\n"),
      fromName: t("Orders.email.fromName", { store }),
      ...(withdrawal.store.contactEmail ? { replyTo: withdrawal.store.contactEmail } : {}),
    });
    reportFailure("withdrawal-ack", result);
    return result;
  } catch (error) {
    console.error("[orders] withdrawal acknowledgement threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}

/** The seller's notice: who withdrew, from what, and what they owe now. */
export async function sendWithdrawalNotice(
  to: string,
  locale: Locale,
  withdrawal: WithdrawalEmail & { orderId: string; buyerEmail: string; buyerName: string },
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
      withdrawal.requestedAt,
    );
    const lines = [
      t("Orders.email.withdrawal.sellerIntro", {
        email: withdrawal.buyerEmail,
        number: withdrawal.number,
        date,
      }),
      t("Orders.email.withdrawal.sellerName", { name: withdrawal.buyerName }),
      "",
      t("Orders.email.withdrawal.sellerNext", { url: sellerOrderLink(withdrawal.orderId) }),
      "",
      t("Orders.email.signOff"),
    ];
    const result = await sendEmail({
      to,
      subject: t("Orders.email.withdrawal.sellerSubject", {
        number: withdrawal.number,
        title: withdrawal.productTitle,
      }),
      text: lines.join("\n"),
      replyTo: withdrawal.buyerEmail,
    });
    reportFailure("withdrawal-notice", result);
    return result;
  } catch (error) {
    console.error("[orders] withdrawal notice threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}

// ── 5. The order link, on request ─────────────────────────────────────────

/** The link to an order page, to the address the order was placed with. */
export async function sendOrderLinkEmail(
  to: string,
  locale: Locale,
  link: { number: string; orderUrl: string; store: { name: string; contactEmail: string | null } },
): Promise<SendResult> {
  try {
    const t = await translatorFor(locale);
    const store = link.store.name;
    const lines = [
      t("Orders.email.lookup.intro", { number: link.number, store }),
      link.orderUrl,
      "",
      t("Orders.email.lookup.ignore"),
      "",
      t("Orders.email.confirmation.footer", { store }),
    ];
    const result = await sendEmail({
      to,
      subject: t("Orders.email.lookup.subject", { store }),
      text: lines.join("\n"),
      fromName: t("Orders.email.fromName", { store }),
      ...(link.store.contactEmail ? { replyTo: link.store.contactEmail } : {}),
    });
    reportFailure("order-link", result);
    return result;
  } catch (error) {
    console.error("[orders] order link email threw:", error instanceof Error ? error.message : error);
    return { sent: false, reason: "failed" };
  }
}
