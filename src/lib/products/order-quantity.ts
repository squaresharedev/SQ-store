// SERVER ONLY. The authority on how many units a buyer may actually be sold,
// and the price that many units cost.
//
// WHAT THIS IS FOR. A quantity picker puts a number in the buyer's hands, and
// a number in a buyer's hands is a number that will be edited — in the address
// bar, in the DOM, in a replayed request body. Everything the buyer touches
// (the `?q=` parameter, the `<select>`, the mailto body) is presentation. THIS
// is the boundary, and it holds because of one rule:
//
//   NOTHING THE CALLER PASSES IS USED AS A FACT EXCEPT THE PRODUCT ID AND THE
//   REQUESTED NUMBER. The ceiling, the price, the currency, the stock and the
//   product's status are all re-read from the row inside this function. A
//   caller cannot hand in a limit, cannot hand in a unit price, and therefore
//   cannot forge a total.
//
// IT REFUSES, IT DOES NOT CLAMP. An over-limit request comes back as
// `over_limit`, not as a quietly-lowered quantity. Clamping is right for a page
// render (see clampQuantity) and wrong for a sale: charging someone for three
// when they pressed ten is a dispute, and a checkout that silently rewrites the
// order is a checkout nobody can reconcile.
//
// HOW A CHECKOUT USES IT. Call this FIRST, with the buyer's number; take
// `quantity` and `totalCents` from the result and never from the request; hand
// that same `quantity` to decrementStock (lib/stock/decrement.ts) inside the
// same flow. The DB's decrement enforces the per-order cap a second time, so
// even a caller that skipped this function cannot oversell past it.
//
// WHAT IT DOES NOT CHECK, and what a checkout therefore still owes:
//   - PLACEMENT. This answers "may this many of this product be sold", not
//     "may this buyer buy it HERE". A product that is active but not placed on
//     the storefront the buyer came from has no page there (see
//     getPublicProductPage, which does check) and must not have a checkout
//     either. Pass the storefront through and check the block yourself.
//   - IDENTITY, payment state, and idempotency. An order created twice from
//     one confirmed payment is two decrements of a correct quantity.
//   - THE PRICE THE BUYER WAS SHOWN. `unitPriceCents` is the price NOW. If a
//     seller edits it between page load and pay, this returns the new one,
//     which is the right default (never charge a stale price by accident) but
//     means a checkout that wants "the price you saw" has to say so.
//
// The `client` MUST be a service-role client, injected by the caller for the
// same reason decrementStock takes one: the read has to see a product the
// buyer has no RLS grant on, and privilege is never constructed quietly here.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { toCurrency } from "@/lib/format/money";
import { lineTotalCents, productQuantityCap } from "@/lib/products/quantity";
import { PURCHASE_QUANTITY_MAX, productIdSchema } from "@/lib/validation/product";
import type { Currency } from "@/types/product";

/** Exactly the columns the decision is made from. Named, not `*`: a column
 *  this function does not read is a column it cannot accidentally trust. */
const ORDER_QUANTITY_SELECT =
  "id, status, price_cents, currency, track_stock, stock_quantity, max_per_order" as const;

type OrderQuantityRow = {
  id: string;
  status: string;
  price_cents: number;
  currency: string;
  track_stock: boolean;
  stock_quantity: number | null;
  max_per_order: number | null;
};

/**
 * The buyer's request, as a shape rather than as a number. A string, a float, a
 * NaN, an object and a 10^9 all fail here before any I/O happens, so a scan
 * cannot make this function do a database read.
 */
const requestSchema = z.object({
  productId: productIdSchema,
  quantity: z
    .number()
    .int()
    .min(1)
    .max(PURCHASE_QUANTITY_MAX),
});

export type OrderQuantityRefusal =
  /** Not a whole number in [1, PURCHASE_QUANTITY_MAX], or not a product id. */
  | "invalid_request"
  /** No such product, or it is not `active`. Deliberately one reason, so this
   *  cannot be used to tell an existing draft from a product that never was. */
  | "unavailable"
  /** A legal number, above what THIS product allows in one order. */
  | "over_limit"
  /** Tracked stock cannot cover it right now. */
  | "insufficient_stock";

export type OrderQuantityResult =
  | {
      ok: true;
      /** Exactly what was asked for. This function never returns a different
       *  number than the buyer pressed; it either allows it or refuses. */
      quantity: number;
      /** The row's own price, re-read here and never taken from the caller. */
      unitPriceCents: number;
      currency: Currency;
      /** unitPriceCents * quantity, integer cents. The only total a charge may
       *  be built from. */
      totalCents: number;
      /** What this product allows in one order, for a message that can say so. */
      maxPerOrder: number;
    }
  | { ok: false; reason: OrderQuantityRefusal };

/**
 * Decide whether `quantity` of `productId` may be sold, and for how much.
 *
 * Every refusal is a distinct reason on purpose: unlike the public page loader
 * (which collapses everything into one 404 so nothing is enumerable), this runs
 * behind a checkout the buyer is already standing in, where "sold out" and "we
 * only sell three at a time" are different sentences a buyer has to be told.
 * `unavailable` is still deliberately coarse.
 */
export async function resolveOrderQuantity(
  client: SupabaseClient<Database>,
  productId: string,
  quantity: unknown,
): Promise<OrderQuantityResult> {
  const parsed = requestSchema.safeParse({ productId, quantity });
  if (!parsed.success) return { ok: false, reason: "invalid_request" };

  const { data, error } = await client
    .from("products")
    .select(ORDER_QUANTITY_SELECT)
    .eq("id", parsed.data.productId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[order-quantity] product read failed", error);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "unavailable" };

  const row = data as OrderQuantityRow;
  const wanted = parsed.data.quantity;

  // The seller's ceiling, corrected into the legal range on the way out of the
  // database rather than believed (see productQuantityCap).
  const maxPerOrder = productQuantityCap(row.max_per_order);
  if (wanted > maxPerOrder) return { ok: false, reason: "over_limit" };

  // The shelf. Checked against the REAL number, not the badge the page showed:
  // the picker deliberately does not narrow to stock while the count is
  // private, so this is the first and only place an oversell is caught.
  if (row.track_stock && (row.stock_quantity ?? 0) < wanted) {
    return { ok: false, reason: "insufficient_stock" };
  }

  return {
    ok: true,
    quantity: wanted,
    unitPriceCents: row.price_cents,
    currency: toCurrency(row.currency),
    totalCents: lineTotalCents(row.price_cents, wanted),
    maxPerOrder,
  };
}
