import { headers } from "next/headers";
import { after } from "next/server";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { cartWriteSchema } from "@/lib/validation/cart";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeCart, mergeCarts, readCart, type StoredCart } from "@/lib/cart/store";
import { changeCartLines } from "@/lib/cart/lines";
import { buildCartView } from "@/lib/cart/view";
import { buyerCountry, cartAnswer, cartGate } from "@/lib/cart/route";
import { assessLines } from "@/lib/checkout/quote";
import { lineKey } from "@/lib/checkout/lines";
import { cartAddDedupeKey, recordSignal, visitorHash } from "@/lib/analytics/record";
import { recordFunnelPoint } from "@/lib/analytics/funnel/record";
import type { CartRefusal } from "@/types/cart";

/**
 * POST /api/cart/[storefrontId]: change a buyer's cart (add, a new quantity,
 * remove, empty, or bring another cart in), and answer with the cart as it now
 * stands, priced.
 *
 * PUBLIC and a write, so it pays first: same origin only (the hosted pages, or
 * the embed frame on its own origin), a tiny body parsed strictly, and one
 * token from cartWrite before the first read. A cart is created only by an
 * ADD, never by a view, so filling the table costs a script what it costs a
 * shopper.
 *
 * WHAT GOES IN IS SELLABLE. An add is checked by the quote's own rules
 * (lib/checkout/quote.ts assessLines) against the cart as it would be, and
 * refused with the line's reason rather than stored broken: sold out, a
 * version that is not offered, more than one order can hold, another
 * currency than the rest of the cart. Raising a quantity is checked the same
 * way; lowering it or taking a line out never is (that is how a buyer fixes a
 * line). Stock is NOT held: it is held only at Pay, for the payment page's
 * lifetime, so a cart cannot hoard a seller's shelf.
 *
 * An add that goes in is counted after the response, never in its way: the
 * seller's "Added to cart" figure (a signal, one per visitor, per product, per
 * hour) and the funnel's add_to_cart point.
 */

type Params = { storefrontId: string };

/** One change in JSON. */
const BODY_MAX_BYTES = 2 * 1024;
const RATE_ACTION = "cart_write";

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  if (!isSameOriginRequest(request)) return cartAnswer({ ok: false, error: "unavailable" }, 403);
  const read = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!read.ok) return cartAnswer({ ok: false, error: "invalid" }, read.reason === "too_large" ? 413 : 400);
  const parsed = cartWriteSchema.safeParse(read.value);
  if (!parsed.success) return cartAnswer({ ok: false, error: "invalid" }, 400);
  const { cartId, change, via } = parsed.data;

  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  if (!(await rateLimitKey(ip, RATE_ACTION, RATE_LIMITS.cartWrite))) {
    return cartAnswer({ ok: false, error: "rate_limited" }, 429);
  }

  const { storefrontId } = await params;
  const admin = createAdminClient();
  const country = buyerCountry(requestHeaders);

  // Bringing another cart in: the merge decides the lines, then the result is
  // shown like any other.
  if (change.kind === "merge") {
    if (!cartId) return cartAnswer({ ok: false, error: "invalid" }, 400);
    const merged = await mergeCarts(admin, { intoId: cartId, fromId: change.fromCartId, storefrontId });
    if (merged === "error") return cartAnswer({ ok: false, error: "unavailable" }, 503);
    if (!merged) return cartAnswer({ ok: false, error: "gone" }, 404);
    return answerWith(merged);
  }

  const current = cartId ? await readCart(admin, cartId, storefrontId) : null;
  if (current === "error") return cartAnswer({ ok: false, error: "unavailable" }, 503);
  // A paid or vanished cart takes nothing more: the buyer's next add starts a
  // new one (changeCart does), and anything else has nothing to change.
  const live = current && !current.closed ? current : null;
  if (!live && change.kind !== "add") return cartAnswer({ ok: false, error: "gone" }, 404);

  const adding = change.kind === "add";
  const productIds = [...(live?.lines ?? []).map((line) => line.productId), ...(adding ? [change.productId] : [])];
  const gate = await cartGate(storefrontId, productIds, RATE_ACTION, { adding });
  if (!gate) return cartAnswer({ ok: false, error: "unavailable" }, 404);

  // An add, or a raised quantity, must leave its line sellable.
  const before = live?.lines ?? [];
  const next = changeCartLines(before, change, new Date());
  if (!next.ok) return refuse(next.reason === "missing" ? "gone" : next.reason === "full" ? "full" : "quantity");
  const touched =
    change.kind === "add"
      ? lineKey(change)
      : change.kind === "set" &&
          change.quantity > (before.find((line) => lineKey(line) === change.key)?.quantity ?? 0)
        ? change.key
        : null;
  if (touched) {
    const assessed = assessLines(
      gate,
      next.lines.map((line) => ({
        productId: line.productId,
        optionIds: line.optionIds,
        quantity: line.quantity,
        source: line.source,
      })),
    );
    const at = next.lines.findIndex((line) => lineKey(line) === touched);
    const verdict = assessed[at];
    if (verdict && !verdict.ok) return refuse(verdict.problem);
  }

  const written = await changeCart(admin, { cartId: live?.id ?? null, storefrontId, change });
  if (!written.ok) {
    if (written.reason === "error") return cartAnswer({ ok: false, error: "unavailable" }, 503);
    return refuse(written.reason === "missing" ? "gone" : written.reason === "full" ? "full" : "quantity");
  }
  const status = change.kind === "add" ? 201 : 200;
  if (change.kind === "add") countAdd(gate.store.ownerId, change.productId);
  // Another tab wrote in between and changeCart replayed this change on top:
  // the cart now holds a product the gate above never read, so it is gated
  // afresh rather than shown as "no longer sold".
  const gated = new Set(productIds);
  if (written.cart.lines.some((line) => !gated.has(line.productId))) return answerWith(written.cart, status);
  return cartAnswer({ ok: true, cart: await buildCartView(gate, written.cart, country) }, status);

  /** "Added to cart", after the response. Best effort: neither write can fail
   *  the add (both swallow their own errors). */
  function countAdd(ownerId: string, productId: string): void {
    const userAgent = requestHeaders.get("user-agent");
    after(async () => {
      const hash = await visitorHash(ownerId, [ip, userAgent]);
      await Promise.all([
        recordSignal({
          accountId: ownerId,
          kind: "cart_add",
          storefrontId,
          channel: via ?? "direct",
          blockId: `p_${productId}`,
          visitorHash: hash,
          dedupeKey: await cartAddDedupeKey(productId, hash),
        }),
        recordFunnelPoint({ sellerId: ownerId, storeId: storefrontId, productId, event: "add_to_cart" }),
      ]);
    });
  }

  /** Refuse with the cart as it stands, so the page can show it unchanged. */
  async function refuse(error: CartRefusal): Promise<Response> {
    const cart = live ? await buildCartView(gate!, live, country) : undefined;
    return cartAnswer({ ok: false, error, ...(cart ? { cart } : {}) }, 409);
  }

  /** A cart this request did not decide alone (a merge, or a change replayed
   *  over another tab's), gated afresh for its own products. */
  async function answerWith(cart: StoredCart, status = 200): Promise<Response> {
    const fresh = await cartGate(
      storefrontId,
      cart.lines.map((line) => line.productId),
      RATE_ACTION,
      { adding: false },
    );
    if (!fresh) return cartAnswer({ ok: false, error: "unavailable" }, 404);
    return cartAnswer({ ok: true, cart: await buildCartView(fresh, cart, country) }, status);
  }
}
