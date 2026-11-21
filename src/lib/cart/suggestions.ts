// SERVER ONLY. "GOES WELL WITH": what the cart suggests under its lines. The
// seller's own picks, never a guess: the products they chose for "Add to your
// order" on what is in the cart, in the cart's order, leaving out what is in
// it already. Each one is for sale here by the gate's own rules
// (loadStoreItems), in the cart's currency, priced now by the same sale rules
// as the lines, and offered in one press where it needs no choice
// (lib/cart/quick-add.ts), else through its page.

import { bestSale } from "@/lib/discounts/pricing";
import { loadStoreItems, type PurchasableLines } from "@/lib/products/purchasable";
import { isProductPageSectionShown } from "@/lib/storefront/product-page";
import { resolveCartPage } from "@/lib/storefront/cart-page";
import { productPagePath } from "@/lib/storefront/product-page-url";
import { toCurrency } from "@/lib/format/money";
import { CART_SUGGESTIONS_MAX, CART_SUGGESTION_CANDIDATES_MAX } from "@/lib/cart/limits";
import { quickAddFor } from "@/lib/cart/quick-add";
import { linePhoto } from "@/lib/cart/photo";
import { parseOptionGroups } from "@/lib/products/detail";
import type { StoredCart } from "@/lib/cart/store";
import type { CartSuggestion } from "@/types/cart";
import type { Currency } from "@/types/product";

/**
 * Up to CART_SUGGESTIONS_MAX suggestions for a cart, or none: the seller
 * switched them off, the product page does not offer "Add to your order"
 * (whose picks these are), the cart is empty or paid, or nothing picked is
 * left to suggest. A failed read suggests nothing rather than failing the
 * cart.
 */
export async function cartSuggestions(
  gate: Pick<PurchasableLines, "store" | "items">,
  cart: Pick<StoredCart, "lines" | "closed">,
  currency: Currency | null,
): Promise<CartSuggestion[]> {
  const { store } = gate;
  if (resolveCartPage(store.config).suggestions === false || cart.closed || !currency) return [];
  if (!isProductPageSectionShown(store.productPage, "addOns")) return [];
  const inCart = new Set(cart.lines.map((line) => line.productId));
  const candidates: string[] = [];
  for (const line of cart.lines) {
    for (const id of gate.items.get(line.productId)?.row.add_on_ids ?? []) {
      if (!inCart.has(id) && !candidates.includes(id)) candidates.push(id);
    }
  }
  if (candidates.length === 0) return [];
  const asked = candidates.slice(0, CART_SUGGESTION_CANDIDATES_MAX);
  const items = await loadStoreItems(store, asked);
  if (!items) return [];

  const picks: CartSuggestion[] = [];
  for (const id of asked) {
    if (picks.length >= CART_SUGGESTIONS_MAX) break;
    const item = items.get(id);
    if (!item || toCurrency(item.row.currency) !== currency) continue;
    const quickAdd = quickAddFor(item.row, item.block, store);
    // One with no choice to make that the cart would refuse (sold out, the
    // seller's own link, no delivery) is not suggested at all. One with
    // versions is, unless it plainly has none left: its page decides.
    if (!quickAdd && !needsChoice(item.row.option_groups)) continue;
    if (!quickAdd && (item.block?.soldOut || (item.row.track_stock && (item.row.stock_quantity ?? 0) <= 0))) continue;
    const regular = item.row.price_cents;
    const now = bestSale(item.sales, regular, currency)?.unitPriceCents ?? regular;
    picks.push({
      productId: id,
      title: item.row.title,
      image: await linePhoto(item, quickAdd?.optionIds ?? []),
      unitCents: now,
      regularUnitCents: regular > now ? regular : null,
      href: productPagePath(store.storefront.id, id),
      quickAdd,
    });
  }
  return picks;
}

/** Whether a product asks its buyer to pick a version (a group with more than
 *  one option). */
function needsChoice(raw: unknown): boolean {
  return parseOptionGroups(raw).some((group) => group.options.length > 1);
}
