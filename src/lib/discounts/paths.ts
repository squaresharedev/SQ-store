/** The Discounts section of the dashboard. */
export const DISCOUNTS_PATH = "/discounts";

/** Where a new discount is made. */
export const NEW_DISCOUNT_PATH = `${DISCOUNTS_PATH}/new`;

/** The query parameter that opens the new-discount form as a sale on one
 *  product (the storefront designer's "Start a sale" on a tile). */
export const NEW_SALE_PRODUCT_PARAM = "product";

/** Where a new sale is made: on `productId` alone when given, else the plain
 *  form, which starts as a sale on everything. */
export function newSalePath(productId?: string): string {
  return productId
    ? `${NEW_DISCOUNT_PATH}?${NEW_SALE_PRODUCT_PARAM}=${encodeURIComponent(productId)}`
    : NEW_DISCOUNT_PATH;
}

/** Where one discount is edited. */
export function discountEditPath(id: string): string {
  return `${DISCOUNTS_PATH}/${encodeURIComponent(id)}/edit`;
}
