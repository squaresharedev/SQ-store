/** The Discounts section of the dashboard. */
export const DISCOUNTS_PATH = "/discounts";

/** Where a new discount is made. */
export const NEW_DISCOUNT_PATH = `${DISCOUNTS_PATH}/new`;

/** Where one discount is edited. */
export function discountEditPath(id: string): string {
  return `${DISCOUNTS_PATH}/${encodeURIComponent(id)}/edit`;
}
