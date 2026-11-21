import { placeOrderSchema } from "@/lib/validation/checkout";
import { buyNowLines } from "@/lib/checkout/quote";
import { fieldsOf, placeOrderResponse } from "@/lib/checkout/place-order";

/**
 * POST /api/checkout/[storefrontId]/[productId]: place a "Buy now" order from
 * the hosted checkout: one product, and whatever was taken from its "Add to
 * your order". Every check, the quote and the payment are the cart's too
 * (lib/checkout/place-order.ts); only the body's shape is this route's.
 *
 * A route handler rather than a server action, deliberately: a buyer's tab
 * can sit open across a deploy, and a server action's id does not survive
 * one ("Failed to find Server Action"). A plain URL does.
 */

type Params = { storefrontId: string; productId: string };

/** Far more than any honest order body (a long address and a gift message are
 *  well under 2 KB); anything bigger is not read. */
const BODY_MAX_BYTES = 8 * 1024;

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const { storefrontId, productId } = await params;
  return placeOrderResponse(request, {
    storefrontId,
    bodyMaxBytes: BODY_MAX_BYTES,
    parse: (body) => {
      const parsed = placeOrderSchema.safeParse(body);
      if (!parsed.success) return { ok: false, fields: fieldsOf(parsed.error.issues) };
      const { optionIds, quantity, addOns, ...order } = parsed.data;
      return {
        ok: true,
        order,
        cartId: null,
        lines: buyNowLines({ productId, optionIds, quantity, addOns }),
      };
    },
    // The page names a problem with anything taken from "Add to your order"
    // in one sentence of its own; the product's own line keeps its reason.
    refusalFor: (reason, line) => (line !== undefined && line > 0 ? "add_on_unavailable" : reason),
  });
}
