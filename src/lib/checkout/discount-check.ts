// SERVER ONLY. The checkout's "Apply" for a discount code, shared by the "Buy
// now" checkout and the cart's.
//
// The answer is the code's TERMS (what it takes off) and which of the order's
// products it covers, so the checkout can show the new total before the buyer
// pays; the order route looks the code up again and prices from the database,
// so nothing answered here is ever charged.
//
// A store's codes are secret until shared, and this is the only door to them,
// so it is the narrowest one in the checkout:
//
//   1. Same origin only.
//   2. A tiny body, parsed strictly: one code, in the code shape, and at most
//      a cart's worth of product ids.
//   3. The client IP spends a token from discountCheck (small, fail-closed)
//      before any lookup, so guessing at codes is slow.
//   4. The product page's own gate for every product named (and the checkout
//      must be open).
//   5. One refusal for every reason a code does not apply: unknown, switched
//      off, not started, ended, used up, for none of these products. Nothing
//      here says whether a code exists, and nothing answered carries an id, a
//      channel or a count.

import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { discountCheckSchema } from "@/lib/validation/checkout";
import { gatePurchasableLines } from "@/lib/products/purchasable";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { findCodeForLines } from "@/lib/discounts/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCurrency } from "@/lib/format/money";
import { PAGE_BUSY } from "@/lib/public/busy";
import type { DiscountCheckResponse } from "@/types/checkout";

/** One short code and a cart's worth of ids in JSON. */
const BODY_MAX_BYTES = 2 * 1024;

function answer(body: DiscountCheckResponse, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * `productsFor` names the order's products from the parsed body: the first
 * one sets the order's currency.
 */
export async function discountCheckResponse(
  request: Request,
  storefrontId: string,
  productsFor: (productIds: readonly string[]) => string[],
): Promise<Response> {
  if (!isSameOriginRequest(request)) return answer({ ok: false, error: "unavailable" }, 403);

  const read = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!read.ok) return answer({ ok: false, error: "discount_invalid" }, read.reason === "too_large" ? 413 : 400);
  const parsed = discountCheckSchema.safeParse(read.value);
  if (!parsed.success) return answer({ ok: false, error: "discount_invalid" }, 400);
  const productIds = [...new Set(productsFor(parsed.data.productIds ?? []))];
  if (productIds.length === 0) return answer({ ok: false, error: "discount_invalid" }, 400);

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "discount_check", RATE_LIMITS.discountCheck))) {
    return answer({ ok: false, error: "rate_limited" }, 429);
  }

  const gate = await gatePurchasableLines(storefrontId, productIds, {
    action: "checkout_page",
    budget: RATE_LIMITS.checkoutPage,
  });
  const first = gate && gate !== PAGE_BUSY ? gate.items.get(productIds[0]!) : undefined;
  if (!gate || gate === PAGE_BUSY || !first || !(await checkoutProviderFor(gate.store.ownerId))) {
    return answer({ ok: false, error: "unavailable" }, 404);
  }

  const code = await findCodeForLines(createAdminClient(), {
    ownerId: gate.store.ownerId,
    productIds: productIds.filter((id) => gate.items.has(id)),
    currency: toCurrency(first.row.currency),
    code: parsed.data.code,
    now: gate.store.now,
  });
  if (!code) return answer({ ok: false, error: "discount_invalid" }, 409);

  return answer({ ok: true, terms: { code: code.code, value: code.value, covers: code.covers } }, 200);
}
