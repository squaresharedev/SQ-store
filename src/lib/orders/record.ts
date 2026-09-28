// SERVER ONLY. THE ORDER WRITER: the one place a paid checkout becomes an
// order, and the one place a new order tells its seller.
//
// WHO CALLS IT. Today, the dev sale simulator (app/dev/simulate-sale), which is
// how the whole flow is driven on a laptop and in the e2e suite. Once checkout
// is live, the payment webhook, which does not exist yet because it cannot
// exist safely before Stripe Connect onboarding does (lib/payments/
// availability.ts). TODO(checkout): that webhook must
//   1. verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET, over
//      the raw body, with a timestamp tolerance;
//   2. resolve the seller from the event's CONNECTED ACCOUNT (event.account)
//      and pass it as `sellerId` below. Never from session metadata alone: a
//      seller whose own Stripe account creates a session can put anything in
//      its metadata, including another seller's product id;
//   3. map checkout.session.completed with payment_status "paid" (and
//      checkout.session.async_payment_succeeded) to a PaidCheckout: the session
//      id, the product/storefront/channel/version from the session's metadata
//      (written at session creation from resolveOrderQuantity's answer), the
//      line item quantity, amount_total, the application fee,
//      customer_details.email and .phone, collected_information.
//      shipping_details (older API versions: shipping_details), and the
//      checkout's locale;
//   4. call recordPaidOrder and answer 2xx whatever it says about duplicates.
//
// WHAT THIS DOES, in order:
//   1. Normalises and bounds the input. A malformed address costs the order its
//      address (lib/orders/ship-to.ts), never the order: the money is already
//      taken when this runs, so it records what was paid rather than deciding
//      whether it should have been.
//   2. Reads the product with the service role: whose it is (the seller comes
//      from the product, and must match `sellerId` when one is given), what it
//      is called (the title snapshot) and whether it ships (a download has
//      nothing to send, so it never enters anyone's To ship queue).
//   3. Inserts ON CONFLICT (checkout_session_id) DO NOTHING. Payment webhooks
//      are delivered at least once; a redelivered event finds its order already
//      there and stops, so nothing below ever happens twice.
//   4. Takes the units off the shelf (decrementStock) when the product tracks
//      stock.
//   5. Tells the seller: a bell notification, and the "ship this" email unless
//      they turned sales emails off (Settings › Notifications).

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { decrementStock } from "@/lib/stock/decrement";
import { parseOrderSelection } from "@/lib/orders/selection";
import { parseShipTo } from "@/lib/orders/ship-to";
import { orderDetailPath } from "@/lib/orders/paths";
import { sendNewOrderEmail } from "@/lib/orders/emails";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import type { Json } from "@/types";
import type { FulfilmentStatus, OrderChannel, ShipTo } from "@/types/order-view";

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
  /** What was actually charged, in integer cents, shipping included. */
  amountCents: number;
  /** Our cut of it (the application fee). */
  platformFeeCents: number;
  currency: string;
  buyerEmail: string | null;
  /** The language the buyer checked out in, if known. */
  buyerLocale: string | null;
  /** The delivery address as collected; normalised here. */
  shipTo: unknown;
};

export type RecordResult =
  | { ok: true; orderId: string; duplicate: boolean }
  | { ok: false; reason: "invalid" | "unknown_product" | "seller_mismatch" | "error" };

/** Mirrors the orders.checkout_session_id CHECK. */
const CHECKOUT_SESSION_ID = /^[A-Za-z0-9_]{1,255}$/;

const paidCheckoutSchema = z.object({
  checkoutSessionId: z.string().regex(CHECKOUT_SESSION_ID),
  productId: z.uuid(),
  sellerId: z.uuid().optional(),
  storefrontId: z.uuid().nullable(),
  channel: z.enum(["embed", "marketplace"]),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  amountCents: z.number().int().min(0),
  platformFeeCents: z.number().int().min(0),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  buyerEmail: z.email().max(254).nullable(),
});

type ProductRow = {
  owner_id: string;
  title: string;
  price_cents: number;
  digital_file_key: string | null;
  track_stock: boolean;
};

/**
 * Record one paid checkout as an order. Never throws; see RecordResult.
 * `duplicate: true` means this checkout was already recorded, and nothing was
 * done a second time.
 */
export async function recordPaidOrder(input: PaidCheckout): Promise<RecordResult> {
  const parsed = paidCheckoutSchema.safeParse(input);
  if (!parsed.success || parsed.data.platformFeeCents > parsed.data.amountCents) {
    console.error("[orders] refused a malformed paid checkout", parsed.error?.issues[0]?.path);
    return { ok: false, reason: "invalid" };
  }
  const checkout = parsed.data;

  try {
    const admin = createAdminClient();

    const { data: product, error: productError } = await admin
      .from("products")
      .select("owner_id, title, price_cents, digital_file_key, track_stock")
      .eq("id", checkout.productId)
      .maybeSingle<ProductRow>();
    if (productError) throw productError;
    if (!product) return { ok: false, reason: "unknown_product" };
    if (checkout.sellerId && checkout.sellerId !== product.owner_id) {
      console.error("[orders] paid checkout names a seller who does not own the product");
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

    const { data: inserted, error: insertError } = await admin
      .from("orders")
      .upsert(
        {
          seller_id: sellerId,
          product_id: checkout.productId,
          storefront_id: storefrontId,
          channel: checkout.channel,
          status: "paid",
          amount_cents: checkout.amountCents,
          platform_fee_cents: checkout.platformFeeCents,
          currency: checkout.currency.toUpperCase(),
          buyer_email: checkout.buyerEmail,
          buyer_locale: parseLocale(input.buyerLocale),
          product_title: product.title,
          product_price_cents: product.price_cents,
          selected_options: selection as unknown as Json,
          quantity: checkout.quantity,
          ship_to: shipTo as unknown as Json,
          fulfilment_status: fulfilment,
          checkout_session_id: checkout.checkoutSessionId,
        },
        { onConflict: "checkout_session_id", ignoreDuplicates: true },
      )
      .select("id");
    if (insertError) throw insertError;

    const orderId = inserted?.[0]?.id;
    if (!orderId) {
      // Already recorded by an earlier delivery of the same payment.
      const { data: existing } = await admin
        .from("orders")
        .select("id")
        .eq("checkout_session_id", checkout.checkoutSessionId)
        .maybeSingle();
      return existing
        ? { ok: true, orderId: existing.id, duplicate: true }
        : { ok: false, reason: "error" };
    }

    if (product.track_stock) {
      const stock = await decrementStock(admin, checkout.productId, checkout.quantity);
      // The money is taken and the order stands either way; a shortfall here
      // means two buyers raced for the last units, which the seller has to
      // resolve with one of them. Stock reads 0 on the product either way.
      if (!stock.ok) console.warn(`[orders] stock not decremented for order ${orderId}: ${stock.reason}`);
    }

    await tellSeller(sellerId, {
      orderId,
      productTitle: product.title,
      quantity: checkout.quantity,
      selection,
      ships,
      shipTo,
      amountCents: checkout.amountCents,
      currency: checkout.currency.toUpperCase(),
      buyerEmail: checkout.buyerEmail,
    });

    return { ok: true, orderId, duplicate: false };
  } catch (error) {
    console.error("[orders] recording a paid checkout failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error" };
  }
}

/**
 * The bell notification and the "ship this" email. Best-effort, both: a sale
 * that is recorded stays recorded whatever happens to the news of it.
 */
async function tellSeller(
  sellerId: string,
  order: Parameters<typeof sendNewOrderEmail>[2] & { shipTo: ShipTo | null },
): Promise<void> {
  const href = orderDetailPath(order.orderId);
  await createNotification({
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
    if (profile?.notify_sales === false) return;
    const to = user?.user?.email;
    if (!to) return;
    await sendNewOrderEmail(to, parseLocale(profile?.locale) ?? DEFAULT_LOCALE, order);
  } catch (error) {
    console.error("[orders] could not email the seller:", error instanceof Error ? error.message : error);
  }
}
