import { priceOfOne } from "@/lib/discounts/pricing";
import type { DiscountProductChoice, DiscountView } from "@/types/discount";
import type { Currency } from "@/types/product";

/**
 * WHICH PRODUCTS A DISCOUNT COVERS, and what one of each costs under it: what
 * a discount's row opens to show a seller. Pure and client-safe.
 *
 * "Covers" is the discount's own scope (every product, or the ones it names).
 * A product in scope that the discount cannot lower (an amount in another
 * currency, a price already at the smallest payable amount) is still listed,
 * at its regular price, so the list answers "why did this one not change"
 * instead of quietly leaving it out.
 */

/** One product in a discount's scope. */
export type CoveredProduct = {
  id: string;
  title: string;
  currency: Currency;
  regularCents: number;
  /** What one costs under the discount; equal to regularCents when the
   *  discount does not lower it. */
  nowCents: number;
  /** The cover photo, or null. Shown beside the name. */
  imageUrl: string | null;
};

/**
 * The store's products this discount covers, in the order they were given. A
 * product the discount names that is no longer in the store is simply absent.
 */
export function coveredProducts(
  discount: Pick<DiscountView, "kind" | "value" | "appliesTo" | "productIds">,
  products: readonly DiscountProductChoice[],
): CoveredProduct[] {
  const named = discount.appliesTo === "all" ? null : new Set(discount.productIds);
  return products
    .filter((product) => named === null || named.has(product.id))
    .map((product) => ({
      id: product.id,
      title: product.title,
      currency: product.currency,
      regularCents: product.priceCents,
      imageUrl: product.imageUrl ?? null,
      nowCents: priceOfOne(discount.kind, discount.value, product.priceCents, product.currency),
    }));
}
