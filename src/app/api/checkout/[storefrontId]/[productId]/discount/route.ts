import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { discountCheckSchema } from "@/lib/validation/checkout";
import { loadPurchasable } from "@/lib/products/purchasable";
import { checkoutAvailableFor } from "@/lib/checkout/availability";
import { findCodeFor } from "@/lib/discounts/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCurrency } from "@/lib/format/money";
import type { DiscountCheckResponse } from "@/types/checkout";

/**
 * POST /api/checkout/[storefrontId]/[productId]/discount: the checkout's
 * "Apply" for a discount code.
 *
 * The answer is the code's TERMS (what it takes off), so the checkout can show
 * the new total before the buyer pays; the order route looks the code up again
 * and prices from the database, so nothing answered here is ever charged.
 *
 * A store's codes are secret until shared, and this is the only door to them,
 * so it is the narrowest one in the checkout:
 *
 *   1. Same origin only.
 *   2. A tiny body, parsed strictly: one code, in the code shape.
 *   3. The client IP spends a token from discountCheck (small, fail-closed)
 *      before any lookup, so guessing at codes is slow.
 *   4. The product page's own gate (and the checkout must be open for it).
 *   5. One refusal for every reason a code does not apply: unknown, switched
 *      off, not started, ended, used up, for other products. Nothing here says
 *      whether a code exists, and nothing answered carries an id, a channel or
 *      a count.
 */

type Params = { storefrontId: string; productId: string };

/** One short code in JSON. */
const BODY_MAX_BYTES = 1024;

function answer(body: DiscountCheckResponse, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  if (!isSameOriginRequest(request)) return answer({ ok: false, error: "unavailable" }, 403);

  const read = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!read.ok) return answer({ ok: false, error: "discount_invalid" }, read.reason === "too_large" ? 413 : 400);
  const parsed = discountCheckSchema.safeParse(read.value);
  if (!parsed.success) return answer({ ok: false, error: "discount_invalid" }, 400);

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "discount_check", RATE_LIMITS.discountCheck))) {
    return answer({ ok: false, error: "rate_limited" }, 429);
  }

  const { storefrontId, productId } = await params;
  const gate = await loadPurchasable(storefrontId, productId, {
    action: "checkout_page",
    budget: RATE_LIMITS.checkoutPage,
  });
  if (!gate || !(await checkoutAvailableFor(gate))) return answer({ ok: false, error: "unavailable" }, 404);

  const code = await findCodeFor(createAdminClient(), {
    ownerId: gate.ownerId,
    productId: gate.row.id,
    currency: toCurrency(gate.row.currency),
    code: parsed.data.code,
    now: gate.now,
  });
  if (!code) return answer({ ok: false, error: "discount_invalid" }, 409);

  return answer({ ok: true, terms: { code: code.code, value: code.value } }, 200);
}
