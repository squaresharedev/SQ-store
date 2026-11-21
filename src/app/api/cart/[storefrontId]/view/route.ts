import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { cartViewSchema } from "@/lib/validation/cart";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCart } from "@/lib/cart/store";
import { buildCartView } from "@/lib/cart/view";
import { buyerCountry, cartAnswer, cartGate } from "@/lib/cart/route";

/**
 * POST /api/cart/[storefrontId]/view: a buyer's cart, priced now.
 *
 * A POST with the cart's id in the BODY, never in the address: the id is the
 * buyer's only key to their cart, and an address ends up in logs. Same origin
 * only (the hosted pages, or the embed frame on its own origin), a tiny body,
 * and one token from cartRead before the first read.
 */

type Params = { storefrontId: string };

/** One id in JSON. */
const BODY_MAX_BYTES = 256;
const RATE_ACTION = "cart_read";

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  if (!isSameOriginRequest(request)) return cartAnswer({ ok: false, error: "unavailable" }, 403);
  const read = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!read.ok) return cartAnswer({ ok: false, error: "invalid" }, read.reason === "too_large" ? 413 : 400);
  const parsed = cartViewSchema.safeParse(read.value);
  if (!parsed.success) return cartAnswer({ ok: false, error: "invalid" }, 400);

  const requestHeaders = await headers();
  if (!(await rateLimitKey(await clientKey(requestHeaders), RATE_ACTION, RATE_LIMITS.cartRead))) {
    return cartAnswer({ ok: false, error: "rate_limited" }, 429);
  }

  const { storefrontId } = await params;
  const admin = createAdminClient();
  const cart = await readCart(admin, parsed.data.cartId, storefrontId);
  if (cart === "error") return cartAnswer({ ok: false, error: "unavailable" }, 503);
  if (!cart) return cartAnswer({ ok: false, error: "gone" }, 404);

  const gate = await cartGate(
    storefrontId,
    cart.lines.map((line) => line.productId),
    RATE_ACTION,
    { adding: false },
  );
  if (!gate) return cartAnswer({ ok: false, error: "unavailable" }, 404);
  return cartAnswer({ ok: true, cart: await buildCartView(gate, cart, buyerCountry(requestHeaders)) }, 200);
}
