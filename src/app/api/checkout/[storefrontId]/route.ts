import { placeCartOrderSchema } from "@/lib/validation/checkout";
import { fieldsOf, placeOrderResponse } from "@/lib/checkout/place-order";

/**
 * POST /api/checkout/[storefrontId]: place a cart's order from the hosted
 * checkout. The body names the lines exactly as the checkout showed them, and
 * they are priced again by the quote (another tab changing the cart mid-way
 * cannot change what is paid: these lines, at the total shown, or a refusal).
 * Every check, the quote and the payment are "Buy now"'s too
 * (lib/checkout/place-order.ts); payment closes the cart named.
 */

type Params = { storefrontId: string };

/** A cart's worth of lines (20, each with up to 4 option ids) and the buyer:
 *  about 6 KB at most. Anything bigger is not read. */
const BODY_MAX_BYTES = 16 * 1024;

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const { storefrontId } = await params;
  return placeOrderResponse(request, {
    storefrontId,
    bodyMaxBytes: BODY_MAX_BYTES,
    parse: (body) => {
      const parsed = placeCartOrderSchema.safeParse(body);
      if (!parsed.success) return { ok: false, fields: fieldsOf(parsed.error.issues) };
      const { lines, cartId, ...order } = parsed.data;
      return { ok: true, order, cartId, lines };
    },
  });
}
