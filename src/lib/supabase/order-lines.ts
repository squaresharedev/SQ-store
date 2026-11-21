/**
 * "Any line of this order is this product", as one PostgREST `or=` expression:
 * the order's own first line (orders.product_id), or a line after it
 * (orders.more_product_ids, written by order_place).
 *
 * `or=` takes a PARSED expression, so nothing typed by a person may reach one
 * (tests/unit/search-input-hardening.test.ts refuses a hand-built `.or(` in
 * the orders paths). The one value here is a product id, and anything that is
 * not exactly a uuid is refused with a throw: callers check the id first
 * (`isProductId`) and decide what a bad one means for them.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` can go into anyOrderLineIs. */
export function isProductId(value: string): boolean {
  return UUID.test(value);
}

export function anyOrderLineIs(productId: string): string {
  if (!isProductId(productId)) throw new Error("anyOrderLineIs takes a product id");
  return `product_id.eq.${productId},more_product_ids.cs.{${productId}}`;
}
