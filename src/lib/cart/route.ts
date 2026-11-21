// SERVER ONLY. What the two cart routes (app/api/cart/[storefrontId] and its
// /view) share: the answer's shape, the storefront's half of the gate, and the
// buyer's probable country.

import { gatePurchasableLines, type PurchasableLines } from "@/lib/products/purchasable";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { cartFor, cartLaunched } from "@/lib/cart/availability";
import { PAGE_BUSY } from "@/lib/public/busy";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import type { CartResponse } from "@/types/cart";

/** Every cart answer: never cached anywhere, a cart is one buyer's. */
export function cartAnswer(body: CartResponse, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * The gate for these products, when this storefront's carts work right now:
 * our checkout can take the money and, for putting something IN a cart, the
 * seller has not switched the cart off. (A seller switching it off stops new
 * adds; a cart a buyer already filled can still be seen, changed and paid
 * until it expires.) Null otherwise, one answer for every reason, as the
 * product page's 404. `spentBy` names the budget the route already spent
 * this request's token from.
 */
export async function cartGate(
  storefrontId: string,
  productIds: readonly string[],
  spentBy: string,
  options: { adding: boolean },
): Promise<Pick<PurchasableLines, "store" | "items"> | null> {
  if (!cartLaunched()) return null;
  const gate = await gatePurchasableLines(storefrontId, productIds, { spentBy });
  if (!gate || gate === PAGE_BUSY) return null;
  if (options.adding) {
    if (!(await cartFor(gate.store))) return null;
  } else if (!(await checkoutProviderFor(gate.store.ownerId))) {
    return null;
  }
  return gate;
}

/** Where the buyer probably is, from Cloudflare's own header: only to show
 *  delivery before the checkout asks. Never stored, and only a country the
 *  platform ships to at all. */
export function buyerCountry(requestHeaders: Headers): string | null {
  const country = requestHeaders.get("cf-ipcountry")?.toUpperCase() ?? null;
  return country && (SHIPPING_COUNTRY_CODES as readonly string[]).includes(country) ? country : null;
}
