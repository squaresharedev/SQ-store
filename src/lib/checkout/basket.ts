import { priceAddOn, priceOrder, type PricedAddOn, type PricedOrder } from "@/lib/discounts/pricing";
import type { Currency } from "@/types/product";
import type { DiscountValue } from "@/types/discount";

// WHAT AN ORDER'S ITEMS COST: the product the buyer came for, plus whatever
// they added to the order. Pure and client-safe, and the ONE sum the checkout
// preview (CheckoutForm) and the server's quote (lib/checkout/quote.ts) both
// call, so the total a buyer is shown is the total they are charged.
//
// The main product is priced by priceOrder exactly as before (its sale or the
// buyer's code, whichever is lower). Each add-on is priced on its own by its
// own sale (priceAddOn). Delivery is not in here: it is quoted on itemsCents,
// once for the whole order (quoteOrderShipping in lib/shipping/rates.ts).

export type BasketAddOn = {
  productId: string;
  regularUnitCents: number;
  /** The best running sale's price for one, or null without one. */
  saleUnitCents: number | null;
  quantity: number;
};

export type PricedBasket = {
  main: PricedOrder;
  addOns: (PricedAddOn & { productId: string; regularUnitCents: number; quantity: number })[];
  /** Everything the items cost together: what delivery is quoted on, and the
   *  total before delivery. */
  itemsCents: number;
};

export function priceBasket(input: {
  main: {
    regularUnitCents: number;
    currency: Currency;
    quantity: number;
    saleUnitCents: number | null;
    code: DiscountValue | null;
  };
  addOns: readonly BasketAddOn[];
}): PricedBasket {
  const main = priceOrder(input.main);
  const addOns = input.addOns.map((line) => ({
    productId: line.productId,
    regularUnitCents: line.regularUnitCents,
    quantity: line.quantity,
    ...priceAddOn(line),
  }));
  return {
    main,
    addOns,
    itemsCents: main.itemsCents + addOns.reduce((total, line) => total + line.amountCents, 0),
  };
}
