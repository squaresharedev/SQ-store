// SERVER ONLY, DEVELOPMENT ONLY. A pretend sale, recorded through the REAL
// order writer (lib/orders/record.ts), so the whole fulfilment loop can be
// driven on a laptop and in the e2e suite before checkout exists: an order
// lands, the seller is notified and emailed (into the dev outbox), it waits in
// To ship, it is marked shipped, the buyer is emailed.
//
// Only the payment is pretend. Everything after it is the code production
// runs, which is the point: a simulator with its own insert would prove
// nothing about the writer.

import { createClient } from "@/lib/supabase/server";
import { recordPaidOrder, type RecordResult } from "@/lib/orders/record";
import { optionSummaryRows } from "@/lib/products/option-details";
import { parseOptionGroups } from "@/lib/products/detail";
import type { ProductOption } from "@/types/product";
import type { ShipTo } from "@/types/order-view";

/** Our take on a pretend sale, the same rate the seed data uses. */
const SIMULATED_FEE_RATE = 0.05;

/** Buyers on the reserved .test domain, so nothing here can reach a real
 *  inbox even if a message escaped the dev outbox. */
const BUYERS: readonly { email: string; locale: string; shipTo: ShipTo }[] = [
  {
    email: "aoife.byrne@example.test",
    locale: "en",
    shipTo: { name: "Aoife Byrne", line1: "12 Harbour Road", line2: "Apartment 4", city: "Dublin", postalCode: "D02 X285", country: "IE", phone: "+353 87 123 4567" },
  },
  {
    email: "lukas.weber@example.test",
    locale: "de",
    shipTo: { name: "Lukas Weber", line1: "Lindenstrasse 14", city: "Berlin", postalCode: "10115", country: "DE" },
  },
  {
    email: "camille.dubois@example.test",
    locale: "fr",
    shipTo: { name: "Camille Dubois", line1: "7 Rue des Lilas", city: "Lyon", postalCode: "69003", country: "FR", phone: "+33 6 12 34 56 78" },
  },
  {
    email: "sanne.devries@example.test",
    locale: "nl",
    shipTo: { name: "Sanne de Vries", line1: "Keizersgracht 221", city: "Amsterdam", postalCode: "1016 DV", country: "NL" },
  },
];

export type SimulatedSaleRequest = {
  /** Which of the store's active products; the newest when absent. */
  productId?: string;
  quantity?: number;
  /** Which pretend buyer (by position); a random one when absent. */
  buyer?: number;
  /** Replay a checkout already recorded, the way a payment provider
   *  redelivers a webhook; a fresh one when absent. */
  checkoutSessionId?: string;
};

/** The active store's products a sale can be simulated for. */
export async function simulatableProducts(accountId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, title, price_cents, currency, option_groups, digital_file_key")
    .eq("owner_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

/**
 * Record a pretend paid checkout for one of this store's products. The buyer
 * picks the first available version of each option, the way a default page
 * load would.
 */
export async function simulateSale(
  accountId: string,
  request: SimulatedSaleRequest,
): Promise<RecordResult> {
  const products = await simulatableProducts(accountId);
  const product = request.productId
    ? products.find((candidate) => candidate.id === request.productId)
    : products[0];
  if (!product) return { ok: false, reason: "unknown_product" };

  const groups = parseOptionGroups(product.option_groups);
  const chosen: Record<string, ProductOption> = {};
  for (const group of groups) {
    const option = group.options.find((candidate) => candidate.available) ?? group.options[0];
    if (option) chosen[group.id] = option;
  }

  const quantity = Math.min(100, Math.max(1, Math.trunc(request.quantity ?? 1)));
  const buyer =
    BUYERS[
      Number.isInteger(request.buyer)
        ? Math.abs(request.buyer as number) % BUYERS.length
        : Math.floor(Math.random() * BUYERS.length)
    ]!;
  const amountCents = product.price_cents * quantity;

  return recordPaidOrder({
    checkoutSessionId:
      request.checkoutSessionId ?? `cs_dev_${crypto.randomUUID().replace(/-/g, "")}`,
    productId: product.id,
    sellerId: accountId,
    storefrontId: null,
    channel: "embed",
    quantity,
    selection: optionSummaryRows(groups, chosen),
    amountCents,
    platformFeeCents: Math.round(amountCents * SIMULATED_FEE_RATE),
    currency: product.currency,
    buyerEmail: buyer.email,
    buyerLocale: buyer.locale,
    shipTo: buyer.shipTo,
  });
}
