// SERVER ONLY. A cart as its buyer sees it: every line priced NOW by the same
// rules the checkout charges (lib/checkout/quote.ts), each line's own problem
// in place of a refusal, and what delivery looks like before the checkout
// knows the address. Built field by field into CartView: nothing here is a
// key, an owner id, a stock count or a price the server did not just work out.

import { assessLines, priceAssessedLines, type AssessedLine } from "@/lib/checkout/quote";
import { lineKey } from "@/lib/checkout/lines";
import { bestSale } from "@/lib/discounts/pricing";
import { publicQuantityLimit } from "@/lib/products/quantity";
import { freeDeliveryGapCents, freeOverCentsIn, quoteOrderShipping } from "@/lib/shipping/rates";
import { cartItemCount } from "@/lib/cart/lines";
import { toCurrency } from "@/lib/format/money";
import { productPagePath } from "@/lib/storefront/product-page-url";
import type { PurchasableItem, PurchasableLines } from "@/lib/products/purchasable";
import type { StoredCart } from "@/lib/cart/store";
import type { CartDelivery, CartLineView, CartView } from "@/types/cart";
import { linePhoto } from "@/lib/cart/photo";
import { cartSuggestions } from "@/lib/cart/suggestions";

/**
 * `country` is where the buyer probably is (Cloudflare's guess from the
 * request, or nothing): delivery is shown for it when the seller delivers
 * there, and "at checkout" otherwise. A guess is fine for a preview because
 * the checkout prices the real address before anything is charged.
 */
export async function buildCartView(
  gate: Pick<PurchasableLines, "store" | "items">,
  cart: StoredCart,
  country: string | null,
): Promise<CartView> {
  const requests = cart.lines.map((line) => ({
    productId: line.productId,
    optionIds: line.optionIds,
    quantity: line.quantity,
    source: line.source,
  }));
  const assessed = assessLines(gate, requests);
  const sellable = assessed.filter((line): line is Extract<AssessedLine, { ok: true }> => line.ok);
  const priced = priceAssessedLines(sellable, null);
  const pricedFor = new Map(sellable.map((line, index) => [line, priced.lines[index]!]));
  const { store } = gate;

  const lines = await Promise.all(
    cart.lines.map(async (line, index): Promise<CartLineView> => {
      const check = assessed[index]!;
      const item = gate.items.get(line.productId);
      const at = check.ok ? pricedFor.get(check) : undefined;
      // A line whose product is no longer for sale here shows nothing about
      // it: a takedown is not undone by the cart having remembered an id.
      const known = item && !(check.ok === false && check.problem === "not_found");
      const unit = known && item ? unitPrices(item) : null;
      return {
        key: lineKey(line),
        productId: line.productId,
        optionIds: line.optionIds,
        quantity: line.quantity,
        title: known && item ? item.row.title : null,
        image: known && item ? await linePhoto(item, line.optionIds) : null,
        selection: check.ok ? check.selection : [],
        href: known ? productPagePath(store.storefront.id, line.productId) : null,
        unitCents: at ? at.unitPriceCents : (unit?.now ?? null),
        regularUnitCents: unit && unit.regular > (at?.unitPriceCents ?? unit.now) ? unit.regular : null,
        amountCents: at ? at.amountCents : null,
        problem: check.ok ? null : check.problem,
        maxQuantity: item
          ? publicQuantityLimit(
              {
                maxPerOrder: item.row.max_per_order,
                trackStock: item.row.track_stock,
                stockQuantity: item.row.stock_quantity,
                lowStockThreshold: item.row.low_stock_threshold,
              },
              { stockShown: store.productPage.showStock },
            )
          : 0,
      };
    }),
  );

  const currency = sellable[0]?.currency ?? null;
  const policy = store.shippingPolicy;
  // The seller's free-over threshold, when it is in the cart's currency.
  const freeOver = freeOverCentsIn(policy, currency);

  let delivery: CartDelivery = { kind: "none" };
  let freeGap: number | null = null;
  if (priced.ships && currency) {
    const profileIds = priced.lines.flatMap((line) => (line.isDigital ? [] : [line.shippingProfileId]));
    const quote = country
      ? quoteOrderShipping(policy, {
          profileIds,
          country,
          subtotalCents: priced.shippedItemsCents,
          currency,
        })
      : null;
    if (quote?.ok) {
      delivery = quote.free ? { kind: "free", area: quote.area } : { kind: "cost", cents: quote.rateCents, area: quote.area };
      freeGap = freeDeliveryGapCents(policy, quote, priced.shippedItemsCents);
    } else {
      delivery = { kind: "atCheckout" };
      freeGap = freeOver !== null && priced.shippedItemsCents < freeOver ? freeOver - priced.shippedItemsCents : null;
    }
  }

  const suggestions = await cartSuggestions(gate, cart, currency ? toCurrency(currency) : null);

  return {
    id: cart.id,
    rev: cart.rev,
    closed: cart.closed,
    currency: currency ? toCurrency(currency) : null,
    lines,
    count: cartItemCount(cart.lines),
    itemsCents: priced.itemsCents,
    delivery,
    freeDeliveryGapCents: freeGap,
    freeDeliveryOverCents: priced.ships ? freeOver : null,
    canCheckout: !cart.closed && cart.lines.length > 0 && assessed.every((line) => line.ok),
    suggestions,
  };
}

/** One item's price now (its best sale's) and its regular price. */
function unitPrices(item: PurchasableItem): { now: number; regular: number } {
  const regular = item.row.price_cents;
  const sale = bestSale(item.sales, regular, toCurrency(item.row.currency));
  return { now: sale?.unitPriceCents ?? regular, regular };
}

