// SERVER ONLY. The buyer's order confirmation: gathering what it has to say,
// then sending it (lib/orders/emails.ts writes the words).
//
// Called by the order writer once an order is recorded, for EVERY way an order
// can be recorded (the test provider today, the payment webhook tomorrow), so
// no provider can forget it. Best-effort like every order mail: a sale that is
// recorded stays recorded whatever happens to the news of it.

import { appUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { findShippingProfile } from "@/lib/storefront/shipping";
import { isEuSeller } from "@/lib/storefront/product-page";
import { orderDownloadApiPath } from "@/lib/checkout/paths";
import { orderNumber, orderRef } from "@/lib/orders/order-link";
import { orderPageUrl } from "@/lib/storefront/product-page-url";
import { sendOrderConfirmation } from "@/lib/orders/emails";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import type { OrderSelection, ShipTo } from "@/types/order-view";

export type ConfirmationInput = {
  orderId: string;
  sellerId: string;
  storefrontId: string | null;
  buyerEmail: string | null;
  buyerLocale: string | null;
  productTitle: string;
  quantity: number;
  selection: readonly OrderSelection[];
  shipTo: ShipTo | null;
  shippingProfileId: string | null;
  amountCents: number;
  /** Delivery's share of the amount; null for a download or when unknown. */
  shippingCents: number | null;
  currency: string;
  isDigital: boolean;
  supplyConsent: boolean;
  placedAt: Date;
};

export async function sendBuyerConfirmation(order: ConfirmationInput): Promise<void> {
  if (!order.buyerEmail) return;
  try {
    const admin = createAdminClient();
    const [seller, policy, { data: storefront }, ref] = await Promise.all([
      getSellerIdentity(order.sellerId),
      getShippingPolicy(order.sellerId),
      order.storefrontId
        ? admin.from("storefronts").select("name").eq("id", order.storefrontId).maybeSingle()
        : Promise.resolve({ data: null }),
      orderRef(order.orderId),
    ]);
    const storeName = seller.businessName || storefront?.name || "";
    // Without a storefront there is no page to link (the dev simulator's
    // orders); without a key there is no credential to put in one.
    const orderUrl = order.storefrontId && ref ? orderPageUrl(order.storefrontId, ref) : null;
    const dispatch = order.isDigital
      ? null
      : (findShippingProfile(policy.profiles, order.shippingProfileId)?.dispatch ?? policy.dispatch ?? null);
    const shippingCents = order.isDigital ? null : order.shippingCents;

    await sendOrderConfirmation(order.buyerEmail, parseLocale(order.buyerLocale) ?? DEFAULT_LOCALE, {
      productTitle: order.productTitle,
      quantity: order.quantity,
      selection: order.selection,
      number: orderNumber(order.orderId),
      placedAt: order.placedAt,
      subtotalCents: order.amountCents - (shippingCents ?? 0),
      shippingCents,
      amountCents: order.amountCents,
      currency: order.currency,
      shipTo: order.shipTo,
      dispatch: dispatch || null,
      orderUrl,
      downloadUrl: order.isDigital && ref ? appUrl(orderDownloadApiPath(ref)) : null,
      seller,
      store: { name: storeName, contactEmail: seller.email ?? null },
      isEu: isEuSeller(seller),
      supplyConsent: order.supplyConsent,
    });
  } catch (error) {
    console.error("[orders] buyer confirmation failed:", error instanceof Error ? error.message : error);
  }
}
