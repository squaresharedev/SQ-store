// SERVER ONLY. THE ORDER WRITER: the one place a paid checkout becomes an
// order, and the one place a new order tells its seller.
//
// WHO CALLS IT. The hosted checkout's order route (app/api/checkout), through
// its payment provider: today the development TEST provider, which records the
// order the moment the buyer presses Pay (lib/checkout/provider.ts); and the
// dev sale simulator (app/dev/simulate-sale). Once Stripe is live, the payment
// webhook, which does not exist yet because it cannot exist safely before
// Stripe Connect onboarding does (lib/payments/availability.ts).
// TODO(stripe): that webhook must
//   1. verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET, over
//      the raw body, with a timestamp tolerance;
//   2. resolve the seller from the event's CONNECTED ACCOUNT (event.account)
//      and pass it as `sellerId` below. Never from session metadata alone: a
//      seller whose own Stripe account creates a session can put anything in
//      its metadata, including another seller's product id;
//   3. map checkout.session.completed with payment_status "paid" (and
//      checkout.session.async_payment_succeeded) to a PaidCheckout: the session
//      id, the product/storefront/channel/version/gift message/consent from the
//      session's metadata (written at session creation from the checkout's
//      quote, lib/checkout/quote.ts), the line item quantity, amount_total and
//      shipping_cost.amount_total, the application fee (with the rate and
//      plan that set it, written into the session's metadata at creation
//      from lib/billing/sale-fee.ts), the regular unit price and the
//      discount ids (`unitPriceCents`, `discountId`, `credit`: also written
//      into the metadata from the quote, and checked against the seller
//      below), customer_details.email
//      and .phone, collected_information.shipping_details (older API
//      versions: shipping_details), and the checkout's locale;
//   4. call recordPaidOrder and answer 2xx whatever it says about duplicates.
//
// WHAT THIS DOES, in order:
//   1. Normalises and bounds the input. A malformed address costs the order its
//      address (lib/orders/ship-to.ts), never the order.
//   2. Reads the product with the service role: whose it is (the seller comes
//      from the product, and must match `sellerId` when one is given), what it
//      is called (the title snapshot) and whether it ships (a download has
//      nothing to send, so it never enters anyone's To ship queue).
//   3. Hands the row to public.order_place (20261008_order_lifecycle), which
//      writes the order AND takes its stock in one transaction. Either both
//      happen or neither does: two buyers after the last unit cannot both get
//      an order, and the one who cannot is told "sold out" BEFORE any money
//      moves. It is idempotent on the checkout id, so a repeated attempt or a
//      redelivered payment event finds its order and takes nothing twice.
//   4. Tells the seller (a bell notification, and the "ship this" email unless
//      they turned sales emails off in Settings › Notifications) and the buyer
//      (the order confirmation EU law owes them). AFTER the response where
//      there is one: the buyer is waiting on a redirect to their order page,
//      and no mail server gets to hold that up.
//
// THE NEWS IS RETRYABLE (announceOrder). What was said is recorded on the order
// (seller_notified_at, confirmation_sent_at), and every call for an order that
// already exists finishes whatever is still missing. A payment event is
// delivered at least once: the delivery that found the order written but died
// before the "ship this" email went out used to be the end of it.
//
// TWO WAYS IN. recordPaidOrder writes an order that is already paid (the test
// provider, the simulator). reservePendingOrder writes one that is WAITING on
// a payment: its stock is held until confirmPendingOrder turns it into a paid
// order, or releasePendingOrder (or the sweep) gives the units back.

import { z } from "zod";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { parseOrderSelection } from "@/lib/orders/selection";
import { parseShipTo } from "@/lib/orders/ship-to";
import { orderDetailPath } from "@/lib/orders/paths";
import { productEditPath } from "@/lib/products/paths";
import { sendNewOrderEmail } from "@/lib/orders/emails";
import { sendBuyerConfirmation } from "@/lib/orders/confirmation";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import { DISCOUNT_CODE_PATTERN } from "@/lib/discounts/code";
import { GIFT_MESSAGE_MAX } from "@/types/storefront";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { recordOrderFees } from "@/lib/billing/fee-ledger";
import { BPS_WHOLE } from "@/lib/pricing";
import type { Json } from "@/types";
import { ORDER_CHANNELS, type FulfilmentStatus, type OrderChannel, type ShipTo } from "@/types/order-view";

/** What was bought and paid, as the payment provider recorded it. */
export type PaidCheckout = {
  /** The provider's checkout id. The idempotency key: one checkout, one order. */
  checkoutSessionId: string;
  productId: string;
  /** The seller the payment was made to, when the caller knows it (the
   *  webhook does, from the connected account). Must own the product. */
  sellerId?: string;
  storefrontId: string | null;
  channel: OrderChannel;
  quantity: number;
  /** What the buyer picked, in the seller's words: [{ label, value }]. */
  selection: unknown;
  /** The REGULAR price of one, as the quote priced it. Snapshotted as
   *  product_price_cents; absent means the product's price as read here. */
  unitPriceCents?: number;
  /** The discount that set the price (a sale, or a code that beat it). Only
   *  an id: how much it took off is worked out here from what was charged. */
  discountId?: string | null;
  /** The valid code the buyer entered, credited to its channel. */
  credit?: { id: string; code: string } | null;
  /** What was actually charged, in integer cents, shipping included. */
  amountCents: number;
  /** Delivery's share of amountCents, when the provider reports it. For the
   *  buyer's confirmation, which itemises it; null or absent = not known. */
  shippingCents?: number | null;
  /** Our cut of it for the sale itself, charged on amountCents. */
  platformFeeCents: number;
  /** The rate that produced platformFeeCents, in basis points, and the
   *  seller's plan that set the rate (lib/billing/sale-fee.ts). Both
   *  snapshotted on the order, so a later price change never rewrites what a
   *  past sale was charged. Absent only for callers that predate plans. */
  platformFeeBps?: number | null;
  sellerPlan?: PlanId | null;
  /** The ad fee on a promoted marketplace sale, and the rate that produced
   *  it. Absent (nothing) for every other sale. */
  adRateBps?: number | null;
  adFeeCents?: number;
  /** Everything taken from the sale: platformFeeCents + adFeeCents, after the
   *  cap. Absent means just the platform fee (callers that predate the ad fee). */
  applicationFeeCents?: number;
  /** The 30% cap cut the fee down. */
  feeCapped?: boolean;
  currency: string;
  buyerEmail: string | null;
  /** The language the buyer checked out in, if known. */
  buyerLocale: string | null;
  /** The delivery address as collected; normalised here. */
  shipTo: unknown;
  /** The buyer's gift message for the parcel. Kept only when something ships. */
  giftMessage?: string | null;
  /** A download buyer agreed to immediate supply (and the loss of the right to
   *  withdraw). Recorded as the moment the order was written. */
  supplyConsent?: boolean;
};

export type RecordResult =
  | { ok: true; orderId: string; duplicate: boolean }
  | {
      ok: false;
      /** `sold_out`: a tracked product had too few left. Nothing was written. */
      reason: "invalid" | "unknown_product" | "seller_mismatch" | "sold_out" | "error";
    };

/** How long an unpaid order holds its stock before the sweep gives it back
 *  (public.orders_release_expired). Longer than the payment page it waits on
 *  stays open, so a payment can never land on an order already released. */
export const PENDING_ORDER_MINUTES = 45;

/** What public.order_place answers. */
type Placed = {
  order_id: string | null;
  duplicate: boolean;
  stock_left?: number | null;
  low_stock?: boolean;
};

/** The exception public.order_place raises when a tracked product has too few. */
const INSUFFICIENT_STOCK = "insufficient_stock";

/** Mirrors the orders.checkout_session_id CHECK. */
const CHECKOUT_SESSION_ID = /^[A-Za-z0-9_]{1,255}$/;

const paidCheckoutSchema = z.object({
  checkoutSessionId: z.string().regex(CHECKOUT_SESSION_ID),
  productId: z.uuid(),
  sellerId: z.uuid().optional(),
  storefrontId: z.uuid().nullable(),
  channel: z.enum(ORDER_CHANNELS),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  unitPriceCents: z.number().int().min(0).optional(),
  discountId: z.uuid().nullable().optional(),
  credit: z.object({ id: z.uuid(), code: z.string().regex(DISCOUNT_CODE_PATTERN) }).nullable().optional(),
  amountCents: z.number().int().min(0),
  platformFeeCents: z.number().int().min(0),
  // Mirror the orders.platform_fee_bps and orders.seller_plan CHECKs.
  platformFeeBps: z.number().int().min(0).max(BPS_WHOLE).nullable().optional(),
  sellerPlan: z.enum(PLAN_IDS).nullable().optional(),
  // Mirror the orders.ad_rate_bps, ad_fee_cents and application_fee CHECKs.
  adRateBps: z.number().int().min(1).max(BPS_WHOLE).nullable().optional(),
  adFeeCents: z.number().int().min(0).optional(),
  applicationFeeCents: z.number().int().min(0).optional(),
  feeCapped: z.boolean().optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  buyerEmail: z.email().max(254).nullable(),
  shippingCents: z.number().int().min(0).nullable().optional(),
  // Mirrors the orders.gift_message CHECK. Already validated by the checkout;
  // bounded again here because this is the write, and the webhook will read
  // it back out of provider metadata.
  giftMessage: z.string().trim().min(1).max(GIFT_MESSAGE_MAX).nullable().optional(),
  supplyConsent: z.boolean().optional(),
});

type ProductRow = {
  owner_id: string;
  title: string;
  price_cents: number;
  digital_file_key: string | null;
  track_stock: boolean;
  shipping_profile_id: string | null;
};

/**
 * Record one paid checkout as an order. Never throws; see RecordResult.
 * `duplicate: true` means this checkout was already recorded: nothing was
 * written or taken a second time, and whatever news was still unsent is sent.
 */
export async function recordPaidOrder(input: PaidCheckout): Promise<RecordResult> {
  const result = await placeOrder(input, { status: "paid" });
  if (result.ok) {
    // No provider collected this sale's fee, so nothing will report it: the
    // ledger is written from the order itself. Idempotent, and never the
    // reason an order that IS recorded reads as failed.
    try {
      await recordOrderFees(result.orderId);
    } catch (error) {
      console.error("[orders] writing the fee ledger failed:", error instanceof Error ? error.message : error);
    }
    await afterResponse(() => announceOrder(result.orderId));
  }
  return result;
}

/**
 * Write an order that is WAITING on its payment, holding its stock. Nobody is
 * told yet: confirmPendingOrder does that, once the provider says it was paid.
 */
export async function reservePendingOrder(input: PaidCheckout): Promise<RecordResult> {
  return placeOrder(input, {
    status: "pending",
    expiresAt: new Date(Date.now() + PENDING_ORDER_MINUTES * 60_000),
  });
}

/**
 * The provider confirmed a checkout: its waiting order is paid, and its seller
 * and buyer are told. Idempotent, and safe to call for every delivery of the
 * event. `orderId: null` means there is no order for it (it was released, or
 * never placed): money taken with nothing to show for it, which the caller
 * must raise rather than swallow.
 */
export async function confirmPendingOrder(
  checkoutSessionId: string,
  paymentRef: string | null,
): Promise<{ ok: true; orderId: string | null } | { ok: false }> {
  try {
    const { data, error } = await createAdminClient().rpc("order_confirm_paid", {
      p_checkout_session_id: checkoutSessionId,
      ...(paymentRef ? { p_payment_ref: paymentRef } : {}),
    });
    if (error) throw error;
    const orderId = (data as { order_id: string | null } | null)?.order_id ?? null;
    if (orderId) await afterResponse(() => announceOrder(orderId));
    return { ok: true, orderId };
  } catch (error) {
    console.error("[orders] confirming a paid checkout failed:", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

/** An unpaid checkout was abandoned or expired: its order goes, and its units
 *  go back on the shelf. False when there was nothing waiting. Never throws. */
export async function releasePendingOrder(checkoutSessionId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("order_release_pending", {
      p_checkout_session_id: checkoutSessionId,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    console.error("[orders] releasing an unpaid order failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function placeOrder(
  input: PaidCheckout,
  as: { status: "paid" } | { status: "pending"; expiresAt: Date },
): Promise<RecordResult> {
  const parsed = paidCheckoutSchema.safeParse(input);
  // The two parts must be the whole, and the whole no more than the sale: the
  // same rules the orders table holds, said here so a bad fee is refused
  // before anything is reserved.
  const adFeeCents = parsed.data?.adFeeCents ?? 0;
  const applicationFeeCents = parsed.data?.applicationFeeCents ?? (parsed.data?.platformFeeCents ?? 0) + adFeeCents;
  if (
    !parsed.success ||
    applicationFeeCents !== parsed.data.platformFeeCents + adFeeCents ||
    applicationFeeCents > parsed.data.amountCents ||
    (parsed.data.shippingCents ?? 0) > parsed.data.amountCents
  ) {
    console.error("[orders] refused a malformed checkout", parsed.error?.issues[0]?.path);
    return { ok: false, reason: "invalid" };
  }
  const checkout = parsed.data;

  try {
    const admin = createAdminClient();

    const { data: product, error: productError } = await admin
      .from("products")
      .select("owner_id, title, price_cents, digital_file_key, track_stock, shipping_profile_id")
      .eq("id", checkout.productId)
      .maybeSingle<ProductRow>();
    if (productError) throw productError;
    if (!product) return { ok: false, reason: "unknown_product" };
    if (checkout.sellerId && checkout.sellerId !== product.owner_id) {
      console.error("[orders] checkout names a seller who does not own the product");
      return { ok: false, reason: "seller_mismatch" };
    }
    const sellerId = product.owner_id;

    // Attribution only: a storefront that is not this seller's is dropped
    // rather than trusted, so one store's sales never count on another's page.
    let storefrontId: string | null = null;
    if (checkout.storefrontId) {
      const { data: storefront } = await admin
        .from("storefronts")
        .select("id")
        .eq("id", checkout.storefrontId)
        .eq("owner_id", sellerId)
        .maybeSingle();
      storefrontId = storefront ? checkout.storefrontId : null;
    }

    const ships = product.digital_file_key === null;
    const shipTo = ships ? parseShipTo(input.shipTo) : null;
    const selection = parseOrderSelection(input.selection);
    const fulfilment: FulfilmentStatus = ships ? "unfulfilled" : "not_required";

    // What a discount did, from what was actually CHARGED: the items cost
    // amount minus delivery, and anything below the regular price is the
    // discount. Worked out here rather than taken from the caller, so a
    // provider's figures can never make the order claim a discount it did not
    // charge.
    const unitPriceCents = checkout.unitPriceCents ?? product.price_cents;
    const regularItems = unitPriceCents * checkout.quantity;
    const discountCents = Math.min(
      regularItems,
      Math.max(0, regularItems - (checkout.amountCents - (checkout.shippingCents ?? 0))),
    );
    const attribution = await verifyAttribution(admin, sellerId, checkout.discountId ?? null, checkout.credit ?? null);

    const { data, error } = await admin.rpc("order_place", {
      p_order: {
        seller_id: sellerId,
        product_id: checkout.productId,
        storefront_id: storefrontId,
        channel: checkout.channel,
        status: as.status,
        amount_cents: checkout.amountCents,
        platform_fee_cents: checkout.platformFeeCents,
        platform_fee_bps: checkout.platformFeeBps ?? null,
        seller_plan: checkout.sellerPlan ?? null,
        ad_rate_bps: checkout.adRateBps ?? null,
        ad_fee_cents: adFeeCents,
        application_fee_cents: applicationFeeCents,
        fee_capped: checkout.feeCapped ?? false,
        shipping_cents: checkout.shippingCents ?? null,
        currency: checkout.currency.toUpperCase(),
        buyer_email: checkout.buyerEmail,
        buyer_locale: parseLocale(input.buyerLocale),
        product_title: product.title,
        product_price_cents: unitPriceCents,
        discount_cents: discountCents,
        discount_id: discountCents > 0 ? attribution.discountId : null,
        discount_code_id: attribution.credit?.id ?? null,
        discount_code: attribution.credit?.code ?? null,
        selected_options: selection as unknown as Json,
        quantity: checkout.quantity,
        ship_to: shipTo as unknown as Json,
        fulfilment_status: fulfilment,
        checkout_session_id: checkout.checkoutSessionId,
        // A gift message belongs with a parcel; a download has none to go in.
        gift_message: ships ? (checkout.giftMessage ?? null) : null,
        supply_consent_at: !ships && checkout.supplyConsent ? new Date().toISOString() : null,
        // The file this order paid for, snapshotted so a replaced or deleted
        // product cannot take the buyer's download with it.
        digital_file_key: product.digital_file_key,
        pending_expires_at: as.status === "pending" ? as.expiresAt.toISOString() : null,
      } as Json,
    });
    if (error) {
      // Not enough left: the function took its own insert back, so there is no
      // order and nothing was reserved. The one refusal that is the buyer's to
      // hear, and they hear it before paying.
      if (error.message.includes(INSUFFICIENT_STOCK)) return { ok: false, reason: "sold_out" };
      throw error;
    }

    const placed = data as Placed | null;
    if (!placed?.order_id) return { ok: false, reason: "error" };
    if (!placed.duplicate && placed.low_stock) {
      const left = placed.stock_left ?? 0;
      await afterResponse(() => tellSellerStockIsLow(sellerId, checkout.productId, product.title, left));
    }
    return { ok: true, orderId: placed.order_id, duplicate: placed.duplicate };
  } catch (error) {
    console.error("[orders] placing an order failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error" };
  }
}

/** Everything announceOrder reads off an order to say what it has to say. */
const ANNOUNCE_SELECT =
  "id, seller_id, product_id, storefront_id, status, product_title, quantity, selected_options, ship_to, amount_cents, shipping_cents, currency, buyer_email, buyer_locale, gift_message, discount_cents, discount_id, discount_code_id, discount_code, digital_file_key, supply_consent_at, created_at, seller_notified_at, confirmation_sent_at";

type AnnounceRow = {
  id: string;
  seller_id: string;
  product_id: string | null;
  storefront_id: string | null;
  status: string;
  product_title: string;
  quantity: number;
  selected_options: unknown;
  ship_to: unknown;
  amount_cents: number;
  shipping_cents: number | null;
  currency: string;
  buyer_email: string | null;
  buyer_locale: string | null;
  gift_message: string | null;
  discount_cents: number;
  discount_id: string | null;
  discount_code_id: string | null;
  discount_code: string | null;
  digital_file_key: string | null;
  supply_consent_at: string | null;
  created_at: string;
  seller_notified_at: string | null;
  confirmation_sent_at: string | null;
};

/**
 * Tell the seller and the buyer about a paid order: whatever has not been said
 * yet, and nothing that has. Everything comes off the ORDER, never from the
 * request that happened to place it, which is what makes a later call able to
 * finish the job: the same words, whoever asks and whenever.
 *
 * SENT, THEN MARKED. A crash between the two repeats a message on the next
 * call; the other order (marked, then sent) loses one for good, and a seller
 * who never hears about a parcel is the worse failure. Best-effort and never
 * throws: a sale that is recorded stays recorded whatever happens to the news.
 */
export async function announceOrder(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("orders").select(ANNOUNCE_SELECT).eq("id", orderId).maybeSingle();
    if (error) throw error;
    const order = data as AnnounceRow | null;
    // An order still waiting on its payment has nothing to announce yet.
    if (!order || order.status !== "paid") return;

    const ships = order.digital_file_key === null;
    const shipTo = ships ? parseShipTo(order.ship_to) : null;
    const selection = parseOrderSelection(order.selected_options);
    // The buyer's own code, when it is what set the price.
    const byCode =
      order.discount_cents > 0 &&
      order.discount_code !== null &&
      order.discount_code_id !== null &&
      order.discount_id === order.discount_code_id;

    if (!order.seller_notified_at) {
      const told = await tellSeller(order.seller_id, {
        orderId: order.id,
        productTitle: order.product_title,
        quantity: order.quantity,
        selection,
        ships,
        shipTo,
        amountCents: order.amount_cents,
        currency: order.currency,
        buyerEmail: order.buyer_email,
        giftMessage: ships ? order.gift_message : null,
        discountCode: order.discount_code,
      });
      if (told) await markAnnounced(admin, order.id, "seller_notified_at");
    }

    if (!order.confirmation_sent_at && order.buyer_email) {
      const { data: product } = order.product_id
        ? await admin.from("products").select("shipping_profile_id").eq("id", order.product_id).maybeSingle()
        : { data: null };
      const sent = await sendBuyerConfirmation({
        orderId: order.id,
        sellerId: order.seller_id,
        storefrontId: order.storefront_id,
        buyerEmail: order.buyer_email,
        buyerLocale: order.buyer_locale,
        productTitle: order.product_title,
        quantity: order.quantity,
        selection,
        shipTo,
        shippingProfileId: product?.shipping_profile_id ?? null,
        amountCents: order.amount_cents,
        shippingCents: order.shipping_cents,
        // Shown to the buyer as its own line only when THEIR code set the
        // price; a sale's lower price is simply the price they paid.
        codeDiscount: byCode && order.discount_code ? { code: order.discount_code, cents: order.discount_cents } : null,
        currency: order.currency,
        isDigital: !ships,
        supplyConsent: !ships && order.supply_consent_at !== null,
        placedAt: new Date(order.created_at),
      });
      if (sent) await markAnnounced(admin, order.id, "confirmation_sent_at");
    }
  } catch (error) {
    console.error("[orders] announcing an order failed:", error instanceof Error ? error.message : error);
  }
}

async function markAnnounced(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  column: "seller_notified_at" | "confirmation_sent_at",
): Promise<void> {
  const at = new Date().toISOString();
  const { error } = await admin
    .from("orders")
    .update(column === "seller_notified_at" ? { seller_notified_at: at } : { confirmation_sent_at: at })
    .eq("id", orderId)
    .is(column, null);
  if (error) console.error(`[orders] could not record ${column}:`, error.message);
}

/** The bell row for a product that has just sold down to its low-stock line.
 *  Best-effort: it is a nudge, and the order it rode in on is already written. */
async function tellSellerStockIsLow(
  sellerId: string,
  productId: string,
  title: string,
  left: number,
): Promise<void> {
  await createNotification({
    userId: sellerId,
    type: "stock",
    message: {
      title: { key: "Notifications.messages.stock.low.title", values: { title } },
      body: { key: "Notifications.messages.stock.low.body", values: { count: left } },
    },
    data: { href: productEditPath(productId) },
  });
}

/**
 * The discount ids an order may be credited to: only discounts of THIS seller.
 * A provider's ids arrive from session metadata, which a connected seller
 * controls, so an id from another store is dropped (with a log) rather than
 * letting one store's order count on another's Discounts page. Never refuses:
 * the money is taken, and attribution is the one thing worth losing.
 */
async function verifyAttribution(
  admin: ReturnType<typeof createAdminClient>,
  sellerId: string,
  discountId: string | null,
  credit: { id: string; code: string } | null,
): Promise<{ discountId: string | null; credit: { id: string; code: string } | null }> {
  const ids = [...new Set([discountId, credit?.id].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return { discountId: null, credit: null };
  const { data, error } = await admin.from("discounts").select("id, code").eq("owner_id", sellerId).in("id", ids);
  if (error) {
    console.error("[orders] discount attribution read failed:", error.message);
    return { discountId: null, credit: null };
  }
  const owned = new Map((data ?? []).map((row) => [row.id, row.code]));
  if (ids.some((id) => !owned.has(id))) console.warn("[orders] dropped a discount id the seller does not own");
  const creditCode = credit ? owned.get(credit.id) : undefined;
  return {
    discountId: discountId && owned.has(discountId) ? discountId : null,
    credit: credit && creditCode ? { id: credit.id, code: creditCode } : null,
  };
}

/**
 * Run `task` after the response has been sent when there is a response to
 * wait for (a route handler, a page), and straight away otherwise (a script, a
 * test). `after` throws outside a request scope, which is how the second case
 * is told apart from the first.
 */
async function afterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}

/**
 * The bell notification and the "ship this" email. Best-effort, both: a sale
 * that is recorded stays recorded whatever happens to the news of it.
 *
 * True once the BELL row exists. That is the one the seller cannot miss and
 * the one that is always owed (the email is theirs to switch off), so it is
 * what decides whether the order still needs announcing.
 */
async function tellSeller(
  sellerId: string,
  order: Parameters<typeof sendNewOrderEmail>[2] & { shipTo: ShipTo | null },
): Promise<boolean> {
  const href = orderDetailPath(order.orderId);
  const told = await createNotification({
    userId: sellerId,
    type: "order",
    message: order.ships
      ? {
          title: {
            key: "Notifications.messages.order.newToShip.title",
            values: { quantity: order.quantity, title: order.productTitle },
          },
          body: order.shipTo
            ? {
                key: "Notifications.messages.order.newToShip.body",
                values: { name: order.shipTo.name, city: order.shipTo.city },
              }
            : { key: "Notifications.messages.order.newToShip.bodyNoAddress" },
        }
      : {
          title: {
            key: "Notifications.messages.order.newDigital.title",
            values: { title: order.productTitle },
          },
          body: { key: "Notifications.messages.order.newDigital.body" },
        },
    data: { href },
  });

  try {
    const admin = createAdminClient();
    const [{ data: profile }, { data: user }] = await Promise.all([
      admin.from("profiles").select("notify_sales, locale").eq("id", sellerId).maybeSingle(),
      admin.auth.admin.getUserById(sellerId),
    ]);
    // Sales emails are on unless the seller turned them off.
    if (profile?.notify_sales === false) return told;
    const to = user?.user?.email;
    if (!to) return told;
    await sendNewOrderEmail(to, parseLocale(profile?.locale) ?? DEFAULT_LOCALE, order);
  } catch (error) {
    console.error("[orders] could not email the seller:", error instanceof Error ? error.message : error);
  }
  return told;
}
